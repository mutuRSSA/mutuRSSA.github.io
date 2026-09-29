// =====================================================================
// laporan_grafik.js — grafik statis (PNG) untuk dokumen Word laporan.
// Digambar langsung dengan Canvas 2D (tanpa pustaka) agar hasilnya sama
// di semua komputer dan tercetak jelas: garis tipis, grid samar, label
// nilai selektif, legenda bila > 1 seri. Warna mengikuti palet kategori
// tetap (urutan tidak diputar) dan warna status/grading yang sudah dikenal RS.
// =====================================================================

const LG_SERI = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const LG_STATUS = { baik: '#0ca30c', waspada: '#fab219', serius: '#ec835a', kritis: '#d03b3b' };
// Warna grading/tingkat risiko sesuai konvensi RS (selalu disertai label)
const LG_GRADING = { Merah: '#d03b3b', Kuning: '#fab219', Hijau: '#0ca30c', Biru: '#2a78d6',
                     Ekstrem: '#d03b3b', Tinggi: '#fab219', Moderat: '#0ca30c', Rendah: '#2a78d6' };
const LG_TEKS = '#0b0b0b', LG_TEKS2 = '#52514e', LG_GRID = '#e4e3df', LG_SUMBU = '#b9b8b2', LG_NETRAL = '#8a8984';
const LG_FONT = '"Segoe UI", Arial, Helvetica, sans-serif';

