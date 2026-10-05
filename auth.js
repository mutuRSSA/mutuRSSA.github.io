// =====================================================================
// auth.js - PENJAGA GERBANG UTAMA (SUPABASE AUTH + ROLE-BASED ACCESS)
// =====================================================================
// PENTING: File ini menjaga UX (redirect, sembunyikan menu) — bukan
// satu-satunya pertahanan. Keamanan data sesungguhnya HARUS ditegakkan
// lewat Row Level Security (RLS) di Supabase, karena request ke database
// selalu bisa dipanggil langsung lewat REST API dengan anon key, lepas
// dari halaman/JS ini.
// =====================================================================

async function jagaGerbang() {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    // Halaman yang bisa dibuka tanpa login. Formulir pelaporan & survei dikirim
    // lewat fungsi database (lapor_insiden, kirim_survei_budaya) yang memvalidasi
    // isian dan membatasi spam; pengunjung tanpa login tidak bisa MEMBACA data.
    const halamanPublik = ["index.html", "login.html", "", "ikp.html", "kpc.html", "survey_budaya.html"];

    if (!supabaseClient) return;

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const session = sessionData.session;

    // 1. BELUM LOGIN SAMA SEKALI
    if (!session) {
        localStorage.removeItem("sessionMutu");
        if (!halamanPublik.includes(currentPage)) {
            tampilkanPesanAkses(
                'Akses Terkunci!',
                'Anda harus login terlebih dahulu untuk mengakses halaman ini.',
                'warning',
                'login.html'
            );
        }
        return;
    }

    // 2. SESI ADA — AMBIL PROFIL TERBARU DARI DATABASE (jangan percaya cache lama)
    const { data: profil, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !profil || profil.status !== 'Aktif') {
        await supabaseClient.auth.signOut({ scope: 'local' });
        localStorage.removeItem("sessionMutu");
        tampilkanPesanAkses(
            'Sesi Tidak Valid',
            'Profil akun Anda tidak ditemukan atau telah dinonaktifkan.',
            'error',
            'login.html'
        );
        return;
    }

    // Password di-reset admin -> wajib buat password baru dulu
    if (profil.wajib_ganti_password === true) {
        window.location.replace('ganti_password.html');
        return;
    }

    // Ambil allowed_pages dari role_permissions berdasarkan role user (per-role)
    let allowedPages = [];
    // select('*') supaya tetap jalan walaupun kolom is_admin belum ada
    // (migrasi role_admin_dinamis belum dijalankan). limit(1) supaya tidak
    // gagal bila ada baris role ganda.
    const { data: rolesRows, error: roleError } = await supabaseClient
        .from('role_permissions')
        .select('*')
        .eq('role', profil.role)
        .limit(1);
    if (roleError) console.error('Gagal membaca hak akses role:', roleError);
    const roleData = rolesRows && rolesRows[0];
    if (!roleData) console.warn(`Role "${profil.role}" tidak ditemukan di role_permissions.`);

    if (roleData && roleData.allowed_pages) {
        allowedPages = roleData.allowed_pages.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!allowedPages.includes("index.html")) allowedPages.push("index.html");
    if (!allowedPages.includes("login.html")) allowedPages.push("login.html");

    // Perbarui cache lokal supaya halaman lain (yang masih baca sessionMutu
    // untuk keperluan filter tampilan/query) tetap dapat data terbaru.
    localStorage.setItem("sessionMutu", JSON.stringify({
        id_user: session.user.id,
        username: session.user.email,
        nama_lengkap: profil.nama_lengkap,
        role: profil.role,
        unit: profil.unit_kerja,
        allowed_pages: allowedPages,
        is_admin: !!(roleData && roleData.is_admin),
        wajib_ganti_password: false
    }));

    // 3. CEK OTORISASI HALAMAN INI
    if (!halamanPublik.includes(currentPage) && !allowedPages.includes(currentPage)) {
        tampilkanPesanAkses(
            'Akses Ditolak!',
            `Anda masuk sebagai <b>${profil.role}</b>.<br>Role Anda tidak memiliki izin untuk membuka halaman ini.`,
            'error',
            'index.html'
        );
    }
}

