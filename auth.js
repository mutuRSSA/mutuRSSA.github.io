// 1. Ambil tiket masuk dari memori browser
const sessionStr = localStorage.getItem("sessionMutu");
const currentPage = window.location.pathname.split("/").pop(); // Mendapatkan nama file HTML saat ini

// 2. Jika belum login sama sekali
if (!sessionStr) {
    alert("AKSES DITOLAK! Anda harus login untuk membuka halaman ini.");
    window.location.href = "login.html";
} else {
    // 3. Jika sudah login, baca KTP (Role)-nya
    const userData = JSON.parse(sessionStr);
    const role = userData.role.trim();

    // 4. Aturan Khusus untuk KEPALA UNIT
    if (role === "Kepala Unit") {
        // Daftar halaman yang BOLEH diakses Kepala Unit (Selain IKP dan KPC biasa)
        const allowedPages = [
            "laporan_triwulan.html", 
            "input_mutu.html", 
            "ikp.html", 
            "kpc.html", 
            "index.html", 
            "" // root
        ];
        
        // Jika mencoba membuka halaman di luar daftar di atas (seperti rekapitulasi.html)
        if (!allowedPages.includes(currentPage)) {
            alert("AKSES DIBATASI! Halaman ini memuat data rahasia seluruh RS dan hanya dapat diakses oleh Komite Mutu.");
            window.location.href = "index.html"; // Tendang balik ke beranda
        }
    } 
    // 5. Jika role adalah "Komite Mutu", biarkan lewat ke semua halaman (Tidak ada blokir)
    else if (role !== "Komite Mutu") {
        alert("Role tidak dikenali oleh sistem.");
        window.location.href = "login.html";
    }
}