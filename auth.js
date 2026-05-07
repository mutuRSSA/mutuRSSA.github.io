// =====================================================================
// auth.js - PENJAGA GERBANG UTAMA & MANAJEMEN SESI (KEAMANAN)
// =====================================================================

document.addEventListener("DOMContentLoaded", function() {
    const sessionStr = localStorage.getItem("sessionMutu");
    const currentPage = window.location.pathname.split("/").pop();
    
    // 1. CEK AUTENTIKASI: Jika tidak ada data login sama sekali (belum login)
    if (!sessionStr) {
        // Jangan blokir jika dia sedang berada di halaman index (Beranda) atau login
        if (currentPage !== "index.html" && currentPage !== "login.html" && currentPage !== "") {
            
            // Gunakan SweetAlert2 jika tersedia, jika gagal muat gunakan alert biasa
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Akses Terkunci!',
                    text: 'Anda harus login terlebih dahulu untuk mengakses halaman ini.',
                    icon: 'warning',
                    confirmButtonColor: '#6f42c1',
                    confirmButtonText: 'Ke Halaman Login',
                    allowOutsideClick: false,
                    allowEscapeKey: false
                }).then(() => {
                    window.location.href = "login.html";
                });
            } else {
                alert("Akses Terkunci! Anda harus login terlebih dahulu untuk mengakses halaman ini.");
                window.location.href = "login.html";
            }
        }
    }
});

// =====================================================================
// 2. FITUR AUTO-LOGOUT (INACTIVITY TIMEOUT)
// Mencegah penyalahgunaan akun jika petugas lupa logout di komputer ruangan
// =====================================================================

// Pengaturan Waktu Habis: 30 menit (30 * 60 * 1000 milidetik)
const INACTIVITY_LIMIT = 30 * 60 * 1000; 
let timeoutTimer;

function resetTimer() {
    clearTimeout(timeoutTimer);
    // Jika ada sesi login yang aktif, mulai hitung mundur
    if (localStorage.getItem("sessionMutu")) {
        timeoutTimer = setTimeout(autoLogout, INACTIVITY_LIMIT);
    }
}

function autoLogout() {
    // Hapus kredensial dari memori browser
    localStorage.removeItem("sessionMutu");
    localStorage.removeItem("menuMutu");
    
    // Hapus sisa draft form jika ada
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

// Deteksi aktivitas pengguna (gerak mouse, klik, ketik, scroll) untuk mereset timer
window.onload = resetTimer;
document.onmousemove = resetTimer;
document.onkeypress = resetTimer;
document.onclick = resetTimer;
document.onscroll = resetTimer;