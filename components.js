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

    // 2. LOGIKA KANAN ATAS (Profil/Login)
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

    // 3. LOGIKA PENYEMBUNYIAN MENU RAHASIA
    // Menu di bawah ini HANYA akan digambar (dirender) jika yang login adalah "Komite Mutu"
    let menuRahasiaKomite = '';
    if (role === "Komite Mutu") {
        menuRahasiaKomite = `
            <a href="daftar_insiden.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-daftar-ikp" style="font-size: 0.95rem;"><i class="fas fa-table me-2"></i> Daftar Insiden</a>
            <a href="daftar_kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-daftar-kpc" style="font-size: 0.95rem;"><i class="fas fa-list-alt me-2"></i> Daftar KPC</a>
            <a href="rekapitulasi.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-rekap" style="font-size: 0.95rem;"><i class="fas fa-chart-pie me-2"></i> Rekapitulasi Mutu</a>
        `;
    }

    // Menu Peningkatan Mutu dikunci pakai ikon gembok jika belum login
    let menuMutu = isLoggedIn 
        ? `<a class="list-group-item list-group-item-action py-3 sidebar-link" data-bs-toggle="collapse" href="#collapseMutu" role="button" aria-expanded="false">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-chevron-down float-end mt-1" style="font-size: 0.8rem;"></i>
           </a>
           <div class="collapse" id="collapseMutu">
                <div class="list-group list-group-flush bg-light">
                    <a href="input_mutu.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-input-mutu" style="font-size: 0.95rem;"><i class="fas fa-edit me-2"></i> Input Laporan Mutu</a>
                    <a href="laporan_triwulan.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-laporan-triwulan" style="font-size: 0.95rem;"><i class="fas fa-file-alt me-2"></i> Laporan Triwulan</a>
                </div>
           </div>`
        : `<a href="#" onclick="alert('Akses Terkunci! Silakan Login terlebih dahulu.'); window.location.href='login.html';" class="list-group-item list-group-item-action py-3 sidebar-link">
                <i class="fas fa-chart-line me-3 text-secondary"></i> Peningkatan Mutu <i class="fas fa-lock float-end mt-1 text-danger" style="font-size: 0.8rem;"></i>
           </a>`;

    // 4. SUSUN HTML UTAMA
    const navbarHTML = `
    <nav class="navbar navbar-dark bg-custom-dark fixed-top shadow-sm">
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
    <div class="offcanvas offcanvas-start" tabindex="-1" id="sidebarMenu" style="width: 280px;">
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
                        <a href="ikp.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-ikp" style="font-size: 0.95rem;"><i class="fas fa-file-signature me-2"></i> Laporan IKP</a>
                        <a href="kpc.html" class="list-group-item list-group-item-action py-2 ps-5 sidebar-link" id="menu-kpc" style="font-size: 0.95rem;"><i class="fas fa-exclamation-circle me-2"></i> Laporan KPC</a>
                        ${menuRahasiaKomite} 
                    </div>
                </div>
            </div>
            <div class="mt-4 pt-3 border-top px-3 pb-3 text-center text-muted" style="font-size: 0.8rem;">Sistem Informasi Mutu RS &copy; 2024</div>
        </div>
    </div>`;

    document.getElementById('navbar-container').innerHTML = navbarHTML;
    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // 5. PENYALAAN WARNA MENU (Dengan Tanda Tanya "?" / Optional Chaining agar tidak error)
    const page = window.location.pathname.split("/").pop(); 
    if (page === 'index.html' || page === '') { document.getElementById('menu-home')?.classList.add('active'); } 
    else if (page === 'input_mutu.html') { document.getElementById('menu-input-mutu')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); } 
    else if (page === 'laporan_triwulan.html') { document.getElementById('menu-laporan-triwulan')?.classList.add('active'); document.getElementById('collapseMutu')?.classList.add('show'); } 
    else if (page === 'ikp.html') { document.getElementById('menu-ikp')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'kpc.html') { document.getElementById('menu-kpc')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'daftar_insiden.html' || page === 'analisis.html') { document.getElementById('menu-daftar-ikp')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'daftar_kpc.html' || page === 'analisis_kpc.html') { document.getElementById('menu-daftar-kpc')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); } 
    else if (page === 'rekapitulasi.html') { document.getElementById('menu-rekap')?.classList.add('active'); document.getElementById('collapseKeselamatan')?.classList.add('show'); }
}

window.logoutSystem = function() {
    if(confirm("Apakah Anda yakin ingin keluar dari sistem?")) {
        localStorage.removeItem("sessionMutu");
        window.location.href = "index.html";
    }
};

document.addEventListener("DOMContentLoaded", loadNavigation);