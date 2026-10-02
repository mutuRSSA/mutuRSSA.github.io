// =====================================================================
// laporan_mutu_docx.js — ekspor Word (.docx) Dasbor Capaian Mutu
// (laporan_mutu.html). Isi dokumen sama dengan versi cetak/PDF:
// kop, ringkasan, tabel per kategori, IMP-Unit per unit, grafik tren,
// daftar indikator tidak mencapai target, tanda tangan.
// Butuh: docx (window.docx, v9), laporan_docx.js, Chart.js.
// Data diambil dari window.__cetakMutu yang diisi laporan_mutu.html.
// =====================================================================

const LMD_LEBAR = 16838 - 2 * 1417;   // lebar isi A4 lanskap (DXA), margin 2,5 cm
const LMD_MERAH = 'F8D7DA';

function lmdAngka(v) {
    if (v === null || v === undefined || String(v).trim() === '') return '-';
    const n = Number(v);
    return isNaN(n) ? String(v) : n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
const lmdND = v => (v === null || v === undefined || v === '' || Number(v) === 0) ? '-' : lmdAngka(v);
const lmdSingkatBulan = b => String(b).slice(0, 3);

function lmdSel(teks, o = {}) {
    const { TableCell, Paragraph, WidthType, ShadingType, AlignmentType, VerticalAlign } = ldDocx();
    const baris = String(teks ?? '').split('\n');
    return new TableCell({
        width: { size: o.w, type: WidthType.DXA }, columnSpan: o.span, rowSpan: o.rowSpan,
        verticalAlign: VerticalAlign.CENTER, margins: { top: 30, bottom: 30, left: 60, right: 60 },
        shading: o.isi ? { fill: o.isi, type: ShadingType.CLEAR, color: 'auto' } : undefined,
        children: baris.map((t, i) => new Paragraph({
            alignment: o.kiri ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { after: 0, line: 240 },
            children: [ldTeks(t, { tebal: o.tebal && i === 0, ukuran: i ? (o.ukuran || 16) - 2 : (o.ukuran || 16), warna: i ? '555555' : o.warna })] }))
    });
}

// Target terakhir yang terisi pada rentang bulan (dipakai di tabel ringkas)
function lmdTargetTerakhir(item, namaBulan) {
    let t = null;
    namaBulan.forEach(b => { if (item.bulans[b].target !== null && item.bulans[b].target !== undefined) t = item.bulans[b].target; });
    return t;
}

/**
 * Tabel capaian. daftar: [{ judul, satuan, bulans }].
 * <= 3 bulan: per bulan kolom Tgt | N | D | Cpa (sama dengan tampilan layar).
 * > 3 bulan : satu kolom per bulan berisi capaian dan N/D, plus kolom Target.
 */
function lmdTabelCapaian(daftar, namaBulan, cekFn) {
    const { Table, TableRow, WidthType } = ldDocx();
    const ringkas = namaBulan.length > 3;
    const perBulan = ringkas ? 1 : 4;
    const nKol = namaBulan.length * perBulan;
    const wNo = 520, wSat = 760, wTgt = ringkas ? 760 : 0;
    const wInd = ringkas ? 3200 : namaBulan.length === 1 ? 6200 : 3800;
    const wKol = Math.floor((LMD_LEBAR - wNo - wInd - wSat - wTgt) / nKol);
    const lebar = [wNo, wInd, wSat, ...(ringkas ? [wTgt] : []), ...Array(nKol).fill(wKol)];
    lebar[lebar.length - 1] += LMD_LEBAR - lebar.reduce((a, b) => a + b, 0);
    const uk = ringkas ? 14 : 16;
    const H = { isi: LD_WARNA_HEADER, tebal: true, ukuran: uk };
    const kolBulan = j => lebar[(ringkas ? 4 : 3) + j];

    const kepala = [];
    if (ringkas) {
        kepala.push(new TableRow({ tableHeader: true, cantSplit: true, children: [
            lmdSel('No', { ...H, w: wNo }), lmdSel('Indikator', { ...H, w: wInd }), lmdSel('Satuan', { ...H, w: wSat }), lmdSel('Target', { ...H, w: wTgt }),
            ...namaBulan.map((b, j) => lmdSel(lmdSingkatBulan(b), { ...H, w: kolBulan(j) }))] }));
    } else {
        kepala.push(new TableRow({ tableHeader: true, cantSplit: true, children: [
            lmdSel('No', { ...H, w: wNo, rowSpan: 2 }), lmdSel('Indikator', { ...H, w: wInd, rowSpan: 2 }), lmdSel('Satuan', { ...H, w: wSat, rowSpan: 2 }),
            ...namaBulan.map(b => lmdSel(b, { ...H, w: wKol * 4, span: 4 }))] }));
        kepala.push(new TableRow({ tableHeader: true, cantSplit: true, children:
            namaBulan.flatMap(() => ['Tgt', 'N', 'D', 'Cpa'].map(t => lmdSel(t, { ...H, w: wKol }))) }));
    }

    const isi = daftar.map((item, i) => {
        const sel = [lmdSel(i + 1, { w: wNo, ukuran: uk }), lmdSel(item.judul, { w: wInd, kiri: true, tebal: true, ukuran: uk }), lmdSel(item.satuan || '', { w: wSat, ukuran: uk })];
        if (ringkas) sel.push(lmdSel(lmdAngka(lmdTargetTerakhir(item, namaBulan)), { w: wTgt, ukuran: uk }));
        namaBulan.forEach((b, j) => {
            const x = item.bulans[b] || {};
            const kosong = x.target === null || x.target === undefined || x.capai === null || x.capai === undefined;
            const ok = kosong ? null : cekFn(item.judul, x.capai, x.target);
            const gaya = kosong ? { warna: '888888' } : ok ? { warna: '0B7A0B', tebal: true } : { warna: 'B42318', tebal: true, isi: LMD_MERAH };
            if (ringkas) {
                sel.push(lmdSel(kosong ? '-' : `${lmdAngka(x.capai)}\n${lmdND(x.num)}/${lmdND(x.den)}`, { w: kolBulan(j), ukuran: uk, ...gaya }));
            } else if (kosong) {
                for (let k = 0; k < 4; k++) sel.push(lmdSel('-', { w: wKol, ukuran: uk, warna: '888888' }));
            } else {
                sel.push(lmdSel(lmdAngka(x.target), { w: wKol, ukuran: uk, warna: '555555' }), lmdSel(lmdND(x.num), { w: wKol, ukuran: uk }),
                         lmdSel(lmdND(x.den), { w: wKol, ukuran: uk }), lmdSel(lmdAngka(x.capai), { w: wKol, ukuran: uk, ...gaya }));
            }
        });
        return new TableRow({ cantSplit: true, children: sel });
    });

    return [new Table({ width: { size: LMD_LEBAR, type: WidthType.DXA }, columnWidths: lebar, rows: [...kepala, ...isi] }), ldP('', { setelah: 120 })];
}

// Grafik dibuat ulang di kanvas tersembunyi (grafik di akordeon tertutup berukuran 0 di layar)
async function lmdGambarGrafik(conf) {
    const wadah = document.createElement('div');
    wadah.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:380px;';
    const kanvas = document.createElement('canvas'); kanvas.width = 900; kanvas.height = 380;
    wadah.appendChild(kanvas); document.body.appendChild(wadah);
    let grafik = null;
    try {
        const persen = String(conf.satuan || '').includes('%');
        grafik = new Chart(kanvas.getContext('2d'), {
            type: 'line',
            data: { labels: conf.labels, datasets: [
                { label: 'Target', data: conf.target, borderColor: '#dc3545', borderDash: [5, 5], fill: false, tension: 0, datalabels: { display: false } },
                { label: 'Pencapaian', data: conf.capai, borderColor: '#0dcaf0', backgroundColor: 'rgba(13,202,240,0.1)', fill: true, tension: 0.3, pointRadius: 5,
                  datalabels: { display: true, align: 'top', anchor: 'end', color: '#0c63e4', font: { weight: 'bold', size: 13 }, formatter: v => v === null ? '' : v + (persen ? '%' : '') } }] },
            options: { responsive: false, animation: false, devicePixelRatio: 2, layout: { padding: { top: 25, right: 15 } },
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { position: 'bottom' }, title: { display: true, text: conf.judul, font: { size: 15, weight: 'bold' } } } },
            plugins: [{ id: 'latarPutih', beforeDraw(c) { const x = c.ctx; x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } }]
        });
        return ldBytesDataUrl(grafik.toBase64Image('image/png', 1));
    } catch (e) {
        console.warn('Grafik gagal dibuat untuk Word:', conf.judul, e);
        return null;
    } finally {
        if (grafik) grafik.destroy();
        wadah.remove();
    }
}

