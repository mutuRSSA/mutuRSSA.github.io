function loadNavigation() {
    // 1. CEK STATUS & ROLE LOGIN
    const sessionStr = localStorage.getItem("sessionMutu");
    const isLoggedIn = sessionStr !== null;
    let userData = null;
    let role = "";
    let unit = "";
    
    if (isLoggedIn) {
        userData = JSON.parse(sessionStr);
        role = userData.role.trim();
        unit = userData.unit;
    }

    const scriptURL = "https://script.google.com/macros/s/AKfycbxRcpdb3tnHFWXWVLBzIymqAQnmygkxc_QoRVR43At859Yi6ZwYNkN0mSJaaKa5i4GJ/exec";
    const page = window.location.pathname.split("/").pop(); 

    // =========================================================================
    // 2. FRONTEND SECURITY GUARD
    // =========================================================================
    const adminPages = ['daftar_insiden.html', 'analisis.html', 'daftar_kpc.html', 'analisis_kpc.html', 'rekapitulasi.html', 'dasbor_budaya.html', 'dasbor_risiko.html', 'profil_risiko_rs.html'];
    
    if (adminPages.includes(page) && role !== "Komite Mutu") {
        alert("Akses Ditolak! Halaman ini hanya dapat diakses oleh Tim Komite Mutu.");
        window.location.href = isLoggedIn ? "index.html" : "login.html";
        return; 
    }

    // =========================================================================
    // 3. SUSUNAN LOGIKA MENU DASAR (Semua Orang Bisa Lihat Wujud Menunya)
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

    // Menu Peningkatan Mutu (Wadah Kosong untuk diisi JS nanti)
    let menuMutu = isLoggedIn 
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseMutu" role="button" aria-expanded="false" id="parent-mutu">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseMutu">
                <div class="list-group list-group-flush bg-light" id="wadahMenuDinamis">
                    <div class="text-center p-2"><i class="fas fa-spinner fa-spin text-muted"></i></div>
                </div>
           </div>`
        : `<a href="#" onclick="alert('Akses Terkunci! Silakan Login terlebih dahulu.'); window.location.href='login.html';" class="list-group-item list-group-item-action py-3 sidebar-link bg-light text-muted">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    // Menu Manajemen Risiko
    let menuRisiko = isLoggedIn
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseRisiko" role="button" aria-expanded="false">
                <i class="fas fa-exclamation-triangle me-3 text-secondary"></i> Manajemen Risiko <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseRisiko">
                <div class="list-group list-group-flush bg-light">
                    <a href="risk_register.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-risk-register" style="font-size: 0.95rem;"><i class="fas fa-clipboard-check me-2"></i> Risk Register Unit</a>
                </div>
           </div>`
        : `<a href="#" onclick="alert('Akses Terkunci! Silakan Login terlebih dahulu.'); window.location.href='login.html';" class="list-group-item list-group-item-action py-3 sidebar-link bg-light text-muted">
                <i class="fas fa-exclamation-triangle me-3 text-secondary"></i> Manajemen Risiko <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

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
                    <a href="rekapitulasi.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-rekap" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-chart-pie me-2"></i> Rekapitulasi Insiden</a>
                    <a href="dasbor_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-dasbor-budaya" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-spider me-2"></i> Analitik Budaya</a>
                    <a href="dasbor_risiko.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-dasbor-risiko" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-satellite-dish me-2"></i> Supervisi Risiko RS</a>
                    <a href="profil_risiko_rs.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link text-danger" id="menu-profil-risiko" style="font-size: 0.95rem; background: transparent;"><i class="fas fa-crown me-2"></i> Profil Risiko RS</a>
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

                ${menuRisiko}
                
                <a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseKeselamatan" role="button" aria-expanded="false">
                    <i class="fas fa-user-shield me-3 text-secondary"></i> Keselamatan Pasien <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
                </a>
                <div class="collapse" id="collapseKeselamatan">
                    <div class="list-group list-group-flush bg-light">
                        <a href="ikp.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-ikp" style="font-size: 0.95rem;"><i class="fas fa-file-signature me-2"></i> Formulir IKP</a>
                        <a href="kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-kpc" style="font-size: 0.95rem;"><i class="fas fa-exclamation-circle me-2"></i> Formulir KPC</a>
                        <a href="survey_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-survey-budaya" style="font-size: 0.95rem;"><i class="fas fa-clipboard-list me-2"></i> Kuesioner Budaya</a>
                    </div>
                </div>

                ${menuRahasiaKomite} 
            </div>
            <div class="mt-4 pt-3 border-top px-3 pb-3 text-center text-muted" style="font-size: 0.8rem;">Husni Muarif &copy; ${currentYear}</div>
        </div>
    </div>`;

    document.getElementById('navbar-container').innerHTML = navbarHTML;
    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // =========================================================================
    // 5. PROSES PENGAMBILAN MENU DINAMIS (SMART CACHE & FILTER ROLE)
    // =========================================================================
    if (isLoggedIn) {
        
        // JIKA YANG LOGIN ADALAH KOMITE MUTU
        if (role === "Komite Mutu") {
            // Komite Mutu HANYA melihat menu Laporan (tanpa form input)
            let htmlSubMenu = `<a href="laporan_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-laporan-triwulan" style="font-size: 0.95rem;"><i class="fas fa-file-alt me-2 text-primary"></i> Laporan Capaian Mutu</a>`;
            const wadah = document.getElementById('wadahMenuDinamis');
            if(wadah) wadah.innerHTML = htmlSubMenu;
            
            if (page === 'laporan_mutu.html') {
                document.getElementById('collapseMutu')?.classList.add('show');
            }
        } 
        // JIKA YANG LOGIN ADALAH UNIT BIASA
        else {
            const renderMenuMutu = function(menuArray) {
                const parentMenu = document.getElementById('parent-mutu');
                if(parentMenu) {
                    parentMenu.addEventListener('click', function(e) {
                         if (e.target.tagName !== 'I') { 
                             window.location.href = `input_mutu.html?form=${menuArray[0]}`;
                         }
                    });
                }

                let htmlSubMenu = '';
                // Render List Form Input
                menuArray.forEach(formID => {
                    let namaForm = formID.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    let activeSub = (new URLSearchParams(window.location.search).get('form') === formID) ? 'active fw-bold' : '';
                    
                    htmlSubMenu += `
                    <a href="input_mutu.html?form=${formID}" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link ${activeSub}" style="font-size: 0.95rem;">
                        <i class="fas fa-edit me-2"></i> Input ${namaForm}
                    </a>`;
                });

                // Tambahkan Menu Laporan di paling bawah
                htmlSubMenu += `<a href="laporan_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-top mt-1" id="menu-laporan-triwulan" style="font-size: 0.95rem;"><i class="fas fa-file-alt me-2 text-primary"></i> Laporan Capaian Mutu</a>`;
                
                const wadah = document.getElementById('wadahMenuDinamis');
                if(wadah) wadah.innerHTML = htmlSubMenu;

                if (page === 'input_mutu.html' || page === 'laporan_mutu.html') {
                    document.getElementById('collapseMutu')?.classList.add('show');
                }
            };

            const cacheMenu = localStorage.getItem("menuMutu");
            
            if (cacheMenu) {
                renderMenuMutu(JSON.parse(cacheMenu));
            } else {
                fetch(`${scriptURL}?action=get_menu&unit=${encodeURIComponent(unit)}`)
                    .then(res => res.json())
                    .then(result => {
                        if (result.status === 'success' && result.menu.length > 0) {
                            localStorage.setItem("menuMutu", JSON.stringify(result.menu));
                            renderMenuMutu(result.menu);
                        }
                    });
            }
        }
    }

    // =========================================================================
    // 6. PENYALAAN WARNA MENU (ACTIVE STATE)
    // =========================================================================
    if (page === 'index.html' || page === '') { 
        document.getElementById('menu-home')?.classList.add('active'); 
    } 
    else if (page === 'laporan_mutu.html') { 
        document.getElementById('menu-laporan-triwulan')?.classList.add('active'); 
        document.getElementById('collapseMutu')?.classList.add('show');
    } 
    else if (page === 'risk_register.html') { 
        document.getElementById('menu-risk-register')?.classList.add('active'); 
        document.getElementById('collapseRisiko')?.classList.add('show'); 
    } 
    else if (page === 'ikp.html') { 
        document.getElementById('menu-ikp')?.classList.add('active'); 
        document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    } 
    else if (page === 'kpc.html') { 
        document.getElementById('menu-kpc')?.classList.add('active'); 
        document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    } 
    else if (page === 'survey_budaya.html') { 
        document.getElementById('menu-survey-budaya')?.classList.add('active'); 
        document.getElementById('collapseKeselamatan')?.classList.add('show'); 
    }
}

window.logoutSystem = function() {
    if(confirm("Apakah Anda yakin ingin keluar dari sistem?")) {
        localStorage.removeItem("sessionMutu");
        localStorage.removeItem("menuMutu");
        window.location.href = "login.html";
    }
};

document.addEventListener("DOMContentLoaded", loadNavigation);