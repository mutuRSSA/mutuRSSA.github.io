// =====================================================================
// components.js - PEMBANGUN ANTARMUKA & NAVIGASI DINAMIS
// =====================================================================

const customCSS = `
<style>
    /* Styling Elegan untuk Sidebar */
    .sidebar-link { transition: all 0.3s ease; border: none; }
    .sidebar-link:hover { background-color: #f8f9fa; transform: translateX(3px); color: #6f42c1 !important; }
    .sidebar-link.active { background-color: #f3f0fc !important; color: #6f42c1 !important; font-weight: bold; border-right: 4px solid #6f42c1; }
    
    /* Styling Khusus Menu Admin */
    .admin-link:hover { background-color: #fff5f5; color: #dc3545 !important; transform: translateX(3px); }
    .admin-link.active { background-color: #ffeaea !important; color: #dc3545 !important; font-weight: bold; border-right: 4px solid #dc3545; }

    /* ATURAN KHUSUS UNTUK LAYAR KECIL (HP / Lebar maksimal 768px) */
    @media (max-width: 768px) {
        body { padding-top: 70px; padding-bottom: 20px; font-size: 0.9rem; }
        .card-custom, .guide-container, .bg-white.p-4 { padding: 15px !important; margin-bottom: 15px !important; }
        h2, h3 { font-size: 1.3rem !important; }
        h4, h5, h6 { font-size: 1.1rem !important; }
        
        .d-flex.justify-content-between.align-items-center,
        .d-flex.justify-content-between.align-items-start { 
            flex-direction: column !important; 
            align-items: stretch !important; 
            gap: 12px; 
        }
        .d-flex.gap-2.flex-wrap { flex-direction: column; width: 100%; }
        .d-flex.gap-2.flex-wrap > button, .d-flex.gap-2.flex-wrap > a { width: 100%; margin-left: 0 !important; margin-right: 0 !important; }
        
        .row > .col-md-3, .row > .col-md-4, .row > .col-md-5, .row > .col-md-6 { width: 100%; margin-top: 10px; }
        .text-md-end { text-align: left !important; }
        
        .dataTables_wrapper .row { flex-direction: column; gap: 10px; }
        .dataTables_wrapper .col-sm-12.col-md-6 { width: 100%; text-align: left !important; }
        .dataTables_filter label { width: 100%; text-align: left !important; font-weight: bold;}
        .dataTables_filter input { width: 100%; margin-left: 0 !important; margin-top: 5px; display: block; box-sizing: border-box;}
        .dataTables_length { margin-bottom: 10px; }
        
        table.dataTable tbody td { padding: 8px 5px !important; font-size: 0.8rem; }
        .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
        
        #userDropdown { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .modal-body { padding: 15px !important; }
        .swal2-popup { font-size: 0.85rem !important; width: 90% !important; padding: 1em !important; }
    }
</style>
`;
document.head.insertAdjacentHTML('beforeend', customCSS);

window.showLockAlert = function() {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Akses Terkunci!',
            text: 'Silakan Login terlebih dahulu untuk mengakses menu ini.',
            icon: 'warning',
            confirmButtonColor: '#6f42c1',
            confirmButtonText: 'Ke Halaman Login'
        }).then(() => { window.location.href = 'login.html'; });
    } else {
        alert('Akses Terkunci! Silakan Login terlebih dahulu.');
        window.location.href = 'login.html';
    }
};

