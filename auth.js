// =====================================================================
// auth.js - PENJAGA GERBANG UTAMA (HANYA CEK LOGIN)
// Pengecekan Hak Akses (Role) dipindahkan ke components.js
// =====================================================================

document.addEventListener("DOMContentLoaded", function() {
    const sessionStr = localStorage.getItem("sessionMutu");
    
    // Jika tidak ada data login sama sekali (belum login)
    if (!sessionStr) {
        // Jangan blokir jika dia sedang berada di halaman index (Beranda) atau login
        const currentPage = window.location.pathname.split("/").pop();
        if (currentPage !== "index.html" && currentPage !== "login.html" && currentPage !== "") {
            alert("Akses Terkunci! Anda harus login terlebih dahulu untuk mengakses halaman ini.");
            window.location.href = "login.html";
        }
    }
});