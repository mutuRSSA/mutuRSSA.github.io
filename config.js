// =====================================================================
// config.js - PUSAT KONFIGURASI APLIKASI
// =====================================================================

// 1. KREDENSIAL SUPABASE
// PERBAIKAN: URL cukup sampai .co (TIDAK BOLEH ada /rest/v1/)
const SUPABASE_URL = 'https://ewosnpbpwkwxktakpibn.supabase.co';

// Catatan: Kunci anon (public key) Supabase biasanya diawali dengan huruf "eyJhbG...". 
// Pastikan Anda menyalin dari Project Settings > API > Project API Keys (anon / public).
const SUPABASE_KEY = 'sb_publishable_wwcNE3xansrDq16VWSj56A_LXpgTnQq';

// PERBAIKAN: Ubah nama variabel agar tidak bentrok dengan library bawaan CDN
let supabaseClient;
if (typeof window.supabase !== 'undefined') {
    // cache: 'no-store' -> data selalu diambil langsung dari server, tidak dari cache
    // browser atau proxy/filter internet jaringan RS (bisa menyajikan hasil lama/kosong).
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: (url, opsi = {}) => fetch(url, { ...opsi, cache: 'no-store' }) }
    });
}

// 2. API GOOGLE APPS SCRIPT
const API_CONFIG = {
    MUTU: "https://script.google.com/macros/s/AKfycbxa8AxQhZoKjDLd3Ky3ryy79q6DZ9RkXKS9EyCUTdR27RjwK3gZj8CE-ZyTi-n1dfON/exec",
    IKP: "https://script.google.com/macros/s/AKfycbyPJJlzfUfHyU87IRhetFiEgU83VM-84OYa5AH31DHFFV1JKn_opYjPkzwBlu8nQKVo/exec",
    KPC: "https://script.google.com/macros/s/AKfycbxXgbToxjU7n_IAvLjJe27atbWfG2cNOXRgNSnCNyMXdALGdM8V3wVNXG3dwPjsFkF9/exec",
    SURVEY: "https://script.google.com/macros/s/AKfycbzs7-x6GGX8dMqLgYOXZfNDY3127xbSDEnibba5yM0YcXWiShBWo9Yh1yS9JQrsoEU2/exec",
    RISK: "https://script.google.com/macros/s/AKfycbztzI8Gu1NcLPJgw0xy6lf4mqnmqy31V0FKDcj9ipPy9m84lEJ2-_jSTCzvUjOfud6g9g/exec",
    MENU: "https://script.google.com/macros/s/AKfycbxRcpdb3tnHFWXWVLBzIymqAQnmygkxc_QoRVR43At859Yi6ZwYNkN0mSJaaKa5i4GJ/exec",
    COMPILER: "https://script.google.com/macros/s/AKfycbw3W4HOdLjo0Dz7y-sGLaC2ZXTxf-DcdMrC8ufeSBKZGE0ZpHTPGgRucTj2wJZ50JS_/exec",
    PPI: "https://script.google.com/macros/s/AKfycbw1J8m83-DeYBGpb4mB8-pI1SotM-xSzwbSGlDhUaA0DUGxu2AZTf6BfsYydGPL4XI9/exec"
    // GROQ_API_KEY DIHAPUS DARI SINI — sekarang disimpan sebagai secret di
    // Supabase Edge Function 'generate-laporan-ai', tidak pernah dikirim ke browser.
};

// 3. DOMAIN EMAIL LOGIN
// Petugas cukup mengetik username; aplikasi menambahkan domain ini otomatis.
// Akun dengan email lengkap (mengandung '@') tetap bisa login apa adanya.
const LOGIN_EMAIL_DOMAIN = 'mutu.rssa';

function keEmailLogin(input) {
    const v = String(input || '').trim().toLowerCase().replace(/\s+/g, '.');
    if (!v) return '';
    return v.includes('@') ? v : `${v}@${LOGIN_EMAIL_DOMAIN}`;
}