function loadNavigation() {
    const sessionStr = localStorage.getItem("sessionMutu");
    const isLoggedIn = sessionStr !== null;
    let userData = null; let role = ""; let unit = ""; let allowedPages = [];
    
    if (isLoggedIn) {
        userData = JSON.parse(sessionStr);
        role = userData.role.trim();
        unit = userData.unit;
        allowedPages = userData.allowed_pages || [];
    }

    const scriptURL = typeof API_CONFIG !== 'undefined' ? API_CONFIG.MENU : "";
    const page = window.location.pathname.split("/").pop(); 

    // FRONTEND SECURITY GUARD TELAH DIHAPUS. OTORISASI SEPENUHNYA DIAMBIL ALIH OLEH auth.js

    let navbarRightHTML = isLoggedIn 
        ? `<div class="dropdown">
            <button class="btn btn-outline-light btn-sm dropdown-toggle fw-bold border-0" type="button" id="userDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                <i class="fas fa-user-circle fa-lg me-1"></i> ${userData.username}
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow mt-2">
                <li class="px-3 py-2 bg-light border-bottom"><small class="text-muted d-block">Hak Akses:</small><span class="fw-bold text-primary"><i class="fas fa-shield-alt me-1"></i> ${role}</span></li>
                <li class="px-3 py-2 bg-light border-bottom"><small class="text-muted d-block">Unit Tugas:</small><span class="fw-bold text-dark"><i class="fas fa-hospital me-1"></i> ${unit}</span></li>
                <li><button class="dropdown-item text-danger fw-bold py-2 mt-1" onclick="window.logoutSystem()"><i class="fas fa-sign-out-alt me-2"></i> Logout Sistem</button></li>
            </ul>
           </div>` 
        : `<a href="login.html" class="btn btn-light btn-sm fw-bold text-primary px-3 rounded-pill shadow-sm"><i class="fas fa-sign-in-alt me-1"></i> Login</a>`;

    let menuMutu = isLoggedIn 
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseMutu" role="button" aria-expanded="false" id="parent-mutu">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseMutu">
                <div class="list-group list-group-flush bg-light" id="wadahMenuDinamis">
                    <div class="text-center p-2"><i class="fas fa-spinner fa-spin text-muted"></i></div>
                </div>
           </div>`
        : `<a href="#" onclick="window.showLockAlert(); return false;" class="list-group-item list-group-item-action py-3 sidebar-link text-muted">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    let menuRisiko = isLoggedIn && allowedPages.includes("risk_register.html")
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseRisiko" role="button" aria-expanded="false">
                <i class="fas fa-exclamation-triangle me-3 text-secondary"></i> Manajemen Risiko <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseRisiko">
                <div class="list-group list-group-flush bg-light">
                    <a href="risk_register.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-risk-register" style="font-size: 0.95rem;"><i class="fas fa-clipboard-check me-2"></i> Risk Register Unit</a>
                </div>
           </div>`
        : `<a href="#" onclick="window.showLockAlert(); return false;" class="list-group-item list-group-item-action py-3 sidebar-link text-muted">
                <i class="fas fa-exclamation-triangle me-3 text-secondary"></i> Manajemen Risiko <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    let menuPPI = isLoggedIn && allowedPages.includes("dasbor_ppi.html")
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapsePPI" role="button" aria-expanded="false">
                <i class="fas fa-shield-virus me-3 text-secondary"></i> Surveilans PPI <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapsePPI">
                <div class="list-group list-group-flush bg-light">
                    <a href="dasbor_ppi.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-dasbor-ppi" style="font-size: 0.95rem;"><i class="fas fa-chart-bar me-2"></i> Dasbor HAIs & IDO</a>
                </div>
           </div>`
        : `<a href="#" onclick="window.showLockAlert(); return false;" class="list-group-item list-group-item-action py-3 sidebar-link text-muted">
                <i class="fas fa-shield-virus me-3 text-secondary"></i> Surveilans PPI <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    // MENU EKSEKUTIF MUNCUL HANYA JIKA ADA AKSES KE HALAMAN MANAJEMEN AKUN / SUPER ADMIN
    let menuRahasiaKomite = '';
    if (isLoggedIn && allowedPages.includes("manajemen_akun.html")) {
        menuRahasiaKomite = `
            <div class="mt-4 mb-2 px-3 text-uppercase text-muted fw-bold" style="font-size: 0.75rem; letter-spacing: 1px;">Manajemen Eksekutif</div>
            
            <a href="command_center.html" class="list-group-item list-group-item-action py-3 text-white fw-bold shadow-sm" id="menu-command-center" style="background: linear-gradient(135deg, #6f42c1 0%, #4e2a84 100%); border-radius: 8px; margin: 0 15px 10px 15px; border: none;">
                <i class="fas fa-satellite-dish me-2"></i> Command Center
            </a>

            <a class="list-group-item list-group-item-action py-3 sidebar-link text-primary fw-bold" data-bs-toggle="collapse" href="#collapseSystem" role="button" aria-expanded="false">
                <i class="fas fa-cogs me-3"></i> Setup Sistem <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
            </a>
            <div class="collapse" id="collapseSystem">
                <div class="list-group list-group-flush" style="background-color: #fdfdfd;">
                    <a href="manajemen_akun.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-primary border-0" id="menu-manajemen-akun" style="font-size: 0.95rem;"><i class="fas fa-users-cog me-2"></i> Manajemen Akun</a>
                    <a href="super_admin_panel.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-primary border-0 mt-1" id="menu-super-admin" style="font-size: 0.95rem;"><i class="fas fa-hospital me-2"></i> Pengaturan Unit</a>
                    <a href="form_builder.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-primary border-0 mt-1" id="menu-form-builder" style="font-size: 0.95rem;"><i class="fas fa-cubes me-2"></i> Form Builder</a>
                </div>
            </div>

            <a class="list-group-item list-group-item-action py-3 sidebar-link text-danger fw-bold" data-bs-toggle="collapse" href="#collapseAdmin" role="button" aria-expanded="false">
                <i class="fas fa-user-tie me-3"></i> Panel Komite Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
            </a>
            <div class="collapse" id="collapseAdmin">
                <div class="list-group list-group-flush" style="background-color: #fdfdfd;">
                    <a href="dasbor_kepatuhan.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-kepatuhan" style="font-size: 0.95rem;"><i class="fas fa-radar me-2"></i> Dasbor Kepatuhan Unit</a>
                    <a href="dasbor_pdsa.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-dasbor-pdsa" style="font-size: 0.95rem;"><i class="fas fa-tachometer-alt me-2"></i> Dashboard Supervisi PDSA</a>
                    <a href="validasi_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-validasi" style="font-size: 0.95rem;"><i class="fas fa-check-double me-2"></i> Uji Validasi Indikator</a>
                    <a href="laporan_validasi.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-laporan-validasi" style="font-size: 0.95rem;"><i class="fas fa-file-signature me-2"></i> Laporan Validasi Mutu</a>
                    <a href="capa.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-capa" style="font-size: 0.95rem;"><i class="fas fa-bullseye me-2"></i> Pemantauan CAPA</a>
                    <a href="daftar_insiden.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0 mt-1" id="menu-daftar-ikp" style="font-size: 0.95rem;"><i class="fas fa-table me-2"></i> Daftar IKP</a>
                    <a href="daftar_kpc.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-daftar-kpc" style="font-size: 0.95rem;"><i class="fas fa-list-alt me-2"></i> Daftar KPC</a>
                    <a href="rekapitulasi.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-rekap" style="font-size: 0.95rem;"><i class="fas fa-chart-pie me-2"></i> Rekapitulasi Insiden</a>
                    <a href="dasbor_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0 mt-1" id="menu-dasbor-budaya" style="font-size: 0.95rem;"><i class="fas fa-spider me-2"></i> Analitik Budaya</a>
                    
                    <a href="dasbor_risiko.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0 mt-1" id="menu-dasbor-risiko" style="font-size: 0.95rem;"><i class="fas fa-broadcast-tower me-2"></i> Supervisi Risiko RS</a>
                    <a href="profil_risiko_rs.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-profil-risiko" style="font-size: 0.95rem;"><i class="fas fa-crown me-2"></i> Profil Risiko RS</a>
                    <a href="daftar_fmea.html" class="list-group-item list-group-item-action py-2 ps-5 admin-link text-danger border-0" id="menu-daftar-fmea" style="font-size: 0.95rem;"><i class="fas fa-project-diagram me-2"></i> Arsip Proyek FMEA</a>
                </div>
            </div>
        `;
    }

    const currentYear = new Date().getFullYear();

    const navbarHTML = `
    <nav class="navbar navbar-dark fixed-top shadow-sm d-print-none" style="background-color: #2c3e50;">
        <div class="container-fluid px-3 d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center">
                <button class="navbar-toggler border-0 me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarMenu" aria-controls="sidebarMenu"><span class="navbar-toggler-icon"></span></button>
                <span class="navbar-brand fw-bold mb-0 d-none d-sm-block">Portal Komite Mutu</span>
                <span class="navbar-brand fw-bold mb-0 d-block d-sm-none">Portal Mutu</span> 
            </div>
            <div>${navbarRightHTML}</div>
        </div>
    </nav>`;

    const sidebarHTML = `
    <div class="offcanvas offcanvas-start d-print-none" tabindex="-1" id="sidebarMenu" style="width: 280px;">
        <div class="offcanvas-header text-white" style="background-color: #222d32;">
            <h5 class="offcanvas-title fw-bold">Navigasi Utama</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
        </div>
        <div class="offcanvas-body p-0 d-flex flex-column" style="background-color: #fff;">
            <div class="list-group list-group-flush mt-2 mb-auto border-0">
                <a href="index.html" class="list-group-item list-group-item-action py-3 sidebar-link" id="menu-home"><i class="fas fa-home me-3 text-secondary"></i> Beranda Utama</a>
                <a href="buku_panduan.html" class="list-group-item list-group-item-action py-3 sidebar-link" id="menu-panduan"><i class="fas fa-book-open me-3 text-primary"></i> Panduan Penggunaan</a>
                
                ${menuMutu}
                ${menuRisiko}
                ${menuPPI}
                
                <a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseKeselamatan" role="button" aria-expanded="false">
                    <i class="fas fa-user-shield me-3 text-secondary"></i> Keselamatan Pasien <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
                </a>
                <div class="collapse" id="collapseKeselamatan">
                    <div class="list-group list-group-flush bg-light">
                        <a href="ikp.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0" id="menu-ikp" style="font-size: 0.95rem;"><i class="fas fa-file-signature me-2"></i> Formulir IKP</a>
                        <a href="kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0" id="menu-kpc" style="font-size: 0.95rem;"><i class="fas fa-exclamation-circle me-2"></i> Formulir KPC</a>
                        <a href="survey_budaya.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0" id="menu-survey-budaya" style="font-size: 0.95rem;"><i class="fas fa-clipboard-list me-2"></i> Kuesioner Budaya</a>
                    </div>
                </div>

                ${menuRahasiaKomite} 
            </div>
            <div class="mt-4 pt-3 border-top px-3 pb-3 text-center text-muted" style="font-size: 0.8rem;">Husni Muarif &copy; ${currentYear}</div>
        </div>
    </div>`;

    document.getElementById('navbar-container').innerHTML = navbarHTML;
    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // MENU DINAMIS MUTU (MENAMPILKAN HANYA YANG DIIZINKAN)
    if (isLoggedIn) {
        const renderMenuMutu = function(menuArray) {
            const parentMenu = document.getElementById('parent-mutu');
            if(parentMenu) {
                parentMenu.addEventListener('click', function(e) {
                     if (e.target.tagName !== 'I' && menuArray.length > 0) { 
                         window.location.href = `input_mutu.html?form=${menuArray[0]}`;
                     }
                });
            }

            let htmlSubMenu = '';
            
            // Render Menu Input jika diperbolehkan
            if (allowedPages.includes("input_mutu.html")) {
                menuArray.forEach(formID => {
                    let namaForm = formID.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    let activeSub = (new URLSearchParams(window.location.search).get('form') === formID) ? 'active fw-bold' : '';
                    
                    htmlSubMenu += `
                    <a href="input_mutu.html?form=${formID}" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0 ${activeSub}" style="font-size: 0.95rem;">
                        <i class="fas fa-edit me-2"></i> Input ${namaForm}
                    </a>`;
                });
            }

            if (allowedPages.includes("profil_indikator.html")) {
                htmlSubMenu += `<a href="profil_indikator.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-top mt-1" id="menu-kamus-indikator" style="font-size: 0.95rem;"><i class="fas fa-book-medical me-2 text-primary"></i> Kamus Indikator Mutu</a>`;
            }
            if (allowedPages.includes("pdsa.html")) {
                htmlSubMenu += `<a href="pdsa.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0" id="menu-pdsa" style="font-size: 0.95rem;"><i class="fas fa-tasks me-2 text-warning"></i> Papan Kerja PDSA</a>`;
            }
            if (allowedPages.includes("laporan_mutu.html")) {
                htmlSubMenu += `<a href="laporan_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link border-0" id="menu-laporan-triwulan" style="font-size: 0.95rem;"><i class="fas fa-chart-pie me-2 text-success"></i> Laporan Capaian Mutu</a>`;
            }
            
            const wadah = document.getElementById('wadahMenuDinamis');
            if(wadah) wadah.innerHTML = htmlSubMenu;
        };

        const cacheMenu = localStorage.getItem("menuMutu");
        
        if (cacheMenu) {
            renderMenuMutu(JSON.parse(cacheMenu));
        } else if (scriptURL !== "") {
            fetch(`${scriptURL}?action=get_menu&unit=${encodeURIComponent(unit)}`)
                .then(res => res.json())
                .then(result => {
                    if (result.status === 'success' && result.menu.length > 0) {
                        localStorage.setItem("menuMutu", JSON.stringify(result.menu));
                        renderMenuMutu(result.menu);
                    } else {
                        renderMenuMutu([]); // Render menu kosong jika unit tidak punya form
                    }
                });
        }
    }

    // =========================================================================
    // 6. PENYALAAN WARNA MENU (ACTIVE STATE)
    // =========================================================================
    if (page === 'index.html' || page === '') { document.getElementById('menu-home')?.classList.add('active'); } 
    else if (page === 'command_center.html') { document.getElementById('menu-command-center')?.classList.add('active'); } 
    else if (page === 'buku_panduan.html') { document.getElementById('menu-panduan')?.classList.add('active'); }
    else if (page === 'profil_indikator.html') { document.getElementById('menu-kamus-indikator')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); }
    else if (page === 'pdsa.html') { document.getElementById('menu-pdsa')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); }
    else if (page === 'laporan_mutu.html') { document.getElementById('menu-laporan-triwulan')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); }
    else if (page === 'input_mutu.html') { document.getElementById('collapseMutu')?.classList.add('show'); }
    
    else if (page === 'risk_register.html') { document.getElementById('menu-risk-register')?.classList.add('active'); document.getElementById('collapseRisiko')?.classList.add('show'); } 
    
    else if (page === 'dasbor_ppi.html') { document.getElementById('menu-dasbor-ppi')?.classList.add('active'); document.getElementById('collapsePPI')?.classList.add('show'); } 
    
    else if (page === 'ikp.html') { document.getElementById('menu-ikp')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'kpc.html') { document.getElementById('menu-kpc')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'survey_budaya.html') { document.getElementById('menu-survey-budaya')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); }
    
    else if (page === 'super_admin_panel.html') { document.getElementById('menu-super-admin')?.classList.add('active'); document.getElementById('collapseSystem')?.classList.add('show'); }
    else if (page === 'form_builder.html') { document.getElementById('menu-form-builder')?.classList.add('active'); document.getElementById('collapseSystem')?.classList.add('show'); }
    else if (page === 'validasi_mutu.html') { document.getElementById('menu-validasi')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'laporan_validasi.html') { document.getElementById('menu-laporan-validasi')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'manajemen_akun.html') { document.getElementById('menu-manajemen-akun')?.classList.add('active'); document.getElementById('collapseSystem')?.classList.add('show'); }
    
    else if (page === 'dasbor_kepatuhan.html') { document.getElementById('menu-kepatuhan')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'dasbor_pdsa.html') { document.getElementById('menu-dasbor-pdsa')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'capa.html') { document.getElementById('menu-capa')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'daftar_insiden.html') { document.getElementById('menu-daftar-ikp')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'daftar_kpc.html') { document.getElementById('menu-daftar-kpc')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'rekapitulasi.html') { document.getElementById('menu-rekap')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'dasbor_budaya.html') { document.getElementById('menu-dasbor-budaya')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'dasbor_risiko.html') { document.getElementById('menu-dasbor-risiko')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'profil_risiko_rs.html') { document.getElementById('menu-profil-risiko')?.classList.add('active'); document.getElementById('collapseAdmin')?.classList.add('show'); }
    else if (page === 'daftar_fmea.html' || page === 'fmea_builder.html') { 
        let menuElem = document.getElementById('menu-daftar-fmea');
        if (menuElem) menuElem.classList.add('active'); 
        let collapseElem = document.getElementById('collapseAdmin');
        if (collapseElem) collapseElem.classList.add('show'); 
    }
}

// Fungsi Keluar Sistem
window.logoutSystem = function() {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Keluar Sistem?',
            text: "Apakah Anda yakin ingin mengakhiri sesi dan keluar dari sistem?",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Ya, Logout',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                localStorage.clear(); 
                window.location.href = "login.html";
            }
        });
    } else {
        if(confirm("Apakah Anda yakin ingin keluar dari sistem?")) {
            localStorage.clear();
            window.location.href = "login.html";
        }
    }
};

document.addEventListener("DOMContentLoaded", loadNavigation);