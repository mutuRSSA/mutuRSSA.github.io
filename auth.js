// =====================================================================
// auth.js - PENJAGA GERBANG UTAMA (DYNAMIC ROLE-BASED ACCESS CONTROL)
// =====================================================================

document.addEventListener("DOMContentLoaded", function() {
    const sessionStr = localStorage.getItem("sessionMutu");
    const currentPage = window.location.pathname.split("/").pop();
    
    // 1. CEK AUTENTIKASI DASAR (Belum Login Sama Sekali)
    if (!sessionStr) {
        if (currentPage !== "index.html" && currentPage !== "login.html" && currentPage !== "") {
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
                alert("Akses Terkunci! Anda harus login terlebih dahulu.");
                window.location.href = "login.html";
            }
        }
        return; // Hentikan pengecekan jika belum login
    }

    // 2. CEK OTORISASI (Pencocokan Hak Akses Berdasarkan Database)
    const userData = JSON.parse(sessionStr);
    const allowedPages = userData.allowed_pages || [];

    if (currentPage !== "index.html" && currentPage !== "login.html" && currentPage !== "") {
        if (!allowedPages.includes(currentPage)) {
            // Jika halaman yang dibuka TIDAK ADA di dalam daftar izin milik User
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Akses Ditolak!',
                    html: `Anda masuk sebagai <b>${userData.role}</b>.<br>Role Anda tidak memiliki izin untuk membuka halaman ini.`,
                    icon: 'error',
                    confirmButtonColor: '#dc3545',
                    allowOutsideClick: false
                }).then(() => {
                    window.location.href = "index.html"; // Tendang kembali ke beranda
                });
            } else {
                alert(`Akses Ditolak! Role ${userData.role} dilarang membuka halaman ini.`);
                window.location.href = "index.html";
            }
        }
    }
});

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

function autoLogout() {
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