// =====================================================================
// laporan_docx.js — dokumen Word (.docx) Laporan Periodik Terintegrasi
// untuk Direksi dan Laporan Umpan Balik per Unit.
// Butuh: docx (window.docx, v9), laporan_grafik.js, laporan_data.js.
// =====================================================================

const LD_LEBAR = 9072;          // lebar isi A4 (DXA) dengan margin 2,5 cm
const LD_PX_CM = 37.8;          // piksel per cm untuk gambar
const LD_WARNA_HEADER = 'D9E2F3';
const LD_WARNA_ZEBRA = 'F5F7FA';

function ldDocx() { if (!window.docx) throw new Error('Pustaka docx belum termuat.'); return window.docx; }

// ---------------------------------------------------------------------
// Blok dasar
// ---------------------------------------------------------------------
function ldTeks(teks, o = {}) {
    const { TextRun } = ldDocx();
    return new TextRun({ text: String(teks ?? ''), bold: o.tebal, italics: o.miring, size: o.ukuran, color: o.warna, font: o.font });
}
function ldP(isi, o = {}) {
    const { Paragraph, AlignmentType } = ldDocx();
    const anak = Array.isArray(isi) ? isi : [ldTeks(isi, o)];
    return new Paragraph({ children: anak, alignment: o.rata === 'tengah' ? AlignmentType.CENTER : o.rata === 'kanan' ? AlignmentType.RIGHT : o.rata === 'kiri' ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
                           spacing: { after: o.setelah ?? 120, before: o.sebelum ?? 0, line: o.baris ?? 300 }, indent: o.indent ? { firstLine: o.indent } : undefined,
                           keepNext: o.tetapBersama, pageBreakBefore: o.halamanBaru });
}
function ldParagraf(teks, o = {}) {
    // teks bebas (hasil AI/suntingan): paragraf dipisah baris kosong
    return String(teks || '').split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map(s => ldP(s, { indent: 567, ...o }));
}
function ldJudul(teks, level) {
    const { Paragraph, HeadingLevel } = ldDocx();
    const lv = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
    return new Paragraph({ heading: lv, children: String(teks).split('\n').map((t, i) => new (ldDocx().TextRun)({ text: t, break: i ? 1 : 0 })), keepNext: true, pageBreakBefore: level === 1 });
}
let ldInstansiNomor = 0;
function ldDaftar(butir, jenis = 'butir') {
    const { Paragraph, AlignmentType } = ldDocx();
    const inst = ++ldInstansiNomor;
    return (butir || []).filter(x => String(x || '').trim()).map(t => new Paragraph({
        children: [ldTeks(t)], numbering: { reference: jenis, level: 0, instance: jenis === 'nomor' ? inst : undefined },
        alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 290 } }));
}
function ldHalamanBaru() { const { Paragraph, PageBreak } = ldDocx(); return new Paragraph({ children: [new PageBreak()] }); }
function ldKosong(n = 1) { return Array.from({ length: n }, () => ldP('', { setelah: 0 })); }

/**
 * Tabel. kolom: [{judul, lebar (proporsi), rata:'tengah'|'kanan'}]; baris: array of array (teks / {teks, tebal, warna, isi})
 */
function ldTabel(kolom, baris, o = {}) {
    const { Table, TableRow, TableCell, Paragraph, WidthType, ShadingType, AlignmentType, VerticalAlign } = ldDocx();
    const total = kolom.reduce((a, k) => a + (k.lebar || 1), 0);
    const LEBAR = o.lebarTotal || LD_LEBAR;
    const lebar = kolom.map(k => Math.floor(LEBAR * (k.lebar || 1) / total));
    lebar[lebar.length - 1] += LEBAR - lebar.reduce((a, b) => a + b, 0);
    const ukuran = o.ukuran || 18;
    const sel = (isi, j, kepala, zebra) => {
        const c = (isi !== null && typeof isi === 'object' && !Array.isArray(isi)) ? isi : { teks: isi };
        const rata = kepala ? AlignmentType.CENTER : kolom[j].rata === 'tengah' ? AlignmentType.CENTER : kolom[j].rata === 'kanan' ? AlignmentType.RIGHT : AlignmentType.LEFT;
        const paragrafs = String(c.teks ?? '').split('\n').map(t => new Paragraph({ alignment: rata, spacing: { after: 0, line: 260 },
            children: [ldTeks(t, { tebal: kepala || c.tebal, ukuran, warna: c.warna })] }));
        return new TableCell({ width: { size: lebar[j], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 50, left: 80, right: 80 }, columnSpan: c.gabung,
            shading: kepala ? { fill: LD_WARNA_HEADER, type: ShadingType.CLEAR, color: 'auto' } : c.isi ? { fill: c.isi, type: ShadingType.CLEAR, color: 'auto' } : zebra ? { fill: LD_WARNA_ZEBRA, type: ShadingType.CLEAR, color: 'auto' } : undefined,
            children: paragrafs });
    };
    const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: kolom.map((k, j) => sel(k.judul, j, true)) })];
    (baris.length ? baris : [[{ teks: o.kosong || 'Tidak ada data.', gabung: kolom.length }]]).forEach((b, i) => {
        rows.push(new TableRow({ cantSplit: true, children: b.map((x, j) => sel(x, j, false, i % 2 === 1)) }));
    });
    return [new Table({ width: { size: LEBAR, type: WidthType.DXA }, columnWidths: lebar, rows }), ldP('', { setelah: 120 })];
}
function ldGambar(g, lebarCm = 15, keterangan) {
    const { ImageRun, Paragraph, AlignmentType } = ldDocx();
    if (!g) return [];
    const w = Math.round(lebarCm * LD_PX_CM), h = Math.round(w * g.tinggi / g.lebar);
    const out = [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: keterangan ? 40 : 160 }, keepNext: !!keterangan,
        children: [new ImageRun({ type: 'png', data: g.bytes, transformation: { width: w, height: h } })] })];
    if (keterangan) out.push(ldP(keterangan, { rata: 'tengah', miring: true, ukuran: 18, setelah: 200 }));
    return out;
}
function ldBytesDataUrl(url) {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(url || '');
    if (!m) return null;
    const bin = atob(m[2]); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { type: m[1] === 'png' ? 'png' : 'jpg', data: u8 };
}
// Ukuran asli gambar dari header PNG/JPEG (untuk menjaga rasio logo)
function ldUkuranGambar(u8) {
    try {
        if (u8[0] === 0x89 && u8[1] === 0x50) return { w: (u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19], h: (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23] };
        let i = 2;
        while (i < u8.length) {
            if (u8[i] !== 0xFF) { i++; continue; }
            const m = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
            if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
            i += 2 + len;
        }
    } catch (e) { /* abaikan */ }
    return { w: 1, h: 1 };
}
function ldLogo(logo, tinggi) {
    const { ImageRun } = ldDocx();
    const u = ldUkuranGambar(logo.data);
    return new ImageRun({ type: logo.type, data: logo.data, transformation: { width: Math.round(tinggi * u.w / u.h), height: tinggi } });
}
function ldTanpaGaris() {
    const { BorderStyle } = ldDocx();
    const n = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    return { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n };
}
function ldKop(inst, lebar = LD_LEBAR) {
    const { Table, TableRow, TableCell, Paragraph, ImageRun, WidthType, AlignmentType, VerticalAlign, BorderStyle } = ldDocx();
    const logo = ldBytesDataUrl(inst.logo_data);
    const kontak = [inst.alamat, inst.telepon ? 'Telp. ' + inst.telepon : '', inst.email, inst.situs_web].filter(Boolean).join(' · ');
    const w = [1400, lebar - 2800, 1400];
    const tengah = [inst.pemilik ? ldP(String(inst.pemilik).toUpperCase(), { rata: 'tengah', setelah: 0, ukuran: 22 }) : null,
        inst.dinas_induk ? ldP(String(inst.dinas_induk).toUpperCase(), { rata: 'tengah', setelah: 0, ukuran: 22 }) : null,
        ldP(String(inst.nama_rs || '').toUpperCase(), { rata: 'tengah', setelah: 0, tebal: true, ukuran: 28 }),
        kontak ? ldP(kontak, { rata: 'tengah', setelah: 0, ukuran: 16 }) : null].filter(Boolean);
    const t = new Table({ width: { size: lebar, type: WidthType.DXA }, columnWidths: w, borders: ldTanpaGaris(), rows: [new TableRow({ children: [
        new TableCell({ width: { size: w[0], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER,
            children: logo ? [ldLogo(logo, 75)] : [] })] }),
        new TableCell({ width: { size: w[1], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, children: tengah }),
        new TableCell({ width: { size: w[2], type: WidthType.DXA }, children: [new Paragraph({ children: [] })] })] })] });
    const garis = new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: '000000', space: 1 } }, children: [] });
    return [t, garis];
}
function ldTandaTangan(inst, penanda, tanggal, o = {}) {
    const { Table, TableRow, TableCell, WidthType } = ldDocx();
    const t = tanggal ? new Date(String(tanggal).length === 10 ? tanggal + 'T00:00:00' : tanggal) : new Date();
    const tgl = `${inst.kota || ''}, ${t.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const LEBAR = o.lebar || LD_LEBAR;
    const w = Math.floor(LEBAR / penanda.length);
    return [ldP('', { setelah: o.rapat ? 0 : 200 }), new Table({ width: { size: LEBAR, type: WidthType.DXA }, columnWidths: penanda.map(() => w), borders: ldTanpaGaris(),
        rows: [new TableRow({ cantSplit: true, children: penanda.map((p, i) => new TableCell({ width: { size: w, type: WidthType.DXA }, children: [
            ldP(i === penanda.length - 1 ? tgl : (p.atas || ' '), { rata: 'tengah', setelah: 0 }),
            ldP(p.jabatan || '', { rata: 'tengah', setelah: o.rapat ? 700 : 900 }),
            ldP(p.nama || '(..................................................)', { rata: 'tengah', setelah: 0, tebal: true }),
            ldP(p.nip ? 'NIP. ' + p.nip : '', { rata: 'tengah', setelah: 0 })] })) })] })];
}
const ldAngka = (v, satuan) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })}${satuan ? ' ' + satuan : ''}`;
const ldSatuan = s => /%|persen/i.test(s || '') ? '%' : /permil|‰/i.test(s || '') ? '‰' : '';
const ldTarget = i => `${lapArahKecil(i.arah) ? '≤' : '≥'} ${ldAngka(i.target)}${ldSatuan(i.satuan) ? ' ' + ldSatuan(i.satuan) : ''}`;
const ldStatus = x => x === true ? { teks: 'Tercapai', warna: '0B7A0B' } : x === false ? { teks: 'Tidak tercapai', warna: 'B42318', tebal: true } : { teks: '-' };
const ldTren = t => t === 'membaik' ? '▲ membaik' : t === 'memburuk' ? '▼ memburuk' : t === 'tetap' ? '= tetap' : '-';
function ldDokumen(judul, sections) {
    const { Document, AlignmentType, LevelFormat } = ldDocx();
    const heading = (id, nama, ukuran, rata, before) => ({ id, name: nama, basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: ukuran, bold: true, font: 'Arial', color: '000000' },
        paragraph: { spacing: { before, after: 160 }, alignment: rata, outlineLevel: ['Heading1', 'Heading2', 'Heading3'].indexOf(id) } });
    return new Document({
        creator: 'SIM-PMKP', title: judul, description: judul, features: { updateFields: true },
        styles: { default: { document: { run: { font: 'Arial', size: 22 } } },
            paragraphStyles: [heading('Heading1', 'Heading 1', 26, AlignmentType.CENTER, 0), heading('Heading2', 'Heading 2', 23, AlignmentType.LEFT, 240), heading('Heading3', 'Heading 3', 22, AlignmentType.LEFT, 160)] },
        numbering: { config: [
            { reference: 'butir', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
            { reference: 'nomor', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
        sections });
}
function ldSeksi(anak, o = {}) {
    const { Header, Footer, Paragraph, TextRun, AlignmentType, PageNumber, PageOrientation } = ldDocx();
    const kaki = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Halaman ', PageNumber.CURRENT], size: 16, color: '555555' })] })] });
    const kepala = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: o.kepala || '', size: 16, color: '777777', italics: true })] })] });
    return { properties: { titlePage: !!o.sampul, page: { size: { width: 11906, height: 16838, orientation: o.lanskap ? PageOrientation.LANDSCAPE : undefined },
                           margin: { top: 1417, right: 1417, bottom: 1417, left: 1417 } } },
             headers: { default: kepala, first: new Header({ children: [new Paragraph({ children: [] })] }) },
             footers: { default: kaki, first: new Footer({ children: [new Paragraph({ children: [] })] }) },
             children: anak };
}