function keUsernameLogin(email) {
    const v = String(email || '').toLowerCase();
    const akhiran = '@' + LOGIN_EMAIL_DOMAIN;
    return v.endsWith(akhiran) ? v.slice(0, -akhiran.length) : v;
}

// 4. ROLE ADMIN APLIKASI
// Role mana yang "admin" diatur di Manajemen Akun > Panel Otorisasi
// (centang "Role administrator" -> kolom role_permissions.is_admin).
// Nilai yang sama dipakai RLS (mutu_is_admin) dan Edge Function, jadi
// tidak ada lagi daftar role admin yang ditulis di kode.
// Fungsi ini hanya mengatur TAMPILAN (dropdown unit, tombol hapus, dsb);
// keamanan data tetap ditegakkan oleh RLS di database.
function isAdminMutu() {
    try { return (JSON.parse(localStorage.getItem('sessionMutu')) || {}).is_admin === true; }
    catch (_) { return false; }
}

// 5. AMBIL SEMUA BARIS (melewati batas 1.000 baris per request Supabase)
// Supabase/PostgREST hanya mengembalikan maksimal 1.000 baris per query.
// Tanpa paginasi, data di atas itu terpotong DIAM-DIAM (tanpa error).
// Pakai: const rows = await ambilSemuaBaris(() =>
//            supabaseClient.from('tabel').select('*').eq(...).order('id'));
// Wajib ada .order() pada kolom unik agar urutan antar-halaman stabil.
async function ambilSemuaBaris(buatQuery, ukuranHalaman = 1000) {
    const hasil = [];
    for (let dari = 0; ; dari += ukuranHalaman) {
        const { data, error } = await buatQuery().range(dari, dari + ukuranHalaman - 1);
        if (error) throw error;
        const halaman = data || [];
        hasil.push(...halaman);
        if (halaman.length < ukuranHalaman) break;
    }
    return hasil;
}

// Versi yang mengembalikan { data, error } seperti query Supabase biasa,
// jadi kode lama cukup diganti:
//   await supabaseClient.from(...)...            ->
//   await ambilSemua(() => supabaseClient.from(...)....order('<kolom unik>'))
async function ambilSemua(buatQuery, ukuranHalaman = 1000) {
    try { return { data: await ambilSemuaBaris(buatQuery, ukuranHalaman), error: null }; }
    catch (error) { return { data: null, error }; }
}