// Grafik dua per baris (tabel tanpa garis)
async function lmdBlokGrafik(daftarConf) {
    const { Table, TableRow, TableCell, Paragraph, ImageRun, WidthType, AlignmentType } = ldDocx();
    if (!daftarConf.length) return [];
    const gambar = [];
    for (const c of daftarConf) { const g = await lmdGambarGrafik(c); if (g) gambar.push(g); }
    if (!gambar.length) return [];
    const wSel = Math.floor(LMD_LEBAR / 2);
    const lebarPx = Math.round(12 * LD_PX_CM), tinggiPx = Math.round(lebarPx * 380 / 900);
    const rows = [];
    for (let i = 0; i < gambar.length; i += 2) {
        rows.push(new TableRow({ cantSplit: true, children: [0, 1].map(k => new TableCell({ width: { size: wSel, type: WidthType.DXA },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
                children: gambar[i + k] ? [new ImageRun({ type: 'png', data: gambar[i + k].data, transformation: { width: lebarPx, height: tinggiPx } })] : [] })] })) }));
    }
    return [new Table({ width: { size: LMD_LEBAR, type: WidthType.DXA }, columnWidths: [wSel, LMD_LEBAR - wSel], borders: ldTanpaGaris(), rows }), ldP('', { setelah: 120 })];
}