// ---------------------------------------------------------------------
// Grafik untuk laporan
// ---------------------------------------------------------------------
function ldGrafikLaporan(snap) {
    const g = {}, nb = snap.periode.namaBulan.map(b => snap.periode.bulan.length > 6 ? b.slice(0, 3) : b);
    const m = snap.mutu.ringkasan;
    const kat = ['INM', 'IMP-RS', 'IMP-Unit', 'Lainnya'].filter(k => m[k] && m[k].total);
    g.mutuRingkas = lgBatang({ bulat: true, label: kat,
        seri: [{ nama: 'Tercapai', data: kat.map(k => m[k].tercapai), warna: LG_STATUS.baik }, { nama: 'Tidak tercapai', data: kat.map(k => m[k].tidak), warna: LG_STATUS.kritis }] });
    g.indikator = {};
    snap.mutu.indikator.filter(i => !i.tidakLapor && (i.jenis !== 'IMP-Unit' || i.tercapai === false)).forEach((i, k) => {
        g.indikator[`${i.id}|${i.unit}`] = lgGaris({ label: nb, satuan: i.satuan, tinggi: 220,
            seri: [{ nama: 'Capaian', data: snap.periode.bulan.map(b => i.bulan[b] ? i.bulan[b].c : null), warna: LG_SERI[0] },
                   { nama: 'Target', data: snap.periode.bulan.map(b => i.bulan[b] ? i.bulan[b].t : i.target), warna: LG_NETRAL, putus: true }] });
    });
    const ins = snap.insiden;
    g.insidenBulanan = lgBatang({ bulat: true, label: ins.bulanan.map(b => b.bulan.slice(0, 3)), tumpuk: true,
        seri: LAP_JENIS_INSIDEN.map((j, k) => ({ nama: j, data: ins.bulanan.map(b => b[j]), warna: LG_SERI[k] })).filter(s => s.data.some(x => x)) });
    g.insidenBanding = lgBatang({ bulat: true, label: LAP_JENIS_INSIDEN,
        seri: [{ nama: snap.pembanding.tahunLalu.pendek, data: LAP_JENIS_INSIDEN.map(j => ins.tahunLalu.jenis[j] || 0), warna: '#c9c8c2' },
               { nama: snap.pembanding.sebelumnya.pendek, data: LAP_JENIS_INSIDEN.map(j => ins.sebelumnya.jenis[j] || 0), warna: LG_NETRAL },
               { nama: snap.periode.pendek, data: LAP_JENIS_INSIDEN.map(j => ins.jenis[j] || 0), warna: LG_SERI[0] }] });
    g.grading = lgBatang({ bulat: true, label: LAP_GRADING,
        seri: [{ nama: 'Insiden', data: LAP_GRADING.map(x => ins.grading[x]), warna: LG_SERI[0], warnaPer: LAP_GRADING.map(x => LG_GRADING[x]) }], tinggi: 220 });
    const b = snap.budaya;
    if (b.ada && b.utama && b.utama.dimensi) {
        const dim = Object.keys(b.utama.dimensi);
        const seri = [];
        if (b.sebelumnya && b.sebelumnya.dimensi) seri.push({ nama: b.sebelumnya.nama, data: dim.map(d => b.sebelumnya.dimensi[d]), warna: '#b9b8b2' });
        seri.push({ nama: b.utama.nama, data: dim.map(d => b.utama.dimensi[d]), warna: LG_SERI[0] });
        g.budaya = lgBatang({ horizontal: true, maks: 100, label: dim, seri, garisRef: { nilai: 75, label: 'Kuat ≥ 75%' }, tinggi: 30 + dim.length * (seri.length > 1 ? 34 : 24) + (seri.length > 1 ? 24 : 0) });
    }
    const r = snap.risiko;
    g.risiko = lgBatang({ bulat: true, label: LAP_TINGKAT, tinggi: 220,
        seri: [{ nama: 'Risiko', data: LAP_TINGKAT.map(t => r.perTingkat[t]), warna: LG_SERI[0], warnaPer: LAP_TINGKAT.map(t => LG_GRADING[t]) }] });
    const fp = snap.fmea.proyek.filter(p => p.dinilaiUlang);
    if (fp.length) g.fmea = lgBatang({ label: fp.map(p => p.nama),
        seri: [{ nama: 'RPN awal', data: fp.map(p => p.rpnAwal), warna: LG_NETRAL }, { nama: 'RPN sesudah', data: fp.map(p => p.rpnSesudah), warna: LG_SERI[0] }] });
    return g;
}

