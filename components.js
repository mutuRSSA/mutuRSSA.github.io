function loadNavigation() {
    // 1. KODE HTML UNTUK NAVBAR
    const navbarHTML = `
    <nav class="navbar navbar-dark bg-custom-dark fixed-top shadow-sm">
        <div class="container-fluid px-3">
            <button class="navbar-toggler border-0" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarMenu" aria-controls="sidebarMenu">
                <span class="navbar-toggler-icon"></span>
            </button>
            <span class="navbar-brand ms-auto fw-bold mb-0">Komite Mutu</span>
        </div>
    </nav>
    `;

    // 2. KODE HTML UNTUK SIDEBAR
    const sidebarHTML = `
    <div class="offcanvas offcanvas-start" tabindex="-1" id="sidebarMenu" style="width: 280px;">
        <div class="offcanvas-header text-white" style="background-color: #222d32;">
            <h5 class="offcanvas-title fw-bold">Main Navigation</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
        </div>
        <div class="offcanvas-body p-0" style="background-color: #fff;">
            <div class="list-group list-group-flush mt-2">
                
                <a href="peningkatan_mutu.html" class="list-group-item list-group-item-action py-3 sidebar-link" id="menu-mutu">
                    <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu
                </a>
                
                <a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseKeselamatan" role="button" aria-expanded="true">
                    <i class="fas fa-user-shield me-3"></i> Keselamatan Pasien 
                    <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
                </a>
                
                <div class="collapse show" id="collapseKeselamatan">
                    <div class="list-group list-group-flush bg-light">
                        <a href="index.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-ikp" style="font-size: 0.95rem;">
                            <i class="fas fa-file-signature me-2"></i> Laporan IKP
                        </a>
                        <a href="kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-kpc" style="font-size: 0.95rem;">
                            <i class="fas fa-exclamation-circle me-2"></i> Laporan KPC
                        </a>
                        <a href="daftar_insiden.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-daftar-ikp" style="font-size: 0.95rem;">
                            <i class="fas fa-table me-2"></i> Daftar Insiden
                        </a>
                        <a href="daftar_kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-daftar-kpc" style="font-size: 0.95rem;">
                            <i class="fas fa-list-alt me-2"></i> Daftar KPC
                        </a>
                        <a href="rekapitulasi.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-rekap" style="font-size: 0.95rem;">
                            <i class="fas fa-chart-pie me-2"></i> Rekapitulasi
                        </a>
                        
                    </div>
                </div>

                <a href="#" class="list-group-item list-group-item-action py-3 sidebar-link" id="menu-risiko">
                    <i class="fas fa-exclamation-triangle me-3 text-secondary"></i> Manajemen Risiko
                </a>
            </div>
        </div>
    </div>
    `;

    // 3. MASUKKAN KODE KE DALAM HALAMAN
    document.getElementById('navbar-container').innerHTML = navbarHTML;
    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // 4. LOGIKA UNTUK MENYALA-KAN MENU YANG AKTIF SESUAI HALAMAN
    const path = window.location.pathname;
    const page = path.split("/").pop(); // Mengambil nama file, misal "index.html"

    // Mencocokkan nama halaman dengan ID menu
    if (page === 'index.html' || page === '') {
        document.getElementById('menu-ikp').classList.add('active');
    } else if (page === 'kpc.html') {
        document.getElementById('menu-kpc').classList.add('active');
    } else if (page === 'daftar_insiden.html' || page === 'analisis.html') {
        document.getElementById('menu-daftar-ikp').classList.add('active');
    } else if (page === 'daftar_kpc.html' || page === 'analisis_kpc.html') {
        document.getElementById('menu-daftar-kpc').classList.add('active');
    } else if (page === 'rekapitulasi.html') {
        document.getElementById('menu-rekap').classList.add('active');
    } else if (page === 'peningkatan_mutu.html') {
        document.getElementById('menu-mutu').classList.add('active');
    } 
}

// Jalankan fungsi saat halaman web selesai dimuat
document.addEventListener("DOMContentLoaded", loadNavigation);