const lmdDaftarItem = (obj, urut) => (urut ? Object.keys(obj).sort((a, b) => a.localeCompare(b, 'id')) : Object.keys(obj)).map(j => ({ judul: j, ...obj[j] }));

/** Susun dokumen Word dari model laporan_mutu.html */
async function lmdSusunDokumen(m, inst, cekFn) {
    const isi = [];
    const tingkat = m.unit === 'RS_ALL' ? 'SELURUH RUMAH SAKIT' : (/^(unit|instalasi|tim|komite|bagian|ruang)\b/i.test(m.unit) ? '' : 'UNIT ') + String(m.unit).toUpperCase();
    isi.push(...ldKop(inst, LMD_LEBAR));
    isi.push(ldP('LAPORAN CAPAIAN INDIKATOR MUTU', { rata: 'tengah', tebal: true, ukuran: 26, setelah: 40 }));
    isi.push(ldP(`${String(m.periode).toUpperCase()} - ${tingkat}`, { rata: 'tengah', ukuran: 22, setelah: 240 }));

    // Ringkasan
    isi.push(ldJudul('Ringkasan Capaian', 2));
    isi.push(...ldTabel([{ judul: 'Total Indikator', rata: 'tengah' }, { judul: 'Tercapai', rata: 'tengah' }, { judul: 'Tidak Tercapai', rata: 'tengah' }, { judul: 'Belum Ada Data', rata: 'tengah' }, { judul: 'Rata-rata Capaian INM', rata: 'tengah' }],
        [[{ teks: m.stats.total, tebal: true }, { teks: m.stats.hit, tebal: true, warna: '0B7A0B' }, { teks: m.stats.miss, tebal: true, warna: 'B42318' },
          { teks: Math.max(0, m.stats.total - m.stats.hit - m.stats.miss), tebal: true }, { teks: m.rataInm === null ? '-' : lmdAngka(Math.round(m.rataInm * 10) / 10) + '%', tebal: true }]],
        { lebarTotal: LMD_LEBAR, ukuran: 22 }));
    const ket = m.namaBulan.length > 3
        ? 'Keterangan: tiap sel bulan berisi capaian (atas) dan N/D (bawah). Target adalah target yang berlaku pada bulan terakhir. Sel berwarna merah = tidak mencapai target; "-" = belum ada data.'
        : 'Keterangan: Tgt = target, N = numerator, D = denominator, Cpa = capaian. Sel berwarna merah = tidak mencapai target; "-" = belum ada data.';
    isi.push(ldP(ket, { miring: true, ukuran: 18, rata: 'kiri', setelah: 160 }));

    // Per kategori (INM, IMP-RS, ...)
    let huruf = 0;
    const tidakTercapai = [];
    const catatGagal = (daftar, label) => daftar.forEach(it => m.namaBulan.forEach(b => {
        const x = it.bulans[b];
        if (x && x.target !== null && x.capai !== null && x.target !== undefined && x.capai !== undefined && !cekFn(it.judul, x.capai, x.target))
            tidakTercapai.push([it.judul, label, b, lmdAngka(x.target), { teks: lmdAngka(x.capai), warna: 'B42318', tebal: true }, it.satuan || '']);
    }));
    for (const jenis of m.kategori) {
        const daftar = lmdDaftarItem(m.groupedData[jenis], false);
        if (!daftar.length) continue;
        isi.push(ldJudul(`${String.fromCharCode(65 + huruf++)}. ${jenis}`, 2));
        isi.push(...lmdTabelCapaian(daftar, m.namaBulan, cekFn));
        isi.push(...await lmdBlokGrafik(m.grafik.filter(g => g.grup === jenis)));
        catatGagal(daftar, jenis);
    }

    // IMP-Unit per unit (tampilan seluruh RS)
    const unitNama = Object.keys(m.unitGroupedData || {}).sort((a, b) => a.localeCompare(b, 'id'));
    if (unitNama.length) {
        isi.push(ldJudul(`${String.fromCharCode(65 + huruf++)}. Indikator Mutu Prioritas Unit (IMP-Unit)`, 2));
        for (const [i, u] of unitNama.entries()) {
            const daftar = lmdDaftarItem(m.unitGroupedData[u], true);
            if (!daftar.length) continue;
            isi.push(ldJudul(`${i + 1}. ${u}`, 3));
            isi.push(...lmdTabelCapaian(daftar, m.namaBulan, cekFn));
            isi.push(...await lmdBlokGrafik(m.grafik.filter(g => g.grup === 'unit:' + u)));
            catatGagal(daftar, u);
        }
    }

    // Daftar tidak mencapai target
    isi.push(ldJudul(`${String.fromCharCode(65 + huruf++)}. Indikator yang Tidak Mencapai Target`, 2));
    isi.push(...ldTabel([{ judul: 'No', lebar: 0.5, rata: 'tengah' }, { judul: 'Indikator', lebar: 4 }, { judul: 'Kategori / Unit', lebar: 2.6 }, { judul: 'Bulan', lebar: 1.2, rata: 'tengah' },
                         { judul: 'Target', lebar: 1, rata: 'tengah' }, { judul: 'Capaian', lebar: 1, rata: 'tengah' }, { judul: 'Satuan', lebar: 0.9, rata: 'tengah' }],
        tidakTercapai.map((r, i) => [i + 1, ...r]), { lebarTotal: LMD_LEBAR, kosong: 'Semua indikator yang memiliki data mencapai target.' }));
    if (tidakTercapai.length) isi.push(ldP('Indikator di atas perlu ditindaklanjuti dengan rencana perbaikan (PDSA) oleh unit penanggung jawab.', { ukuran: 20, setelah: 120 }));

    // Tanda tangan
    const penanda = m.unit === 'RS_ALL'
        ? [{ jabatan: 'Ketua Komite Mutu dan Keselamatan Pasien', nama: inst.ketua_komite_nama, nip: inst.ketua_komite_nip }]
        : [{ atas: 'Mengetahui,', jabatan: 'Kepala ' + m.unit }, { jabatan: 'Ketua Komite Mutu dan Keselamatan Pasien', nama: inst.ketua_komite_nama, nip: inst.ketua_komite_nip }];
    isi.push(...ldTandaTangan(inst, penanda, null, { lebar: LMD_LEBAR }));

    return ldDokumen(`Laporan Capaian Indikator Mutu ${m.periode}`, [ldSeksi(isi, { lanskap: true, kepala: `Laporan Capaian Indikator Mutu — ${m.periode}` })]);
}

async function unduhWordLaporanMutu() {
    const m = window.__cetakMutu;
    if (!m) { Swal.fire('Belum ada data', 'Tampilkan data terlebih dahulu.', 'info'); return; }
    Swal.fire({ title: 'Menyusun dokumen Word...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const inst = { ...(typeof INSTITUSI_BAWAAN !== 'undefined' ? INSTITUSI_BAWAAN : {}), ...(window.__institusi || {}) };
        const doc = await lmdSusunDokumen(m, inst, cekTercapai);
        const tingkat = m.unit === 'RS_ALL' ? 'Seluruh_RS' : m.unit;
        await lapUnduhDokumen(doc, `Laporan_Capaian_Mutu_${lapNamaBerkas(m.periode)}_${lapNamaBerkas(tingkat)}.docx`);
        Swal.close();
    } catch (e) {
        console.error(e);
        Swal.fire('Gagal membuat dokumen Word', e.message || String(e), 'error');
    }
}

if (typeof module !== 'undefined') module.exports = { lmdSusunDokumen, lmdTabelCapaian };