// ---------------------------------------------------------------------
// LAPORAN UNTUK DIREKSI
// ---------------------------------------------------------------------
function ldNarasi(narasi, kunci) { return (narasi && narasi[kunci]) || {}; }
function ldBagianNarasi(n, o = {}) {
    const out = [];
    if (n.teks) out.push(...ldParagraf(n.teks));
    if (n.poin && String(n.poin).trim()) {
        out.push(ldP(o.judulPoin || 'Temuan kunci:', { tebal: true, setelah: 60, tetapBersama: true }));
        out.push(...ldDaftar(String(n.poin).split('\n').map(s => s.replace(/^[-•*\d.)\s]+/, '').trim())));
    }
    const rek = (n.rekomendasi || []).filter(r => (r.uraian || '').trim());
    if (rek.length) {
        out.push(ldP(o.judulRek || 'Rekomendasi:', { tebal: true, setelah: 60, sebelum: 120, tetapBersama: true }));
        out.push(...ldTabel([{ judul: 'No', lebar: 0.5, rata: 'tengah' }, { judul: 'Rekomendasi', lebar: 5 }, { judul: 'Penanggung jawab', lebar: 2 },
                             ...(o.tenggat ? [{ judul: 'Tenggat', lebar: 1.5 }] : []), { judul: 'Prioritas', lebar: 1.1, rata: 'tengah' }],
            rek.map((r, i) => [String(i + 1), r.uraian, r.penanggung_jawab || '-', ...(o.tenggat ? [r.tenggat || '-'] : []), r.prioritas || '-'])));
    }
    if (!out.length) out.push(ldP('(Pembahasan belum disusun.)', { miring: true }));
    return out;
}
function ldTabelIndikator(items, snap, denganUnit) {
    const bulanKolom = snap.periode.bulan.length <= 6;
    const kol = [{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Indikator', lebar: 3.2 }, ...(denganUnit ? [{ judul: 'Unit', lebar: 1.4 }] : []),
        { judul: 'Target', lebar: 1, rata: 'tengah' },
        ...(bulanKolom ? snap.periode.namaBulan.map(b => ({ judul: b.slice(0, 3), lebar: 0.85, rata: 'tengah' })) : []),
        { judul: snap.periode.pendek, lebar: 1, rata: 'tengah' }, { judul: snap.pembanding.sebelumnya.pendek, lebar: 1, rata: 'tengah' },
        { judul: snap.pembanding.tahunLalu.pendek, lebar: 1, rata: 'tengah' }, { judul: 'Status', lebar: 1.2, rata: 'tengah' }];
    return ldTabel(kol, items.map((i, k) => [String(k + 1), i.judul, ...(denganUnit ? [i.unit] : []), ldTarget(i),
        ...(bulanKolom ? snap.periode.bulan.map(b => i.bulan[b] ? { teks: ldAngka(i.bulan[b].c), warna: i.bulan[b].ok === false ? 'B42318' : undefined } : '-') : []),
        { teks: ldAngka(i.nilai), tebal: true }, ldAngka(i.sebelumnya), ldAngka(i.tahunLalu), i.tidakLapor ? { teks: 'Tidak ada data' } : ldStatus(i.tercapai)]), { ukuran: bulanKolom && snap.periode.bulan.length > 3 ? 15 : 16 });
}
function ldBlokIndikator(items, snap, grafik) {
    const out = [];
    items.filter(i => !i.tidakLapor).forEach((i, k) => {
        const gr = grafik.indikator[`${i.id}|${i.unit}`];
        const kal = [];
        kal.push(`Capaian ${snap.periode.pendek} ${ldAngka(i.nilai, ldSatuan(i.satuan))} terhadap target ${ldTarget(i)} (${i.tercapai === true ? 'tercapai' : i.tercapai === false ? 'tidak tercapai' : 'tanpa target'}).`);
        if (i.sebelumnya !== null && i.sebelumnya !== undefined) kal.push(`Periode sebelumnya ${ldAngka(i.sebelumnya, ldSatuan(i.satuan))}${i.tren && i.tren !== 'tetap' ? ` (${i.tren})` : ''}.`);
        if (i.beruntun > 1) kal.push(`Tidak tercapai ${i.beruntun} bulan berturut-turut di akhir periode.`);
        if (i.pdsa && i.pdsa.status !== 'belum') kal.push(`PDSA ${i.pdsa.status === 'berjalan' ? 'sedang berjalan (fase ' + i.pdsa.fase + ')' : 'telah selesai'}${i.pdsa.masalah ? '; masalah: ' + i.pdsa.masalah : ''}${i.pdsa.rencana ? '; rencana: ' + i.pdsa.rencana : ''}.`);
        else if (i.tercapai === false) kal.push('Belum ada PDSA untuk indikator ini.');
        out.push(ldJudul(`${k + 1}. ${i.judul}${i.jenis === 'IMP-Unit' ? ' — ' + i.unit : ''}`, 3));
        if (gr) out.push(...ldGambar(gr, 13));
        out.push(ldP(kal.join(' ')));
    });
    return out;
}

const LD_BIRU = '1F2A8C';
function ldGarisBiru(sebelum = 0, setelah = 0) {
    const { Paragraph, BorderStyle } = ldDocx();
    return new Paragraph({ spacing: { before: sebelum, after: setelah }, border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: LD_BIRU, space: 1 } }, children: [] });
}
// "RSUD Saras Adyatma" + "Kabupaten Bantul" (dari pemilik tanpa kata "Pemerintah")
function ldNamaRsWilayah(inst) {
    const wil = String(inst.pemilik || '').replace(/^pemerintah\s+/i, '').trim();
    return `${inst.nama_singkat || inst.nama_rs || ''}${wil ? ' ' + wil : ''}`.toUpperCase();
}
function ldSampul(inst, judul, sub) {
    const { Table, TableRow, TableCell, Paragraph, WidthType, AlignmentType, VerticalAlign, BorderStyle } = ldDocx();
    const logo = ldBytesDataUrl(inst.logo_data);
    const w = [2000, LD_LEBAR - 2000];
    const identitas = new Table({ width: { size: LD_LEBAR, type: WidthType.DXA }, columnWidths: w, borders: ldTanpaGaris(), rows: [new TableRow({ children: [
        new TableCell({ width: { size: w[0], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: logo ? [ldLogo(logo, 110)] : [] })] }),
        new TableCell({ width: { size: w[1], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, children: [
            ...(inst.pemilik ? [ldP(String(inst.pemilik).toUpperCase(), { rata: 'kiri', ukuran: 20, setelah: 120 })] : []),
            ...(inst.dinas_induk ? [ldP(String(inst.dinas_induk).toUpperCase(), { rata: 'kiri', ukuran: 20, setelah: 120 })] : []),
            ldP(String(inst.nama_rs || '').toUpperCase(), { rata: 'kiri', tebal: true, ukuran: 26, setelah: 0 })] })] })] });
    const n = { style: BorderStyle.SINGLE, size: 6, color: LD_BIRU };
    const kontak1 = [inst.alamat, inst.telepon ? 'Telp. ' + inst.telepon : ''].filter(Boolean).join(', ');
    const kontak2 = [inst.situs_web ? 'Website: ' + inst.situs_web : '', inst.email ? 'Email: ' + inst.email : ''].filter(Boolean).join('   ');
    const kotak = new Table({ width: { size: 6800, type: WidthType.DXA }, columnWidths: [6800], alignment: AlignmentType.CENTER,
        borders: { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n },
        rows: [new TableRow({ children: [new TableCell({ width: { size: 6800, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [
            ...(inst.pemilik ? [ldP(String(inst.pemilik).toUpperCase(), { rata: 'tengah', ukuran: 16, setelah: 20 })] : []),
            ...(inst.dinas_induk ? [ldP(String(inst.dinas_induk).toUpperCase(), { rata: 'tengah', ukuran: 16, setelah: 20 })] : []),
            ldP(String(inst.nama_rs || '').toUpperCase(), { rata: 'tengah', tebal: true, ukuran: 18, setelah: 20 }),
            ...(kontak1 ? [ldP(kontak1, { rata: 'tengah', ukuran: 14, setelah: 0 })] : []),
            ...(kontak2 ? [ldP(kontak2, { rata: 'tengah', ukuran: 14, setelah: 0 })] : [])] })] })] });
    return [ldGarisBiru(0, 600), identitas, ...ldKosong(5),
        ...judul.map((t, i) => ldP(t, { rata: 'tengah', tebal: true, ukuran: 30, setelah: i === judul.length - 1 ? 120 : 20 })),
        ...(sub ? [ldP(sub, { rata: 'tengah', ukuran: 20, setelah: 120 })] : []),
        ldGarisBiru(120, 0), ...ldKosong(9), ldP('Disusun oleh Komite Mutu dan Keselamatan Pasien', { rata: 'tengah', ukuran: 18, setelah: 120 }), kotak];
}

