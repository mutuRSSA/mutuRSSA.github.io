function loadNavigation() {
    // 1. CEK STATUS & ROLE LOGIN
    const sessionStr = localStorage.getItem("sessionMutu");
    const isLoggedIn = sessionStr !== null;
    let userData = null;
    let role = "";
    
    if (isLoggedIn) {
        userData = JSON.parse(sessionStr);
        role = userData.role.trim();
    }

    // MENDAPATKAN NAMA HALAMAN SAAT INI
    const page = window.location.pathname.split("/").pop(); 

    // =========================================================================
    // 2. FRONTEND SECURITY GUARD (PENJAGA PINTU HALAMAN RAHASIA)
    // =========================================================================
    // Menambahkan 'dasbor_budaya.html' ke dalam daftar halaman yang dikunci
    const adminPages = ['daftar_insiden.html', 'analisis.html', 'daftar_kpc.html', 'analisis_kpc.html', 'rekapitulasi.html', 'dasbor_budaya.html'];
    
    // Jika user mencoba mengakses halaman admin tapi dia bukan Komite Mutu (atau belum login)
    if (adminPages.includes(page) && role !== "Komite Mutu") {
        alert("Akses Ditolak! Halaman ini hanya dapat diakses oleh Tim Komite Mutu.");
        window.location.href = isLoggedIn ? "index.html" : "login.html";
        return; // Hentikan eksekusi script agar halaman tidak dimuat
    }

    // =========================================================================
    // 3. SUSUNAN LOGIKA MENU
    // =========================================================================

    // Profil Kanan Atas
    let navbarRightHTML = isLoggedIn 
        ? `<div class="dropdown">
            <button class="btn btn-outline-light btn-sm dropdown-toggle fw-bold border-0" type="button" id="userDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                <i class="fas fa-user-circle fa-lg me-1"></i> ${userData.username}
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow mt-2">
                <li class="px-3 py-2 bg-light border-bottom"><small class="text-muted d-block">Hak Akses:</small><span class="fw-bold text-primary"><i class="fas fa-shield-alt me-1"></i> ${role}</span></li>
                <li><button class="dropdown-item text-danger fw-bold py-2 mt-1" onclick="window.logoutSystem()"><i class="fas fa-sign-out-alt me-2"></i> Logout Sistem</button></li>
            </ul>
           </div>` 
        : `<a href="login.html" class="btn btn-light btn-sm fw-bold text-primary px-3 rounded-pill shadow-sm"><i class="fas fa-sign-in-alt me-1"></i> Login</a>`;

    // Menu Peningkatan Mutu (Terkunci jika belum login)
    let menuMutu = isLoggedIn 
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseMutu" role="button" aria-expanded="false">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseMutu">
                <div class="list-group list-group-flush bg-light">
                    <a href="input_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-input-mutu" style="font-size: 0.95rem;"><i class="fas fa-edit me-2"></i> Input Laporan Mutu</a>
                    <a href="laporan_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-laporan-triwulan" style="font-size: 0.95rem;"><i class="fas fa-file-alt me-2"></i> Laporan Capaian Mutu</a>
                </div>
           </div>`
        : `<a href="#" onclick="alert('Akses Terkunci! Silakan Login terlebih dahulu.'); window.location.href='login.html';" class="list-group-item list-group-item-action py-3 sidebar-link bg-light text-muted">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    // Menu Panel Khusus Komite Mutu (Berdiri Sendiri)
    let menuRahasiaKomite = '';
    if (role === "Komite Mutu") {
        menuRahasiaKomite = `
            <div class="mt-2 mb-1 px-3 text-uppercase text-muted fw-bold" style="font-size: 0.75rem; letter-spacing: 1px;">Ruang Kerja Admin</div>
            <a class="list-group-item list-group-item-action py-3 sidebar-link text-danger fw-bold" data-bs-toggle="collapse" href="#collapseAdmin" role="button" aria-expanded="false">
                <i class="fas fa-user-tie me-3"></i> Panel Komite Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
            </a>
            <div class="collapse" id="collapseAdmin">
                <div class="list-group list-group-flush" style="background-color: #fff5f5;">
                    <a href="daftar_insiden.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-daftar-ikp" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-table me-2"></i> Daftar IKP</a>
                    <a href="daftar_kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-daftar-kpc" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-list-alt me-2"></i> Daftar KPC</a>
                    <a href="rekapitulasi.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-rekap" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-chart-pie me-2"></i> Rekapitulasi IKP dan KPC</a>
                    <a href="dasbor_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-dasbor-budaya" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-spider me-2"></i> Dasbor Budaya Keselamatan</a>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // 4. SUSUN HTML UTAMA NAVBAR & SIDEBAR
    // =========================================================================
    const currentYear = new Date().getFullYear();

    const navbarHTML = `
    <nav class="navbar navbar-dark fixed-top shadow-sm d-print-none" style="background-color: #2c3e50;">
        <div class="container-fluid px-3 d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center">
                <button class="navbar-toggler border-0 me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarMenu" aria-controls="sidebarMenu"><span class="navbar-toggler-icon"></span></button>
                <span class="navbar-brand fw-bold mb-0 d-none d-sm-block">Portal Komite Mutu</span>
                <span class="navbar-brand fw-bold mb-0 d-block d-sm-none">KMKP</span>
            </div>
            <div>${navbarRightHTML}</div>
        </div>
    </nav>`;

    const sidebarHTML = `
    <div class="offcanvas offcanvas-start d-print-none" tabindex="-1" id="sidebarMenu" style="width: 280px;">
        <div class="offcanvas-header text-white" style="background-color: #222d32;">
            <h5 class="offcanvas-title fw-bold">Main Navigation</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
        </div>
        <div class="offcanvas-body p-0 d-flex flex-column" style="background-color: #fff;">
            <div class="list-group list-group-flush mt-2 mb-auto">
                <a href="index.html" class="list-group-item list-group-item-action py-3 sidebar-link" id="menu-home"><i class="fas fa-home me-3 text-secondary"></i> Beranda Utama</a>
                
                ${menuMutu}
                
                <a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseKeselamatan" role="button" aria-expanded="false">
                    <i class="fas fa-user-shield me-3 text-secondary"></i> Keselamatan Pasien <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
                </a>
                <div class="collapse" id="collapseKeselamatan">
                    <div class="list-group list-group-flush bg-light">
                        <a href="ikp.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-ikp" style="font-size: 0.95rem;"><i class="fas fa-file-signature me-2"></i> Formulir IKP</a>
                        <a href="kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-kpc" style="font-size: 0.95rem;"><i class="fas fa-exclamation-circle me-2"></i> Formulir KPC</a>
                        <a href="survey_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-survey-budaya" style="font-size: 0.95rem;"><i class="fas fa-clipboard-list me-2"></i> Kuesioner Budaya (HSPSC)</a>
                    </div>
                </div>

                ${menuRahasiaKomite} 
            </div>
            <div class="mt-4 pt-3 border-top px-3 pb-3 text-center text-muted" style="font-size: 0.8rem;">Sistem Informasi Mutu RS &copy; ${currentYear}</div>
        </div>
    </div>`;

    document.getElementById('navbar-container').innerHTML = navbarHTML;
    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // =========================================================================
    // 5. PENYALAAN WARNA MENU (ACTIVE STATE)
    // =========================================================================
    if (page === 'index.html' || page === '') { 
        document.getElementById('menu-home')?.classList.add('active'); 
    } 
    else if (page === 'input_mutu.html') { 
        document.getElementById('menu-input-mutu')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); 
    } 
    else if (page === 'laporan_mutu.html' || page === 'laporan_triwulan.html') { 
        document.getElementById('menu-laporan-triwulan')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); 
    } 
    else if (page === 'ikp.html') { 
        document.getElementById('menu-ikp')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    } 
    else if (page === 'kpc.html') { 
        document.getElementById('menu-kpc')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    } 
    else if (page === 'survey_budaya.html') { 
        document.getElementById('menu-survey-budaya')?.classList.add('active', 'fw-bold'); document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    }
    // Bagian Menu Panel Admin Mutu
    else if (page === 'daftar_insiden.html' || page === 'analisis.html') { 
        document.getElementById('menu-daftar-ikp')?.classList.add('active', 'fw-bold'); document.getElementById('collapseAdmin')?.classList.add('show'); 
    } 
    else if (page === 'daftar_kpc.html' || page === 'analisis_kpc.html') { 
        document.getElementById('menu-daftar-kpc')?.classList.add('active', 'fw-bold'); document.getElementById('collapseAdmin')?.classList.add('show'); 
    } 
    else if (page === 'rekapitulasi.html') { 
        document.getElementById('menu-rekap')?.classList.add('active', 'fw-bold'); document.getElementById('collapseAdmin')?.classList.add('show'); 
    }
    else if (page === 'dasbor_budaya.html') { 
        document.getElementById('menu-dasbor-budaya')?.classList.add('active', 'fw-bold'); document.getElementById('collapseAdmin')?.classList.add('show'); 
    }
}

window.logoutSystem = function() {
    if(confirm("Apakah Anda yakin ingin keluar dari sistem?")) {
        localStorage.removeItem("sessionMutu");
        window.location.href = "login.html";
    }
};

document.addEventListener("DOMContentLoaded", loadNavigation);