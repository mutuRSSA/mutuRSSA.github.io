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
    const halamanPublik = ["index.html", "login.html", ""];

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
        await supabaseClient.auth.signOut();
        localStorage.removeItem("sessionMutu");
        tampilkanPesanAkses(
            'Sesi Tidak Valid',
            'Profil akun Anda tidak ditemukan atau telah dinonaktifkan.',
            'error',
            'login.html'
        );
        return;
    }

    // Ambil allowed_pages dari role_permissions berdasarkan role user (per-role)
    let allowedPages = [];
    const { data: roleData } = await supabaseClient
        .from('role_permissions')
        .select('allowed_pages')
        .eq('role', profil.role)
        .single();

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
        allowed_pages: allowedPages
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

document.addEventListener("DOMContentLoaded", jagaGerbang);

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
const INACTIVITY_LIMIT = 30 * 60 * 1000;
let timeoutTimer;

function resetTimer() {
    clearTimeout(timeoutTimer);
    if (localStorage.getItem("sessionMutu")) {
        timeoutTimer = setTimeout(autoLogout, INACTIVITY_LIMIT);
    }
}

async function autoLogout() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut(); // mematikan sesi Supabase yang sesungguhnya
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
document.onmousemove = resetTimer;
document.onkeypress = resetTimer;
document.onclick = resetTimer;
document.onscroll = resetTimer;