function lapDokumenDireksi(snap, narasi, inst, meta = {}) {
    ldInstansiNomor = 0;
    const grafik = ldGrafikLaporan(snap);
    const P = snap.periode, m = snap.mutu, ins = snap.insiden, bud = snap.budaya, r = snap.risiko, f = snap.fmea;
    const judulLap = 'LAPORAN PENINGKATAN MUTU DAN KESELAMATAN PASIEN TERINTEGRASI';
    const nm = inst.nama_rs || 'Rumah Sakit';
    const { TableOfContents } = ldDocx();

    // ---- Sampul (mengikuti format sampul laporan RS) ----
    const sampul = ldSampul(inst, [judulLap, ldNamaRsWilayah(inst), P.label.toUpperCase()], '(Mutu, Keselamatan Pasien, Budaya Keselamatan, dan Manajemen Risiko)');
    if (meta.status && meta.status !== 'disetujui') sampul.splice(sampul.length - 2, 0, ldP(meta.status === 'diajukan' ? 'Diajukan kepada Direktur — menunggu disposisi' : 'DRAF — belum diajukan', { rata: 'tengah', miring: true, warna: 'B42318', sebelum: 200 }));

    // ---- Pengantar & daftar isi ----
    const pengantar = [ldJudul('KATA PENGANTAR', 1),
        ...ldParagraf(`Puji syukur kami panjatkan ke hadirat Tuhan Yang Maha Esa, karena atas rahmat-Nya Komite Mutu dan Keselamatan Pasien dapat menyelesaikan Laporan Peningkatan Mutu dan Keselamatan Pasien Terintegrasi ${P.label} ${nm}.

Laporan ini memadukan hasil pengukuran indikator mutu, pelaporan dan penanganan insiden keselamatan pasien, budaya keselamatan, serta manajemen risiko termasuk analisis FMEA. Pembahasan disusun per komponen dan secara terintegrasi untuk melihat keterkaitan antarkomponen, disertai rekomendasi yang diajukan kepada Direktur sebagai dasar pengambilan keputusan.

Kami menyampaikan terima kasih kepada seluruh unit kerja, penanggung jawab data, dan tim yang telah berkontribusi. Masukan dan arahan Direktur sangat kami harapkan untuk perbaikan berkelanjutan.`),
        ...ldTandaTangan(inst, [{ jabatan: 'Ketua Komite Mutu dan Keselamatan Pasien', nama: inst.ketua_komite_nama, nip: inst.ketua_komite_nip }], meta.tanggal),
        ldJudul('DAFTAR ISI', 1), new TableOfContents('Daftar Isi', { hyperlink: true, headingStyleRange: '1-2' }),
        ldP('Catatan: bila daftar isi belum tampil, klik kanan pada area ini lalu pilih "Update Field".', { miring: true, ukuran: 16, warna: '777777' })];

    // ---- Ringkasan eksekutif ----
    const eks = ldNarasi(narasi, 'eksekutif');
    const kunciTabel = ldTabel([{ judul: 'Komponen', lebar: 2 }, { judul: 'Ukuran', lebar: 3.2 }, { judul: snap.periode.pendek, lebar: 1.4, rata: 'tengah' }, { judul: snap.pembanding.sebelumnya.pendek, lebar: 1.4, rata: 'tengah' }], [
        ['Mutu', 'Indikator tercapai', `${m.ringkasan.total.tercapai} dari ${m.ringkasan.total.total} (${ldAngka(m.ringkasan.total.persen)}%)`, '-'],
        ['Mutu', 'Kepatuhan pelaporan data', ldAngka(m.kepatuhan.persen, '%'), '-'],
        ['Keselamatan pasien', 'Laporan insiden (IKP + KPC)', String(ins.total), String(ins.sebelumnya.total)],
        ['Keselamatan pasien', 'KTD + Sentinel', String(ins.cedera), String((ins.sebelumnya.jenis.KTD || 0) + (ins.sebelumnya.jenis.Sentinel || 0))],
        ['Keselamatan pasien', 'Insiden grading merah/kuning', String((ins.grading.Merah || 0) + (ins.grading.Kuning || 0)), '-'],
        ['Budaya keselamatan', bud.ada ? `Budaya lapor (${bud.utama.nama})` : 'Survei budaya', bud.ada && bud.utama.budaya ? ldAngka(bud.utama.budaya['Budaya Lapor'], '%') : '-', bud.sebelumnya && bud.sebelumnya.budaya ? ldAngka(bud.sebelumnya.budaya['Budaya Lapor'], '%') : '-'],
        ['Manajemen risiko', 'Risiko terbuka (tinggi/ekstrem)', `${r.jumlah} (${(r.perTingkat.Tinggi || 0) + (r.perTingkat.Ekstrem || 0)})`, '-'],
        ['Manajemen risiko', 'Tindakan risiko selesai', `${r.tindakan.selesai} dari ${r.tindakan.total}`, '-'],
        ['FMEA', 'Proyek / titik kritis tersisa', `${f.jumlah} / ${f.kritisSisa}`, '-']]);
    const ringkasan = [ldJudul('RINGKASAN EKSEKUTIF', 1), ...(eks.teks ? ldParagraf(eks.teks) : [ldP('(Ringkasan eksekutif belum disusun.)', { miring: true })]),
        ...(eks.poin ? [ldP('Sorotan utama:', { tebal: true, setelah: 60 }), ...ldDaftar(String(eks.poin).split('\n').map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()))] : []),
        ldP('Angka kunci', { tebal: true, sebelum: 160, setelah: 80 }), ...kunciTabel];

    // ---- BAB I ----
    const bab1 = [ldJudul('BAB I\nPENDAHULUAN', 1), ldJudul('A. Latar Belakang', 2),
        ...ldParagraf(`Peningkatan mutu dan keselamatan pasien merupakan proses berkelanjutan yang wajib dipantau, dianalisis, dan dilaporkan secara berkala kepada pimpinan rumah sakit. ${nm} menyelenggarakan program Peningkatan Mutu dan Keselamatan Pasien (PMKP) yang dikoordinasikan oleh Komite Mutu dan Keselamatan Pasien, mencakup pengukuran indikator mutu, pelaporan dan analisis insiden, pengukuran budaya keselamatan, serta manajemen risiko.`),
        ldJudul('B. Tujuan', 2), ...ldDaftar([`Menyajikan capaian indikator mutu dan tindak lanjutnya pada ${P.label}.`, 'Menyajikan gambaran insiden keselamatan pasien, penanganannya, dan budaya keselamatan.',
            'Menyajikan profil dan pengendalian risiko rumah sakit, termasuk hasil FMEA.', 'Menganalisis keterkaitan antarkomponen dan menyampaikan rekomendasi kepada Direktur.'], 'nomor'),
        ldJudul('C. Ruang Lingkup dan Metode', 2),
        ...ldParagraf(`Periode laporan ${P.label} (${P.awal} s.d. ${P.akhir}). Data diambil dari Sistem Informasi PMKP pada ${new Date(snap.disusun).toLocaleString('id-ID')}: capaian indikator dihitung oleh mesin rumus database dari data harian unit (atau arsip tutup tahun), laporan insiden (IKP dan KPC) beserta hasil investigasi, hasil survei budaya keselamatan, register risiko, profil risiko rumah sakit, dan proyek FMEA. Capaian periode dihitung dari total numerator dibagi total denominator seluruh bulan dalam periode (untuk indeks kepuasan dipakai rerata). Sebagai pembanding digunakan ${snap.pembanding.sebelumnya.label} dan ${snap.pembanding.tahunLalu.label}.

Pembahasan per komponen dan pembahasan terintegrasi disusun dengan bantuan analis kecerdasan buatan (AI) berdasarkan data agregat tanpa identitas pasien, kemudian diperiksa kesesuaian angkanya dan disunting oleh Komite Mutu.`)];

    // ---- BAB II MUTU ----
    const nMutu = ldNarasi(narasi, 'mutu');
    const kat = [['INM', 'Indikator Nasional Mutu (INM)'], ['IMP-RS', 'Indikator Mutu Prioritas Rumah Sakit (IMP-RS)'], ['Lainnya', 'Indikator Mutu Lainnya']];
    const bab2 = [ldJudul('BAB II\nCAPAIAN INDIKATOR MUTU', 1), ldJudul('A. Ringkasan Capaian', 2),
        ...ldTabel([{ judul: 'Kategori', lebar: 3 }, { judul: 'Jumlah indikator', lebar: 1.3, rata: 'tengah' }, { judul: 'Tercapai', lebar: 1.2, rata: 'tengah' }, { judul: 'Tidak tercapai', lebar: 1.3, rata: 'tengah' }, { judul: '% tercapai', lebar: 1.2, rata: 'tengah' }],
            ['INM', 'IMP-RS', 'IMP-Unit', 'Lainnya'].filter(k => m.ringkasan[k] && m.ringkasan[k].total).map(k => [k, String(m.ringkasan[k].total), String(m.ringkasan[k].tercapai), String(m.ringkasan[k].tidak), ldAngka(m.ringkasan[k].persen, '%')])
                .concat([[{ teks: 'Total', tebal: true }, { teks: String(m.ringkasan.total.total), tebal: true }, { teks: String(m.ringkasan.total.tercapai), tebal: true }, { teks: String(m.ringkasan.total.tidak), tebal: true }, { teks: ldAngka(m.ringkasan.total.persen, '%'), tebal: true }]])),
        ...ldGambar(grafik.mutuRingkas, 13, 'Gambar 2.1 Indikator tercapai dan tidak tercapai per kategori')];
    let hurufMutu = 1;
    kat.forEach(([k, nama]) => {
        const items = m.indikator.filter(i => i.jenis === k);
        if (!items.length) return;
        bab2.push(ldJudul(`${'BCDEFG'[hurufMutu - 1]}. ${nama}`, 2), ...ldTabelIndikator(items, snap, false), ...ldBlokIndikator(items, snap, grafik));
        hurufMutu++;
    });
    const impUnit = m.indikator.filter(i => i.jenis === 'IMP-Unit');
    if (impUnit.length) {
        bab2.push(ldJudul(`${'BCDEFG'[hurufMutu - 1]}. Indikator Mutu Prioritas Unit (IMP-Unit)`, 2),
            ldP(`Sebanyak ${impUnit.filter(i => !i.tidakLapor).length} IMP-Unit dilaporkan; ${m.ringkasan['IMP-Unit'] ? m.ringkasan['IMP-Unit'].tercapai : 0} tercapai. Grafik ditampilkan untuk indikator yang tidak tercapai.`),
            ...ldTabelIndikator(impUnit, snap, true), ...ldBlokIndikator(impUnit.filter(i => i.tercapai === false), snap, grafik));
        hurufMutu++;
    }
    const hm = i => 'BCDEFGHIJ'[hurufMutu - 1 + i];
    bab2.push(ldJudul(`${hm(0)}. Tindak Lanjut Perbaikan (PDSA)`, 2),
        ldP(`Dari ${m.pdsa.perlu} indikator yang tidak tercapai, ${m.pdsa.berjalan} memiliki PDSA yang sedang berjalan, ${m.pdsa.selesai} PDSA telah selesai, dan ${m.pdsa.belum} belum memiliki PDSA.`),
        ...ldTabel([{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Indikator / Unit', lebar: 2.6 }, { judul: 'Fase', lebar: 0.9, rata: 'tengah' }, { judul: 'Masalah & akar masalah', lebar: 2.6 }, { judul: 'Rencana tindakan', lebar: 2.4 }, { judul: 'Hasil (sebelum → sesudah)', lebar: 1.4, rata: 'tengah' }],
            m.pdsa.daftar.map((d, k) => [String(k + 1), `${d.judul}\n(${d.unit === 'RS' ? 'Rumah sakit' : d.unit})`, d.fase, [d.masalah, d.akar].filter(Boolean).join('\nAkar: ') || '-', d.rencana || '-', d.sebelum || d.sesudah ? `${d.sebelum || '-'} → ${d.sesudah || '-'}` : '-']),
            { kosong: 'Belum ada PDSA untuk indikator yang tidak tercapai.' }),
        ldJudul(`${hm(1)}. Keandalan Data: Kepatuhan Pelaporan dan Validasi`, 2),
        ldP(`Kepatuhan pelaporan data mutu ${ldAngka(m.kepatuhan.persen, '%')} (${m.kepatuhan.terisi} dari ${m.kepatuhan.wajib} formulir-bulan wajib, bulan dinilai: ${m.kepatuhan.bulanDinilai.join(', ') || '-'}); ${m.kepatuhan.unitLengkap} dari ${m.kepatuhan.jumlahUnit} unit melapor lengkap. Validasi data dilakukan pada ${m.validasi.sesi} sesi (${m.validasi.valid} valid, ${m.validasi.tidakValid} tidak valid${m.validasi.rerataAkurasi !== null ? ', rerata akurasi ' + ldAngka(m.validasi.rerataAkurasi, '%') : ''}); ${m.validasi.cakupanRs.tervalidasi} dari ${m.validasi.cakupanRs.total} indikator INM/IMP-RS telah divalidasi.`),
        ...ldTabel([{ judul: 'Unit', lebar: 3 }, { judul: 'Formulir', lebar: 1, rata: 'tengah' }, { judul: 'Terisi / wajib', lebar: 1.4, rata: 'tengah' }, { judul: 'Kepatuhan', lebar: 1.2, rata: 'tengah' }],
            m.kepatuhan.perUnit.map(k => [k.unit, String(k.formulir), `${k.terisi} / ${k.wajib}`, { teks: ldAngka(k.persen, '%'), warna: k.persen < 100 ? 'B42318' : undefined }])),
        ...(m.validasi.daftar.length ? ldTabel([{ judul: 'Indikator', lebar: 3 }, { judul: 'Unit', lebar: 2 }, { judul: 'Bulan', lebar: 1.1 }, { judul: 'Akurasi', lebar: 1, rata: 'tengah' }, { judul: 'Hasil', lebar: 1.2, rata: 'tengah' }],
            m.validasi.daftar.map(v => [v.judul, v.unit, v.bulan, ldAngka(v.akurasi, '%'), { teks: v.status, warna: v.status === 'VALID' ? '0B7A0B' : 'B42318' }])) : []),
        ldJudul(`${hm(2)}. Pembahasan Komponen Mutu`, 2), ...ldBagianNarasi(nMutu));

    // ---- BAB III KESELAMATAN PASIEN ----
    const nKes = ldNarasi(narasi, 'keselamatan'), nBud = ldNarasi(narasi, 'budaya');
    const J = LAP_JENIS_INSIDEN;
    const bab3 = [ldJudul('BAB III\nKESELAMATAN PASIEN DAN BUDAYA KESELAMATAN', 1), ldJudul('A. Pelaporan Insiden (IKP dan KPC)', 2),
        ldP(`Pada ${P.label} dilaporkan ${ins.total} kejadian (${ins.ikp} IKP dan ${ins.jenis.KPC || 0} KPC), dibanding ${ins.sebelumnya.total} pada ${snap.pembanding.sebelumnya.label} dan ${ins.tahunLalu.total} pada ${snap.pembanding.tahunLalu.label}. Rasio laporan nyaris cedera (KNC, KTC, KPC) terhadap cedera (KTD, Sentinel) ${ins.rasioNyarisCedera === null ? 'tidak dapat dihitung (tidak ada KTD/Sentinel)' : ins.rasioNyarisCedera + ' : 1'}.`),
        ...ldTabel([{ judul: 'Jenis', lebar: 2.4 }, { judul: snap.periode.pendek, lebar: 1.2, rata: 'tengah' }, { judul: snap.pembanding.sebelumnya.pendek, lebar: 1.2, rata: 'tengah' }, { judul: snap.pembanding.tahunLalu.pendek, lebar: 1.2, rata: 'tengah' }],
            J.map(j => [j, String(ins.jenis[j] || 0), String(ins.sebelumnya.jenis[j] || 0), String(ins.tahunLalu.jenis[j] || 0)])
                .concat([[{ teks: 'Total', tebal: true }, { teks: String(ins.total), tebal: true }, { teks: String(ins.sebelumnya.total), tebal: true }, { teks: String(ins.tahunLalu.total), tebal: true }]])),
        ...ldGambar(grafik.insidenBulanan, 14, 'Gambar 3.1 Laporan insiden per bulan menurut jenis'),
        ...ldGambar(grafik.grading, 12, 'Gambar 3.2 Grading risiko insiden'),
        ldJudul('B. Tipe Insiden dan Unit', 2),
        ...ldTabel([{ judul: 'Tipe insiden (hasil investigasi)', lebar: 4 }, { judul: 'Jumlah', lebar: 1, rata: 'tengah' }], ins.tipe.slice(0, 10).map(t => [t.tipe, String(t.n)]), { kosong: 'Belum ada insiden yang selesai diinvestigasi.' }),
        ...ldTabel([{ judul: 'Unit terkait', lebar: 3 }, { judul: 'Total', lebar: 1, rata: 'tengah' }, { judul: 'KTD/Sentinel', lebar: 1.2, rata: 'tengah' }, { judul: 'Merah/Kuning', lebar: 1.2, rata: 'tengah' }, { judul: 'KPC', lebar: 1, rata: 'tengah' }],
            ins.perUnit.slice(0, 12).map(u => [u.unit, String(u.total), String(u.ktd), String(u.merahKuning), String(u.kpc)])),
        ldJudul('C. Penanganan Insiden', 2),
        ...ldTabel([{ judul: 'Ukuran', lebar: 4 }, { judul: 'Nilai', lebar: 1.4, rata: 'tengah' }], [
            ['Laporan masuk ≤ 2x24 jam setelah kejadian', ldAngka(ins.persenTepatLapor, '%')], ['Laporan terlambat (> 2x24 jam)', String(ins.terlambatLapor)],
            ['Belum diverifikasi (status Baru)', String(ins.belumVerifikasi)], ['Investigasi RCA / sederhana', `${ins.investigasi.rca} / ${ins.investigasi.sederhana}`],
            ['Investigasi melewati batas waktu', String(ins.lewatBatas)], ['Tindak lanjut rekomendasi selesai / total', `${ins.tindakLanjut.selesai} / ${ins.tindakLanjut.total}`],
            ['Tindak lanjut terlambat', String(ins.tindakLanjut.terlambat)]]),
        ldJudul('D. Kejadian Sentinel', 2),
        ...ldTabel([{ judul: 'Tanggal', lebar: 1.4 }, { judul: 'Unit', lebar: 2.2 }, { judul: 'Status penanganan', lebar: 1.8 }, { judul: 'Lapor KNKP', lebar: 1.6, rata: 'tengah' }],
            ins.sentinel.map(s => [s.tanggal, s.unit, s.status, s.knkp ? `${s.knkp}${s.knkpTepat ? '' : ' (terlambat)'}` : { teks: 'Belum', warna: 'B42318', tebal: true }]), { kosong: 'Tidak ada kejadian sentinel.' }),
        ldJudul('E. Pembahasan Keselamatan Pasien', 2), ...ldBagianNarasi(nKes),
        ldJudul('F. Budaya Keselamatan Pasien', 2)];
    if (!bud.ada) bab3.push(ldP('Belum ada periode survei budaya keselamatan yang tercatat.'));
    else {
        const u = bud.utama;
        bab3.push(ldP(`${bud.jenis === 'periode' ? 'Survei yang dilaksanakan pada periode ini' : 'Tidak ada survei pada periode ini; disajikan hasil survei terakhir'}: ${u.nama} (${u.mulai} s.d. ${u.selesai}) dengan ${u.responden} responden${u.tingkatRespons !== null ? `, tingkat respons ${ldAngka(u.tingkatRespons, '%')} (target ${ldAngka(u.target, '%')})` : ''}.`));
        if (u.budaya) bab3.push(...ldTabel([{ judul: 'Budaya', lebar: 3 }, { judul: u.nama, lebar: 1.6, rata: 'tengah' }, ...(bud.sebelumnya && bud.sebelumnya.budaya ? [{ judul: bud.sebelumnya.nama, lebar: 1.6, rata: 'tengah' }] : [])],
            Object.keys(u.budaya).map(k => [k, ldAngka(u.budaya[k], '%'), ...(bud.sebelumnya && bud.sebelumnya.budaya ? [ldAngka(bud.sebelumnya.budaya[k], '%')] : [])])));
        bab3.push(...ldGambar(grafik.budaya, 15, 'Gambar 3.3 Dua belas dimensi budaya keselamatan (% respons positif)'));
    }
    bab3.push(ldJudul('G. Pembahasan Budaya Keselamatan', 2), ...ldBagianNarasi(nBud));

    // ---- BAB IV RISIKO ----
    const nRis = ldNarasi(narasi, 'risiko');
    const bab4 = [ldJudul('BAB IV\nMANAJEMEN RISIKO DAN FMEA', 1), ldJudul('A. Register Risiko', 2),
        ldP(`Terdapat ${r.jumlah} risiko terbuka (${r.baru} baru teridentifikasi pada periode ini, ${r.ditutup} ditutup). ${r.menungguVerifikasi} risiko menunggu verifikasi dan ${r.perluRevisi} perlu revisi.`),
        ...ldGambar(grafik.risiko, 12, 'Gambar 4.1 Risiko terbuka menurut tingkat'),
        ...ldTabel([{ judul: 'Kategori risiko', lebar: 4 }, { judul: 'Jumlah', lebar: 1, rata: 'tengah' }, { judul: 'Tinggi/Ekstrem', lebar: 1.3, rata: 'tengah' }], r.perKategori.map(k => [k.kategori, String(k.n), String(k.tinggiEkstrem)])),
        ldJudul('B. Pengendalian Risiko', 2),
        ...ldTabel([{ judul: 'Ukuran', lebar: 4 }, { judul: 'Nilai', lebar: 1.4, rata: 'tengah' }], [
            ['Rencana tindakan selesai / total', `${r.tindakan.selesai} / ${r.tindakan.total} (${ldAngka(r.tindakan.persenSelesai, '%')})`], ['Rencana tindakan melewati tenggat', String(r.tindakan.terlambat)],
            ['Review berkala dilakukan pada periode ini', String(r.review.dilakukan)], ['Risiko aktif yang jatuh tempo review', String(r.review.jatuhTempo)]]),
        ...ldTabel([{ judul: 'Unit', lebar: 3 }, { judul: 'Risiko', lebar: 1, rata: 'tengah' }, { judul: 'Tinggi/Ekstrem', lebar: 1.2, rata: 'tengah' }, { judul: 'Tindakan terlambat', lebar: 1.3, rata: 'tengah' }, { judul: 'Jatuh tempo review', lebar: 1.3, rata: 'tengah' }],
            r.perUnit.slice(0, 15).map(u => [u.unit, String(u.n), String(u.tinggiEkstrem), String(u.tindakanTerlambat), String(u.reviewJatuhTempo)])),
        ldJudul('C. Profil Risiko Rumah Sakit', 2),
        ldP(r.profil.sk ? `Profil risiko rumah sakit tahun ${P.tahun} ditetapkan dengan SK Direktur nomor ${r.profil.sk.nomor} tanggal ${r.profil.sk.tanggal}, berisi ${r.profil.jumlah} risiko.` : `Profil risiko rumah sakit tahun ${P.tahun} berisi ${r.profil.jumlah} risiko dan belum ditetapkan dengan SK Direktur.`),
        ...ldTabel([{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Kategori', lebar: 1.8 }, { judul: 'Risiko', lebar: 3 }, { judul: 'Unit', lebar: 1.4 }, { judul: 'Tingkat', lebar: 1, rata: 'tengah' }, { judul: 'Tindakan selesai', lebar: 1.1, rata: 'tengah' }],
            r.profil.daftar.map((x, k) => [String(k + 1), x.kategori, x.risiko, x.unit, x.tingkat, `${x.tindakanSelesai}/${x.tindakan}${x.tindakanTerlambat ? `\n(${x.tindakanTerlambat} terlambat)` : ''}`]), { kosong: 'Profil risiko belum disusun.' }),
        ldJudul('D. Failure Mode and Effects Analysis (FMEA)', 2),
        ...ldTabel([{ judul: 'Proses', lebar: 3 }, { judul: 'Status', lebar: 1, rata: 'tengah' }, { judul: 'Mode kegagalan', lebar: 1.1, rata: 'tengah' }, { judul: 'RPN ≥ 80', lebar: 1, rata: 'tengah' }, { judul: 'RPN awal → sesudah', lebar: 1.6, rata: 'tengah' }, { judul: 'Penurunan', lebar: 1.1, rata: 'tengah' }],
            f.proyek.map(p => [p.nama, p.status, String(p.mode), String(p.kritis), p.dinilaiUlang ? `${p.rpnAwal} → ${p.rpnSesudah}` : 'Belum dinilai ulang', ldAngka(p.turun, '%')]), { kosong: 'Tidak ada proyek FMEA.' }),
        ...ldGambar(grafik.fmea, 13, grafik.fmea ? 'Gambar 4.2 RPN sebelum dan sesudah tindakan' : null),
        ldJudul('E. Pembahasan Manajemen Risiko', 2), ...ldBagianNarasi(nRis)];

    // ---- BAB V INTEGRASI ----
    const nInt = ldNarasi(narasi, 'integrasi');
    const prio = lapUnitPrioritas(snap, 10);
    const bab5 = [ldJudul('BAB V\nANALISIS TERINTEGRASI', 1), ldJudul('A. Keterkaitan Antarkomponen', 2),
        ldP('Tabel berikut memetakan topik keselamatan yang muncul di lebih dari satu komponen (indikator mutu, insiden, risiko, FMEA) berdasarkan kata kunci pada nama indikator, tipe insiden, uraian risiko, dan proses FMEA.'),
        ...ldTabel([{ judul: 'Tema', lebar: 1.8 }, { judul: 'Indikator tidak tercapai', lebar: 3 }, { judul: 'Insiden (berat)', lebar: 1.1, rata: 'tengah' }, { judul: 'Risiko (tinggi/ekstrem)', lebar: 1.3, rata: 'tengah' }, { judul: 'FMEA', lebar: 1.8 }],
            snap.tema.filter(t => t.komponen >= 2).slice(0, 10).map(t => [t.tema, t.indikatorTidakTercapai.join('\n') || '-', `${t.insiden} (${t.insidenBerat})`, `${t.risiko} (${t.risikoTinggi})`, t.fmea.join('\n') || '-']),
            { kosong: 'Tidak ada tema yang muncul di lebih dari satu komponen.' }),
        ldJudul('B. Unit yang Memerlukan Pendampingan Terpadu', 2),
        ...ldTabel([{ judul: 'Unit', lebar: 2 }, { judul: 'Sinyal dari beberapa komponen', lebar: 5 }], prio.map(u => [u.unit, u.sinyal.join('; ')]), { kosong: 'Tidak ada unit dengan sinyal dari dua komponen atau lebih.' }),
        ldJudul('C. Pembahasan Terintegrasi', 2), ...ldBagianNarasi({ teks: nInt.teks, poin: nInt.poin }, { judulPoin: 'Keterkaitan utama:' }),
        ldJudul('D. Rekomendasi Strategis kepada Direktur', 2), ...ldBagianNarasi({ rekomendasi: nInt.rekomendasi }, { tenggat: true, judulRek: ' ' })];

    // ---- BAB VI TINDAK LANJUT ----
    const tl = snap.tindakLanjut;
    const bab6 = [ldJudul('BAB VI\nTINDAK LANJUT LAPORAN SEBELUMNYA', 1),
        ...(tl.disposisiTerakhir ? [ldP(`Disposisi Direktur atas ${tl.disposisiTerakhir.dari} (${tl.disposisiTerakhir.tanggal || '-'}):`, { tebal: true, setelah: 60 }), ...ldParagraf(tl.disposisiTerakhir.isi, { miring: true })] : []),
        ldP(`Dari ${tl.daftar.length} butir tindak lanjut yang dipantau, ${tl.selesai} selesai, ${tl.terbuka} masih berjalan, dan ${tl.terlambat} melewati tenggat.`),
        ...ldTabel([{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Butir tindak lanjut', lebar: 3.4 }, { judul: 'Sumber', lebar: 1.1 }, { judul: 'PIC / Unit', lebar: 1.6 }, { judul: 'Tenggat', lebar: 1.1, rata: 'tengah' }, { judul: 'Status', lebar: 1.1, rata: 'tengah' }],
            tl.daftar.map((d, k) => [String(k + 1), d.uraian + (d.progres ? `\nProgres: ${d.progres}` : ''), d.sumber === 'disposisi' ? 'Disposisi Direktur' : 'Rekomendasi', [d.pic, d.unit].filter(Boolean).join(' / ') || '-', d.tenggat || '-',
                { teks: d.status + (d.terlambat ? ' (terlambat)' : ''), warna: d.status === 'selesai' ? '0B7A0B' : d.terlambat ? 'B42318' : undefined }]), { kosong: 'Belum ada tindak lanjut dari laporan sebelumnya.' })];

    // ---- BAB VII PENUTUP ----
    const bab7 = [ldJudul('BAB VII\nPENUTUP', 1),
        ...ldParagraf(`Demikian Laporan Peningkatan Mutu dan Keselamatan Pasien Terintegrasi ${P.label} ini disusun sebagai bahan evaluasi dan pengambilan keputusan. Komite Mutu dan Keselamatan Pasien akan memantau pelaksanaan rekomendasi dan disposisi Direktur, dan melaporkan perkembangannya pada laporan periode berikutnya.`),
        ...ldTandaTangan(inst, [{ atas: 'Mengetahui,', jabatan: `Direktur ${nm}`, nama: inst.direktur_nama, nip: inst.direktur_nip },
                                { jabatan: 'Ketua Komite Mutu dan Keselamatan Pasien', nama: inst.ketua_komite_nama, nip: inst.ketua_komite_nip }], meta.tanggal),
        ldJudul('LEMBAR DISPOSISI DIREKTUR', 1),
        ...ldTabel([{ judul: 'Arahan / Disposisi Direktur', lebar: 1 }], [[meta.disposisi ? { teks: meta.disposisi } : { teks: '\n\n\n\n\n\n\n\n\n\n\n\n' }]]),
        ldP(`Tanggal disposisi: ${meta.tanggalDisposisi ? new Date(meta.tanggalDisposisi + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '....................................'}`, { setelah: 60 }),
        ...ldTandaTangan(inst, [{ jabatan: `Direktur ${nm}`, nama: inst.direktur_nama, nip: inst.direktur_nip }], meta.tanggalDisposisi || meta.tanggal),
        ...ldLembarTanggapan(snap, narasi, inst, meta)];

    const kepala = `Laporan PMKP Terintegrasi ${P.label}`;
    const seksi = [ldSeksi(sampul, { sampul: true, kepala }), ldSeksi([...pengantar, ...ringkasan, ...bab1, ...bab2, ...bab3, ...bab4, ...bab5, ...bab6], { kepala })];
    // Lampiran capaian bulanan (laporan > 6 bulan): lanskap
    if (P.bulan.length > 6) {
        const kol = [{ judul: 'Indikator', lebar: 3.2 }, { judul: 'Unit', lebar: 1.3 }, { judul: 'Target', lebar: 0.9, rata: 'tengah' }, ...P.namaBulan.map(b => ({ judul: b.slice(0, 3), lebar: 0.62, rata: 'tengah' })), { judul: 'Tahun', lebar: 0.8, rata: 'tengah' }];
        const lamp = [ldJudul('LAMPIRAN\nCAPAIAN BULANAN INDIKATOR MUTU', 1), ...ldTabel(kol, m.indikator.filter(i => !i.tidakLapor).map(i => [i.judul, i.unit === 'RS' ? 'RS' : i.unit, ldTarget(i),
            ...P.bulan.map(b => i.bulan[b] ? { teks: ldAngka(i.bulan[b].c), warna: i.bulan[b].ok === false ? 'B42318' : undefined } : '-'), { teks: ldAngka(i.nilai), tebal: true }]), { ukuran: 14, lebarTotal: 16838 - 2834 })];
        const s = ldSeksi(lamp, { kepala, lanskap: true });
        seksi.push(s);
    }
    // Penutup, lembar disposisi, dan lembar tanggapan Direktur selalu di akhir dokumen
    seksi.push(ldSeksi(bab7, { kepala }));
    return ldDokumen(`${judulLap} ${P.label}`, seksi);
}

// ---------------------------------------------------------------------
// LEMBAR TANGGAPAN DIREKTUR (halaman terakhir laporan Direksi).
// Kosong untuk diisi tangan; bila tanggapan sudah dicatat di sistem, isinya ditampilkan.
// ---------------------------------------------------------------------
const LD_KOMPONEN_TANGGAPAN = [
    ['mutu', 'Capaian indikator mutu dan PDSA (Bab II)'],
    ['keselamatan', 'Keselamatan pasien: IKP, KPC, dan penanganannya (Bab III A–E)'],
    ['budaya', 'Budaya keselamatan pasien (Bab III F–G)'],
    ['risiko', 'Manajemen risiko dan FMEA (Bab IV)'],
    ['integrasi', 'Analisis terintegrasi (Bab V) dan tindak lanjut (Bab VI)'],
    ['umum', 'Tanggapan umum / arahan lain']];
function ldLembarTanggapan(snap, narasi, inst, meta = {}) {
    const t = meta.tanggapan || {};
    const nm = inst.nama_rs || 'Rumah Sakit';
    const kosong = '\n\n';
    const rek = ((narasi && narasi.integrasi && narasi.integrasi.rekomendasi) || []).filter(r => (r.uraian || '').trim());
    const kep = { setuju: '☒ Setuju   ☐ Revisi   ☐ Tidak', revisi: '☐ Setuju   ☒ Revisi   ☐ Tidak', tidak: '☐ Setuju   ☐ Revisi   ☒ Tidak' };
    const cari = u => (t.rekomendasi || []).find(x => x.uraian === u) || {};
    return [ldJudul('LEMBAR TANGGAPAN DIREKTUR\nATAS LAPORAN PMKP TERINTEGRASI', 1),
        ...ldParagraf(`Diisi oleh Direktur atas Laporan PMKP Terintegrasi ${snap.periode.label}, lalu dikembalikan kepada Komite Mutu dan Keselamatan Pasien untuk dicatat dan dipantau tindak lanjutnya pada laporan periode berikutnya.`),
        ldJudul('A. Tanggapan per Komponen Laporan', 2),
        ...ldTabel([{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Komponen laporan', lebar: 2.6 }, { judul: 'Tanggapan / arahan Direktur', lebar: 5 }],
            LD_KOMPONEN_TANGGAPAN.map(([k, nama], i) => [String(i + 1), nama, (t[k] || '').trim() ? t[k] : kosong])),
        ldJudul('B. Keputusan atas Rekomendasi Strategis', 2),
        ...ldTabel([{ judul: 'No', lebar: 0.45, rata: 'tengah' }, { judul: 'Rekomendasi Komite Mutu', lebar: 3.3 }, { judul: 'Keputusan', lebar: 2.7, rata: 'tengah' }, { judul: 'Catatan Direktur', lebar: 2.1 }],
            rek.map((r, i) => { const c = cari(r.uraian); return [String(i + 1), r.uraian, kep[c.keputusan] || '☐ Setuju   ☐ Revisi   ☐ Tidak', c.catatan || '\n']; }),
            { kosong: 'Belum ada rekomendasi strategis.' }),
        ...ldTandaTangan(inst, [{ jabatan: `Direktur ${nm}`, nama: inst.direktur_nama, nip: inst.direktur_nip }], meta.tanggalDisposisi || meta.tanggal, { rapat: true })];
}

// ---------------------------------------------------------------------
// LAPORAN UMPAN BALIK UNIT
// ---------------------------------------------------------------------
function lapDokumenUnit(snap, unit, umpan, inst, meta = {}) {
    ldInstansiNomor = 0;
    return ldDokumen(`Umpan Balik ${unit} ${snap.periode.label}`, [ldSeksiUnit(snap, unit, umpan, inst, meta)]);
}
// Semua unit dalam satu dokumen (satu seksi per unit, masing-masing mulai di halaman baru)
function lapDokumenSemuaUnit(snap, daftar, inst, meta = {}) {
    ldInstansiNomor = 0;
    return ldDokumen(`Umpan Balik Unit ${snap.periode.label}`, daftar.map(d => ldSeksiUnit(snap, d.unit, d.umpan, inst, meta)));
}
function ldSeksiUnit(snap, unit, umpan, inst, meta = {}) {
    const u = snap.unit[unit], P = snap.periode;
    const ub = umpan || lapSaranAturan(u);
    const nb = P.bulan.length <= 6;
    const isi = [...ldKop(inst), ldP('UMPAN BALIK KINERJA MUTU DAN KESELAMATAN PASIEN', { rata: 'tengah', tebal: true, ukuran: 26, setelah: 60 }),
        ldP(`Unit: ${unit}`, { rata: 'tengah', tebal: true, setelah: 40 }), ldP(P.label, { rata: 'tengah', setelah: 240 }),
        ldP(`Kepada Yth. Kepala ${unit}`, { setelah: 60 }),
        ...ldParagraf(`Sebagai bagian dari Laporan Peningkatan Mutu dan Keselamatan Pasien Terintegrasi ${P.label}, Komite Mutu dan Keselamatan Pasien menyampaikan umpan balik kinerja unit Saudara sebagai bahan evaluasi dan perbaikan. Angka berikut berasal dari Sistem Informasi PMKP pada ${new Date(snap.disusun).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.`),
        ldJudul('A. Ringkasan', 2), ...(ub.ringkasan ? ldParagraf(ub.ringkasan) : [ldP(`${u.indikator.tercapai} dari ${u.indikator.total} indikator yang dilaporkan unit tercapai; kepatuhan pelaporan ${u.kepatuhan ? ldAngka(u.kepatuhan.persen, '%') : '-'}; ${u.insiden.terkait} insiden terkait unit; ${u.risiko.aktif} risiko aktif.`)]),
        ldJudul('B. Capaian Indikator Mutu', 2),
        ...ldTabel([{ judul: 'Indikator', lebar: 3 }, { judul: 'Target', lebar: 1, rata: 'tengah' }, ...(nb ? P.namaBulan.map(b => ({ judul: b.slice(0, 3), lebar: 0.8, rata: 'tengah' })) : []),
                    { judul: P.pendek, lebar: 1, rata: 'tengah' }, { judul: 'Sebelumnya', lebar: 1, rata: 'tengah' }, { judul: 'Status', lebar: 1.2, rata: 'tengah' }],
            u.indikator.daftar.map(x => [x.judul, ldTarget(x), ...(nb ? x.bulan.map(v => ldAngka(v)) : []), { teks: ldAngka(x.nilai), tebal: true }, ldAngka(x.sebelumnya), ldStatus(x.tercapai)]),
            { kosong: 'Unit tidak melaporkan indikator pada periode ini.' }),
        ldJudul('C. Kepatuhan Pelaporan dan Validasi Data', 2),
        ldP(`Kepatuhan pelaporan: ${u.kepatuhan ? `${ldAngka(u.kepatuhan.persen, '%')} (${u.kepatuhan.terisi} dari ${u.kepatuhan.wajib} formulir-bulan)` : 'unit tidak memiliki formulir wajib'}. Validasi data: ${u.validasi.sesi} sesi${u.validasi.tidakValid ? `, ${u.validasi.tidakValid} tidak valid` : ''}.`),
        ldJudul('D. Insiden Keselamatan Pasien', 2),
        ldP(`Insiden terkait unit: ${u.insiden.terkait} (${Object.entries(u.insiden.jenis).map(([j, n]) => `${j} ${n}`).join(', ') || '-'}); grading merah/kuning: ${u.insiden.merahKuning}. Laporan yang dikirim unit: ${u.insiden.dilaporkan}${u.insiden.terlambatLapor ? `, ${u.insiden.terlambatLapor} di antaranya lebih dari 2x24 jam` : ''}.${u.insiden.tipe.length ? ' Tipe: ' + u.insiden.tipe.join(', ') + '.' : ''}`),
        ldJudul('E. Manajemen Risiko', 2),
        ldP(`Risiko aktif ${u.risiko.aktif} (tinggi/ekstrem ${u.risiko.tinggiEkstrem}); draf/revisi ${u.risiko.draf}; menunggu verifikasi ${u.risiko.diajukan}. Rencana tindakan ${u.risiko.tindakanSelesai} dari ${u.risiko.tindakan} selesai${u.risiko.tindakanTerlambat ? `, ${u.risiko.tindakanTerlambat} terlambat` : ''}; ${u.risiko.reviewJatuhTempo} risiko jatuh tempo review.`),
        ...(u.risiko.daftarTinggi.length ? ldDaftar(u.risiko.daftarTinggi) : []),
        ldJudul('F. Apresiasi', 2), ...(ub.apresiasi && ub.apresiasi.length ? ldDaftar(ub.apresiasi) : [ldP('-')]),
        ldJudul('G. Hal yang Perlu Diperhatikan', 2), ...(ub.perhatian && ub.perhatian.length ? ldDaftar(ub.perhatian) : [ldP('Tidak ada catatan khusus.')]),
        ldJudul('H. Saran Tindak Lanjut', 2), ...(ub.saran && ub.saran.length ? ldDaftar(ub.saran, 'nomor') : [ldP('Pertahankan kinerja unit.')]),
        ...ldParagraf('Mohon rencana tindak lanjut atas saran di atas disampaikan kepada Komite Mutu dan Keselamatan Pasien paling lambat 14 hari setelah umpan balik ini diterima, dan dimasukkan ke PDSA atau register risiko unit bila relevan.', { sebelum: 160 }),
        ...ldTandaTangan(inst, [{ jabatan: 'Ketua Komite Mutu dan Keselamatan Pasien', nama: inst.ketua_komite_nama, nip: inst.ketua_komite_nip }], meta.tanggal)];
    return ldSeksi(isi, { kepala: `Umpan balik PMKP — ${unit} — ${P.pendek}` });
}

async function lapUnduhDokumen(doc, nama) {
    const blob = await ldDocx().Packer.toBlob(doc);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nama; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return blob;
}
const lapNamaBerkas = s => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');

if (typeof module !== 'undefined') module.exports = { ldLembarTanggapan, lapDokumenDireksi, lapDokumenUnit, lapDokumenSemuaUnit, ldGrafikLaporan };