// 6. PENGAMAN XSS
// Semua teks dari database/pengguna yang dimasukkan ke HTML (innerHTML,
// template string, Swal html) WAJIB lewat esc(). Tanpa ini, isian seperti
// kronologi insiden bisa berisi <script>/<img onerror> yang ikut berjalan
// di browser Komite Mutu (dengan hak admin).
function esc(s) {
    return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

// Untuk teks di DALAM argumen JavaScript pada atribut HTML, misalnya
//   onclick="hapus('${escJsAttr(nama)}')"
// esc() saja tidak cukup (browser men-decode &#39; kembali jadi ' sebelum
// JS dijalankan), jadi di-escape untuk JS dulu, baru untuk HTML.
function escJsAttr(s) {
    const js = String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
        .replace(/\r?\n/g, '\\n').replace(/</g, '\\x3c');
    return esc(js);
}

// 7. IDENTITAS INSTITUSI (tabel pengaturan_institusi) untuk kop & tanda tangan laporan.
// Disimpan 10 menit di sessionStorage agar tidak dimuat ulang tiap halaman.
const INSTITUSI_BAWAAN = { nama_rs: 'RSUD Saras Adyatma', nama_singkat: 'RSUD Saras Adyatma', pemilik: 'Pemerintah Kabupaten Bantul', dinas_induk: 'Dinas Kesehatan', kota: 'Bantul' };
// Logo bawaan bila belum diunggah di Pengaturan Institusi (berkas di folder aplikasi, sumber: img/bantul.png)
const LOGO_BAWAAN_URL = 'img/logo_laporan.png';
async function logoBawaanDataUrl() {
    try {
        const r = await fetch(LOGO_BAWAAN_URL, { cache: 'force-cache' });
        if (!r.ok) return null;
        const b = await r.blob();
        return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
    } catch (e) { return null; }
}
async function ambilInstitusi() {
    try {
        const c = JSON.parse(sessionStorage.getItem('institusiMutu') || 'null');
        if (c && Date.now() - c.waktu < 10 * 60 * 1000) return c.data;
    } catch (e) { /* sessionStorage tidak tersedia */ }
    try {
        const { data } = await supabaseClient.from('pengaturan_institusi').select('*').eq('id', 1).maybeSingle();
        const hasil = { ...INSTITUSI_BAWAAN, ...(data || {}) };
        if (!hasil.logo_data) hasil.logo_data = await logoBawaanDataUrl();
        try { sessionStorage.setItem('institusiMutu', JSON.stringify({ waktu: Date.now(), data: hasil })); } catch (e) {}
        return hasil;
    } catch (e) {
        return { ...INSTITUSI_BAWAAN, logo_data: await logoBawaanDataUrl() };
    }
}

// Kop laporan (HTML, inline style agar ikut tercetak / diekspor ke Word)
function kopLaporanHTML(inst, judul, subjudul) {
    const i = { ...INSTITUSI_BAWAAN, ...(inst || {}) };
    const kontak = [i.alamat, i.telepon ? 'Telp. ' + i.telepon : '', i.email, i.situs_web].filter(Boolean).map(esc).join(' · ');
    return `<table style="width:100%;border-bottom:3px double #000;margin-bottom:12px;border-collapse:collapse"><tr>
        <td style="width:80px;vertical-align:middle;padding:0 8px 6px 0">${i.logo_data ? `<img src="${esc(i.logo_data)}" style="max-width:75px;max-height:75px">` : ''}</td>
        <td style="text-align:center;vertical-align:middle;padding-bottom:6px">
            ${i.pemilik ? `<div style="font-size:13px;letter-spacing:.5px">${esc(String(i.pemilik).toUpperCase())}</div>` : ''}
            ${i.dinas_induk ? `<div style="font-size:13px;letter-spacing:.5px">${esc(String(i.dinas_induk).toUpperCase())}</div>` : ''}
            <div style="font-size:17px;font-weight:bold">${esc(String(i.nama_rs).toUpperCase())}</div>
            ${kontak ? `<div style="font-size:10.5px">${kontak}</div>` : ''}
        </td><td style="width:80px"></td></tr></table>
        ${judul ? `<div style="text-align:center;font-weight:bold;font-size:14px;margin:6px 0 2px">${esc(judul)}</div>` : ''}
        ${subjudul ? `<div style="text-align:center;font-size:12px;margin-bottom:10px">${esc(subjudul)}</div>` : ''}`;
}

// Blok tanda tangan: daftar [{ jabatan, nama, nip }], tanggal opsional (Date / 'YYYY-MM-DD')
function ttdHTML(inst, penanda, tanggal) {
    const i = { ...INSTITUSI_BAWAAN, ...(inst || {}) };
    const t = tanggal ? new Date(String(tanggal).length === 10 ? tanggal + 'T00:00:00' : tanggal) : new Date();
    const tglTeks = `${esc(i.kota || '')}, ${t.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const lebar = Math.floor(100 / Math.max(1, penanda.length));
    return `<table style="width:100%;margin-top:28px;border-collapse:collapse;text-align:center;font-size:12px"><tr>
        ${penanda.map((p, k) => `<td style="width:${lebar}%;vertical-align:top;padding:4px">
            ${k === penanda.length - 1 ? tglTeks : '&nbsp;'}<br>${esc(p.jabatan || '')}<br><br><br><br><br>
            <b><u>${esc(p.nama || '..............................')}</u></b><br>${p.nip ? 'NIP. ' + esc(p.nip) : ''}</td>`).join('')}
    </tr></table>`;
}