function tampilkanPesanAkses(judul, pesan, tipe, tujuan) {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: judul,
            html: pesan,
            icon: tipe,
            confirmButtonColor: tipe === 'error' ? '#dc3545' : '#6f42c1',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then(() => {
            window.location.href = tujuan;
        });
    } else {
        alert(pesan.replace(/<[^>]*>/g, ''));
        window.location.href = tujuan;
    }
}

// Halaman yang butuh profil terbaru (unit, role) menunggu janji ini, supaya tidak memakai
// salinan sessionMutu lama di browser (mis. komputer bersama / nama unit sudah diganti).
window.gerbangSiap = new Promise(selesai => {
    document.addEventListener("DOMContentLoaded", () => {
        jagaGerbang().catch(e => console.error('Gagal memeriksa sesi:', e)).finally(() => selesai());
    });
});

// Kalau sesi berakhir/di-logout dari tab lain, ikut redirect di tab ini juga
if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            const currentPage = window.location.pathname.split("/").pop() || "index.html";
            if (!["index.html", "login.html", ""].includes(currentPage)) {
                window.location.href = "login.html";
            }
        }
    });
}

// =====================================================================
// FITUR AUTO-LOGOUT (INACTIVITY TIMEOUT - 30 Menit)
// =====================================================================
// Aktivitas terakhir disimpan bersama untuk semua tab, jadi tab yang menganggur tidak
// me-logout tab lain yang sedang dipakai.
// Logout memakai scope 'local': hanya browser ini. (Bawaan Supabase 'global' mematikan sesi
// akun itu di SEMUA perangkat — perangkat lain lalu tiba-tiba tidak bisa membaca/menyimpan
// data: tabel kosong, "permission denied for function ...".)
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const KUNCI_AKTIVITAS = 'aktivitasTerakhirMutu';
let timeoutTimer;
let aktivitasDicatat = 0;

function resetTimer() {
    clearTimeout(timeoutTimer);
    if (!localStorage.getItem("sessionMutu")) return;
    const kini = Date.now();
    if (kini - aktivitasDicatat > 15000) {
        aktivitasDicatat = kini;
        try { localStorage.setItem(KUNCI_AKTIVITAS, String(kini)); } catch (e) { /* abaikan */ }
    }
    timeoutTimer = setTimeout(autoLogout, INACTIVITY_LIMIT);
}

async function autoLogout() {
    // Tab lain masih aktif dipakai -> tunda
    const terakhir = Number(localStorage.getItem(KUNCI_AKTIVITAS)) || 0;
    const sisa = INACTIVITY_LIMIT - (Date.now() - terakhir);
    if (sisa > 1000) { timeoutTimer = setTimeout(autoLogout, sisa); return; }
    if (supabaseClient) {
        await supabaseClient.auth.signOut({ scope: 'local' }); // hanya sesi di browser ini
    }
    localStorage.removeItem("sessionMutu");
    localStorage.removeItem("menuMutu");
    localStorage.removeItem('editDataIKP');
    localStorage.removeItem('editDataKPC');
    localStorage.removeItem('analisisDataIKP');
    localStorage.removeItem('analisisDataKPC');

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Sesi Berakhir',
            text: 'Anda telah logout otomatis karena tidak ada aktivitas demi keamanan data.',
            icon: 'info',
            confirmButtonColor: '#6f42c1',
            confirmButtonText: 'Login Kembali',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then(() => {
            window.location.href = "login.html";
        });
    } else {
        alert("Sesi Berakhir. Anda telah logout otomatis karena tidak ada aktivitas.");
        window.location.href = "login.html";
    }
}

// Deteksi aktivitas pengguna untuk mereset timer
window.onload = resetTimer;
// capture: true -> tetap terdeteksi walau editor tabel (Handsontable) menahan event
['mousemove', 'mousedown', 'keydown', 'paste', 'touchstart', 'wheel', 'scroll'].forEach(ev =>
    document.addEventListener(ev, resetTimer, { capture: true, passive: true }));