function lgKanvas(lebar, tinggi) {
    const skala = 2;
    const c = document.createElement('canvas');
    c.width = lebar * skala; c.height = tinggi * skala;
    const g = c.getContext('2d'); g.scale(skala, skala);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, lebar, tinggi);
    g.textBaseline = 'middle';
    return { c, g, lebar, tinggi };
}
function lgSelesai(k) {
    const url = k.c.toDataURL('image/png');
    const bin = atob(url.split(',')[1]); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { dataUrl: url, bytes: u8, lebar: k.lebar, tinggi: k.tinggi };
}
function lgFmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '';
    const a = Math.abs(v);
    return (a >= 100 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100).toLocaleString('id-ID');
}
function lgSkala(min, maks, jumlah = 5) {
    if (min === maks) { maks = min + 1; }
    const kasar = (maks - min) / jumlah;
    const p = Math.pow(10, Math.floor(Math.log10(kasar)));
    const langkah = [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= kasar) || kasar;
    const bawah = Math.floor(min / langkah) * langkah, atas = Math.ceil(maks / langkah) * langkah;
    const tik = []; for (let v = bawah; v <= atas + langkah / 2; v += langkah) tik.push(Math.round(v * 1e6) / 1e6);
    return { bawah, atas, tik };
}
function lgTeks(g, teks, x, y, o = {}) {
    g.font = `${o.tebal ? '600 ' : ''}${o.ukuran || 11}px ${LG_FONT}`;
    g.fillStyle = o.warna || LG_TEKS2; g.textAlign = o.rata || 'left';
    g.fillText(teks, x, y);
}
function lgPotong(g, teks, maks) {
    let t = String(teks);
    if (g.measureText(t).width <= maks) return t;
    while (t.length > 3 && g.measureText(t + '…').width > maks) t = t.slice(0, -1);
    return t + '…';
}
function lgLegenda(g, seri, x, y, lebarMaks) {
    let cx = x;
    g.font = `11px ${LG_FONT}`;
    seri.forEach(s => {
        const w = 22 + g.measureText(s.nama).width + 16;
        if (cx + w > x + lebarMaks) { cx = x; y += 18; }
        if (s.putus) { g.strokeStyle = s.warna; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + 16, y); g.stroke(); g.setLineDash([]); }
        else { g.fillStyle = s.warna; lgKotak(g, cx, y - 5, 16, 10, 2); g.fill(); }
        lgTeks(g, s.nama, cx + 22, y, { warna: LG_TEKS });
        cx += w;
    });
    return y + 18;
}
function lgKotak(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
// Batang dengan ujung data membulat, pangkal rata di garis dasar
function lgBatangBulat(g, x, y, w, h, arah) {
    const r = Math.min(4, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath();
    if (arah === 'atas') { g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h); }
    else { g.moveTo(x, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x, y + h); }
    g.closePath();
}

/**
 * Grafik garis: tren bulanan (capaian vs target).
 * opsi: { label[], seri:[{nama, data[], warna, putus}], satuan, lebar, tinggi, judul }
 */
function lgGaris(opsi) {
    const L = opsi.lebar || 560, T = opsi.tinggi || 250;
    const k = lgKanvas(L, T), g = k.g;
    const seri = opsi.seri.filter(s => s.data.some(v => v !== null && v !== undefined));
    const semua = seri.flatMap(s => s.data).filter(v => v !== null && v !== undefined && !isNaN(v));
    let judulY = 0;
    if (opsi.judul) { lgTeks(g, lgPotong(g, opsi.judul, L - 20), 10, 14, { tebal: true, ukuran: 12, warna: LG_TEKS }); judulY = 22; }
    if (!semua.length) { lgTeks(g, 'Belum ada data', L / 2, T / 2, { rata: 'center' }); return lgSelesai(k); }
    let mn = Math.min(...semua), mx = Math.max(...semua);
    const pad = (mx - mn) * 0.15 || Math.abs(mx) * 0.1 || 1;
    mn = mn - pad < 0 && mn >= 0 ? 0 : mn - pad; mx = mx + pad;
    if (opsi.satuan && /%/.test(opsi.satuan) && mx > 100 && Math.max(...semua) <= 100) mx = 100;
    const sk = lgSkala(mn, mx, 4);
    const kiri = 46, kanan = L - 16, atas = 10 + judulY, bawahLeg = seri.length > 1 ? 24 : 0, bawah = T - 26 - bawahLeg;
    const inset = 34; // ruang label di ujung sumbu
    const X = i => kiri + inset + (opsi.label.length === 1 ? (kanan - kiri - 2 * inset) / 2 : i * (kanan - kiri - 2 * inset) / (opsi.label.length - 1));
    const Y = v => bawah - (v - sk.bawah) / (sk.atas - sk.bawah) * (bawah - atas);
    // grid & sumbu
    g.lineWidth = 1;
    sk.tik.forEach(t => { g.strokeStyle = LG_GRID; g.beginPath(); g.moveTo(kiri, Y(t)); g.lineTo(kanan, Y(t)); g.stroke(); lgTeks(g, lgFmt(t), kiri - 6, Y(t), { rata: 'right', ukuran: 10 }); });
    opsi.label.forEach((l, i) => lgTeks(g, l, X(i), bawah + 14, { rata: 'center', ukuran: 10 }));
    // seri
    seri.forEach(s => {
        g.strokeStyle = s.warna; g.lineWidth = 2; g.setLineDash(s.putus ? [6, 4] : []);
        g.beginPath(); let mulai = false;
        s.data.forEach((v, i) => { if (v === null || v === undefined) { mulai = false; return; } if (!mulai) { g.moveTo(X(i), Y(v)); mulai = true; } else g.lineTo(X(i), Y(v)); });
        g.stroke(); g.setLineDash([]);
        if (!s.putus) s.data.forEach((v, i) => {
            if (v === null || v === undefined) return;
            g.beginPath(); g.arc(X(i), Y(v), 4.5, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
            g.beginPath(); g.arc(X(i), Y(v), 3.5, 0, Math.PI * 2); g.fillStyle = s.warna; g.fill();
        });
    });
    // label nilai selektif: titik terakhir seri utama & label target di kanan
    const utama = seri.find(s => !s.putus);
    if (utama) {
        const i = utama.data.map((v, j) => v === null || v === undefined ? -1 : j).filter(j => j >= 0).pop();
        if (i !== undefined) lgTeks(g, lgFmt(utama.data[i]), X(i), Y(utama.data[i]) - 12, { rata: 'center', warna: LG_TEKS, tebal: true, ukuran: 11 });
    }
    if (seri.length > 1) lgLegenda(g, seri, kiri, T - 12, kanan - kiri);
    return lgSelesai(k);
}

/**
 * Grafik batang (vertikal/horizontal, bertumpuk atau berkelompok).
 * opsi: { label[], seri:[{nama, data[], warna}], tumpuk, horizontal, garisRef:{nilai,label}, lebar, tinggi, judul, labelNilai, maks }
 */
function lgBatang(opsi) {
    const hor = !!opsi.horizontal;
    const n = opsi.label.length;
    const L = opsi.lebar || 560, T = opsi.tinggi || (hor ? Math.max(140, 30 + n * 26) : 260);
    const k = lgKanvas(L, T), g = k.g;
    const seri = opsi.seri;
    let judulY = 0;
    if (opsi.judul) { lgTeks(g, lgPotong(g, opsi.judul, L - 20), 10, 14, { tebal: true, ukuran: 12, warna: LG_TEKS }); judulY = 22; }
    const total = opsi.label.map((_, i) => opsi.tumpuk ? seri.reduce((a, s) => a + (Number(s.data[i]) || 0), 0) : Math.max(0, ...seri.map(s => Number(s.data[i]) || 0)));
    const maks = opsi.maks || Math.max(1, ...total, opsi.garisRef ? opsi.garisRef.nilai : 0);
    const sk = lgSkala(0, opsi.bulat ? Math.max(maks, 4) : maks, 4);
    if (opsi.bulat && sk.tik.some(t => !Number.isInteger(t))) { const l = Math.max(1, Math.ceil(sk.atas / 4)); sk.tik = []; for (let v = 0; v <= Math.ceil(maks / l) * l; v += l) sk.tik.push(v); sk.atas = sk.tik[sk.tik.length - 1]; }
    const legH = seri.length > 1 ? 24 : 0;
    g.font = `10px ${LG_FONT}`;
    const lebarLabel = hor ? Math.min(210, Math.max(...opsi.label.map(l => g.measureText(l).width)) + 10) : 0;
    const kiri = hor ? 10 + lebarLabel : 40, kanan = L - (hor ? 36 : 12), atas = 10 + judulY, bawah = T - (hor ? 20 : 30) - legH;
    const pos = v => hor ? kiri + v / sk.atas * (kanan - kiri) : bawah - v / sk.atas * (bawah - atas);
    // grid
    g.lineWidth = 1;
    sk.tik.forEach(t => {
        g.strokeStyle = LG_GRID; g.beginPath();
        if (hor) { g.moveTo(pos(t), atas); g.lineTo(pos(t), bawah); g.stroke(); lgTeks(g, lgFmt(t), pos(t), bawah + 10, { rata: 'center', ukuran: 10 }); }
        else { g.moveTo(kiri, pos(t)); g.lineTo(kanan, pos(t)); g.stroke(); lgTeks(g, lgFmt(t), kiri - 6, pos(t), { rata: 'right', ukuran: 10 }); }
    });
    const pita = (hor ? (bawah - atas) : (kanan - kiri)) / n;
    const kelompok = opsi.tumpuk ? 1 : seri.length;
    const tebal = Math.min(hor ? 16 : 34, pita * 0.7 / kelompok);
    opsi.label.forEach((lbl, i) => {
        const pusat = (hor ? atas : kiri) + pita * (i + 0.5);
        if (hor) lgTeks(g, lgPotong(g, lbl, lebarLabel - 8), kiri - 8, pusat, { rata: 'right', ukuran: 10, warna: LG_TEKS });
        else lgTeks(g, lgPotong(g, lbl, pita - 4), pusat, bawah + 14, { rata: 'center', ukuran: 10 });
        let dasar = 0;
        seri.forEach((s, j) => {
            const v = Number(s.data[i]) || 0;
            if (v <= 0) return;
            const off = opsi.tumpuk ? 0 : (j - (kelompok - 1) / 2) * (tebal + 2);
            const w = pos(dasar + v) - pos(dasar);
            g.fillStyle = (s.warnaPer && s.warnaPer[i]) || s.warna;
            if (hor) { lgBatangBulat(g, pos(dasar) + (dasar ? 1 : 0), pusat - tebal / 2 + off, Math.max(1, w - (dasar ? 1 : 0)), tebal, 'kanan'); }
            else { lgBatangBulat(g, pusat - tebal / 2 + off, pos(dasar + v), tebal, Math.max(1, pos(dasar) - pos(dasar + v) - (dasar ? 1 : 0)), 'atas'); }
            g.fill();
            if (opsi.tumpuk) dasar += v;
            else if (opsi.labelNilai !== false) {
                if (hor) lgTeks(g, lgFmt(v), pos(v) + 4, pusat + off, { warna: LG_TEKS, ukuran: 10 });
                else lgTeks(g, lgFmt(v), pusat + off, pos(v) - 8, { rata: 'center', warna: LG_TEKS, ukuran: 10 });
            }
        });
        if (opsi.tumpuk && opsi.labelNilai !== false && total[i] > 0) {
            if (hor) lgTeks(g, lgFmt(total[i]), pos(total[i]) + 4, pusat, { warna: LG_TEKS, ukuran: 10, tebal: true });
            else lgTeks(g, lgFmt(total[i]), pusat, pos(total[i]) - 8, { rata: 'center', warna: LG_TEKS, ukuran: 10, tebal: true });
        }
    });
    if (opsi.garisRef) {
        const r = pos(opsi.garisRef.nilai);
        g.strokeStyle = LG_NETRAL; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath();
        if (hor) { g.moveTo(r, atas - 4); g.lineTo(r, bawah); } else { g.moveTo(kiri, r); g.lineTo(kanan, r); }
        g.stroke(); g.setLineDash([]);
        if (opsi.garisRef.label) hor ? lgTeks(g, opsi.garisRef.label, r + 3, atas - 2, { ukuran: 10, warna: LG_TEKS2 }) : lgTeks(g, opsi.garisRef.label, kanan, r - 8, { rata: 'right', ukuran: 10 });
    }
    // garis dasar
    g.strokeStyle = LG_SUMBU; g.lineWidth = 1; g.beginPath();
    if (hor) { g.moveTo(kiri, atas); g.lineTo(kiri, bawah); } else { g.moveTo(kiri, bawah); g.lineTo(kanan, bawah); }
    g.stroke();
    if (seri.length > 1) lgLegenda(g, seri, hor ? 10 : kiri, T - 12, L - 20);
    return lgSelesai(k);
}

if (typeof module !== 'undefined') module.exports = { lgGaris, lgBatang, LG_SERI, LG_STATUS, LG_GRADING };
