// =====================================================================
// engine_mutu.js - MESIN PERHITUNGAN CAPAIAN INDIKATOR (versi browser)
// =====================================================================
// SUMBER UTAMA perhitungan adalah DATABASE (fungsi hitung_capaian_mutu),
// dipakai Laporan Mutu, Laporan Terintegrasi, dan Tutup Tahun.
// File ini adalah salinan aturan yang SAMA PERSIS untuk:
//   - halaman Impor Data Lama (mencocokkan data sebelum diimpor),
//   - penjelasan / validasi template di pembangun rumus,
//   - hitungCapaianND / mutuPengali / cekTercapaiProfil untuk tampilan.
// Jika aturan diubah, ubah juga migrasi SQL (mutu_nilai_rumus, _mutu_hitung).
// =====================================================================

// ---------------------------------------------------------------------
// FORMAT TEMPLATE
//   {"tipe":"COUNTALL"}                                   jumlah semua baris
//   {"tipe":"COUNTALL","syarat":[{kolom,operator,nilai},...]}  jumlah baris yang memenuhi SEMUA syarat
//   {"tipe":"SUM","target_kolom":5,"syarat":[...]}         total angka kolom 5 (syarat opsional)
//   {"tipe":"KONSTAN","nilai":0.01}                        angka tetap
//   {"tipe":"GABUNGAN","bagian":[{"tanda":"+"|"-","id_form":"..."|null,"rumus":{...}}, ...]}
//        penjumlahan/pengurangan beberapa rumus; id_form = formulir lain
//        (unit & bulan yang sama), kosong = formulir indikator ini.
// Format lama tetap berlaku:
//   {"tipe":"COUNTIF","target_kolom":3,"operator":"==","nilai_kriteria":"Ya"}
//   {"tipe":"SUM","target_kolom":5,"syarat_kolom":2,"syarat_operator":"==","syarat_nilai":"Ya"}
// Operator: == | != | includes | excludes | > | >= | < | <= | kosong | tidak_kosong
// ---------------------------------------------------------------------

const MUTU_OPERATOR = {
    '==': 'sama dengan', '!=': 'tidak sama dengan', includes: 'mengandung', excludes: 'tidak mengandung',
    '>': 'lebih dari', '>=': 'lebih dari / sama dengan', '<': 'kurang dari', '<=': 'kurang dari / sama dengan',
    kosong: 'kosong', tidak_kosong: 'tidak kosong'
};

// Meniru parseFloat() & mutu_angka(): "12.5%" -> 12.5; teks -> null
function mutuAngka(v) {
    const n = parseFloat(v === null || v === undefined ? '' : String(v).trim());
    return isNaN(n) ? null : n;
}

// Meniru mutu_indeks(): hanya bilangan bulat >= 0 di awal teks
function mutuIndeks(v) {
    const m = String(v === null || v === undefined ? '' : v).trim().match(/^\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// Meniru jsonb ->> : null/undefined -> null, lainnya -> teks
function mutuTeks(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function mutuCocok(nilai, operator, kriteria) {
    const v = (nilai === null || nilai === undefined ? '' : String(nilai)).toLowerCase().trim();
    const k = (kriteria === null || kriteria === undefined ? '' : String(kriteria)).toLowerCase().trim();
    switch (operator || '==') {
        case '==': return v === k;
        case '!=': return v !== k;
        case 'includes': return v.includes(k);
        case 'excludes': return !v.includes(k);
        case 'kosong': return v === '';
        case 'tidak_kosong': return v !== '';
        case '>': case '>=': case '<': case '<=': {
            const a = mutuAngka(v), b = mutuAngka(k);
            if (a === null || b === null) return false;
            return operator === '>' ? a > b : operator === '>=' ? a >= b : operator === '<' ? a < b : a <= b;
        }
        default: return false;
    }
}

function mutuParseTemplate(template) {
    if (!template) return null;
    if (typeof template === 'object') return Array.isArray(template) ? null : template;
    const t = template.toString().trim();
    if (!(t.startsWith('{') && t.endsWith('}'))) return null;
    try { const o = JSON.parse(t); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null; } catch (e) { return null; }
}

// Semua syarat terpenuhi (daftar kosong = lolos). Sama dengan mutu_syarat_ok.
function mutuSyaratOk(d, syarat) {
    if (!Array.isArray(syarat)) return true;
    return syarat.every(s => {
        const i = mutuIndeks(mutuTeks(s && s.kolom));
        return i !== null && mutuCocok(mutuTeks(d[i]), s.operator, mutuTeks(s.nilai));
    });
}

// Kontribusi SATU baris (sama dengan mutu_nilai_rumus). KONSTAN/GABUNGAN -> 0 di sini.
function mutuNilaiRumus(rule, dataInput) {
    if (!rule) return 0;
    const d = dataInput || [];
    if ('syarat' in rule && !mutuSyaratOk(d, rule.syarat)) return 0;
    const idx = mutuIndeks(mutuTeks(rule.target_kolom));
    if (rule.tipe === 'COUNTALL') return 1;
    if (rule.tipe === 'COUNTIF') {
        if (idx === null) return ('syarat' in rule) ? 1 : 0;
        return mutuCocok(mutuTeks(d[idx]), rule.operator, mutuTeks(rule.nilai_kriteria)) ? 1 : 0;
    }
    if (rule.tipe === 'SUM') {
        if (idx === null) return 0;
        const sk = mutuTeks(rule.syarat_kolom);
        if (sk !== null && sk !== '') {
            const sidx = mutuIndeks(sk);
            if (sidx === null || !mutuCocok(mutuTeks(d[sidx]), rule.syarat_operator, mutuTeks(rule.syarat_nilai))) return 0;
        }
        return mutuAngka(mutuTeks(d[idx])) || 0;
    }
    return 0;
}

// Pecah template menjadi bagian [{id_form|null, tanda: 1|-1, rumus}] (sama dengan mutu_bagian)
function mutuBagian(t) {
    if (!t) return [];
    if (t.tipe !== 'GABUNGAN') return [{ id_form: null, tanda: 1, rumus: t }];
    if (!Array.isArray(t.bagian)) return [];
    return t.bagian
        .filter(b => b && b.rumus && typeof b.rumus === 'object' && !Array.isArray(b.rumus))
        .map(b => ({ id_form: (b.id_form && String(b.id_form).trim()) || null, tanda: b.tanda === '-' ? -1 : 1, rumus: b.rumus }));
}

// Nilai N atau D untuk satu kelompok unit x bulan.
//   rows       : baris formulir indikator (unit & bulan tsb)
//   ambilBaris : (id_form) => baris formulir lain untuk unit & bulan yang sama (opsional)
function eksekusiRumusEngine(template, rows, colsConfig, ambilBaris) {
    const rule = mutuParseTemplate(template);
    if (!rule) return 0;
    const jumlah = (r, baris) => (baris || []).reduce((acc, x) => acc + mutuNilaiRumus(r, x.data_input), 0);
    return mutuBagian(rule).reduce((acc, b) => {
        if (b.rumus.tipe === 'KONSTAN') return acc + b.tanda * (mutuAngka(mutuTeks(b.rumus.nilai)) || 0);
        const baris = b.id_form ? (ambilBaris ? ambilBaris(b.id_form) : []) : rows;
        return acc + b.tanda * jumlah(b.rumus, baris);
    }, 0);
}

// Apakah profil indikator punya template engine yang valid?
function indikatorPakaiEngine(profil) {
    return !!(mutuParseTemplate(profil.template_numerator) || mutuParseTemplate(profil.template_denominator));
}

// Pengali satuan (sama dengan mutu_pengali): % / persen -> 100, permil / ‰ -> 1000
function mutuPengali(satuan) {
    const s = (satuan || '').toString();
    if (/permil/i.test(s) || s.includes('‰')) return 1000;
    if (s.includes('%') || /persen/i.test(s)) return 100;
    return 1;
}

// Pembulatan 2 desimal seperti round() Postgres (menjauhi nol)
function mutuBulat2(x) {
    return Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
}

// Capaian dari N/D (dibulatkan 2 desimal); null jika D <= 0.
function hitungCapaianND(N, D, satuan) {
    if (!(D > 0)) return null;
    return mutuBulat2(N / D * mutuPengali(satuan));
}

/**
 * Hitung semua kelompok unit x bulan untuk satu indikator (sama dengan _mutu_hitung).
 * @param ind   { id_form, satuan, unit_pelaksana, template_numerator, template_denominator }
 * @param semua array baris data_mutu_harian ({unit_kerja, id_indikator, bulan, data_input})
 *              — boleh berisi banyak formulir; indeks dibuat sekali lalu bisa dipakai ulang
 *              lewat mutuIndeksBaris(semua).
 * @returns [{unit_kerja, bulan, jumlah_baris, numerator, denominator, capaian}]
 */
function mutuIndeksBaris(semua) {
    if (semua && semua.__indeksMutu) return semua.__indeksMutu;
    const peta = new Map();   // form -> Map("unit|bulan" -> rows)
    (semua || []).forEach(r => {
        if (!peta.has(r.id_indikator)) peta.set(r.id_indikator, new Map());
        const m = peta.get(r.id_indikator); const k = `${r.unit_kerja}|${r.bulan}`;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
    });
    try { Object.defineProperty(semua, '__indeksMutu', { value: peta, enumerable: false }); } catch (e) { }
    return peta;
}

function hitungKelompokIndikator(ind, semua) {
    const tn = mutuParseTemplate(ind.template_numerator), td = mutuParseTemplate(ind.template_denominator);
    if (!ind.id_form || (!tn && !td)) return [];
    const peta = mutuIndeksBaris(semua);
    const formDipakai = new Set([ind.id_form]);
    [tn, td].forEach(t => mutuBagian(t).forEach(b => { if (b.id_form && b.rumus.tipe !== 'KONSTAN') formDipakai.add(b.id_form); }));

    // Kelompok kandidat: unit x bulan dari semua formulir yang dibaca
    const kandidat = new Set();
    formDipakai.forEach(f => (peta.get(f) || new Map()).forEach((_, k) => kandidat.add(k)));
    const utama = peta.get(ind.id_form) || new Map();
    const unitSah = new Set([...utama.keys()].map(k => k.split('|')[0]));
    const up = (ind.unit_pelaksana || '').trim();
    if (up) unitSah.add(up);

    const hasil = [];
    kandidat.forEach(k => {
        const [unit, bulanStr] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
        const rows = utama.get(k) || [];
        if (!rows.length && !unitSah.has(unit)) return;
        const ambil = f => (peta.get(f) || new Map()).get(k) || [];
        const N = tn ? eksekusiRumusEngine(tn, rows, null, ambil) : 0;
        const D = td ? eksekusiRumusEngine(td, rows, null, ambil) : 0;
        hasil.push({ unit_kerja: unit, bulan: parseInt(bulanStr, 10), jumlah_baris: rows.length, numerator: N, denominator: D, capaian: hitungCapaianND(N, D, ind.satuan) });
    });
    return hasil;
}

// Tercapai / tidak menurut arah target di profil. null jika capaian null.
function cekTercapaiProfil(profil, capaian) {
    if (capaian === null || capaian === undefined) return null;
    const target = parseFloat(profil.target) || 0;
    const arah = (profil.arah_target || "Positif").toLowerCase();
    if (arah.includes("kecil") || arah.includes("negatif") || arah.includes("≤")) return capaian <= target;
    return capaian >= target;
}

// Ringkasan Tutup Tahun dari hasil database (rpc hitung_capaian_mutu):
// satu baris per INDIKATOR x UNIT x BULAN. Kolom arsip `unit_pelaksana`
// diisi unit yang melapor, sehingga rincian per unit & RLS per unit berlaku.
function susunRingkasanDariHasil(tahun, masterIndikator, hasilDb) {
    const profil = new Map(masterIndikator.map(p => [p.id_indikator, p]));
    return hasilDb.filter(h => profil.has(h.id_indikator)).map(h => {
        const p = profil.get(h.id_indikator);
        const C = h.capaian === null || h.capaian === undefined ? null : Number(h.capaian);
        return {
            tahun, bulan: h.bulan, id_indikator: p.id_indikator,
            judul_indikator: p.judul_indikator, kategori_indikator: p.kategori_indikator,
            unit_pelaksana: h.unit_kerja,
            numerator: Number(h.numerator) || 0, denominator: Number(h.denominator) || 0, capaian: C,
            // Target & arah dari versi yang berlaku di bulan itu (hitung_capaian_mutu), bila ada
            target: parseFloat(h.target ?? p.target) || 0, satuan: p.satuan,
            is_tercapai: cekTercapaiProfil({ ...p, target: h.target ?? p.target, arah_target: h.arah_target ?? p.arah_target }, C)
        };
    });
}

// Penjelasan template dalam bahasa sehari-hari.
//   kolomPerForm: (id_form|null) => [{judul}] ; atau langsung array kolom formulir indikator
function jelaskanTemplate(teks, kolomPerForm) {
    const t = mutuParseTemplate(teks);
    if (!t) return '(belum ada rumus)';
    const ambilKolom = typeof kolomPerForm === 'function' ? kolomPerForm : (() => kolomPerForm || []);
    const satu = (r, form) => {
        const kol = ambilKolom(form) || [];
        const nama = i => { const k = kol[parseInt(i, 10)]; return k ? `[${i}] ${k.judul}` : `[${i}] (kolom tidak ada)`; };
        const syarat = (i, op, v) => `${nama(i)} ${MUTU_OPERATOR[op || '=='] || op}${(op === 'kosong' || op === 'tidak_kosong') ? '' : ` "${v ?? ''}"`}`;
        const daftar = [];
        if (r.tipe === 'COUNTIF' && r.target_kolom !== undefined && r.target_kolom !== null && String(r.target_kolom) !== '') daftar.push(syarat(r.target_kolom, r.operator, r.nilai_kriteria));
        if (r.tipe === 'SUM' && r.syarat_kolom !== undefined && r.syarat_kolom !== null && String(r.syarat_kolom) !== '') daftar.push(syarat(r.syarat_kolom, r.syarat_operator, r.syarat_nilai));
        if (Array.isArray(r.syarat)) r.syarat.forEach(s => daftar.push(syarat(s.kolom, s.operator, s.nilai)));
        const dg = daftar.length ? ` dengan ${daftar.join(' DAN ')}` : '';
        const asal = form ? ` di formulir ${form}` : '';
        if (r.tipe === 'KONSTAN') return `angka tetap ${r.nilai}`;
        if (r.tipe === 'COUNTALL' || r.tipe === 'COUNTIF') return (daftar.length ? `jumlah baris${dg}` : 'jumlah semua baris') + asal;
        if (r.tipe === 'SUM') return `total ${nama(r.target_kolom)}${asal}${daftar.length ? `, hanya baris${dg}` : ''}`;
        return '(tipe rumus tidak dikenal)';
    };
    const bag = mutuBagian(t);
    if (!bag.length) return '(rumus gabungan kosong)';
    const teksBagian = bag.map((b, i) => (i === 0 ? (b.tanda < 0 ? '− ' : '') : (b.tanda < 0 ? ' − ' : ' + ')) + satu(b.rumus, b.id_form));
    const s = teksBagian.join('');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Periksa template: indeks kolom harus ada di formulirnya. Mengembalikan daftar masalah.
//   kolomPerForm: (id_form|null) => array kolom | undefined (formulir tidak ada)
function periksaTemplate(teks, kolomPerForm) {
    const t = mutuParseTemplate(teks);
    if (!t) return ['belum ada rumus'];
    const masalah = [];
    const bag = mutuBagian(t);
    if (!bag.length) masalah.push('rumus gabungan kosong');
    bag.forEach(b => {
        const r = b.rumus;
        if (!['COUNTALL', 'COUNTIF', 'SUM', 'KONSTAN'].includes(r.tipe)) { masalah.push(`tipe "${r.tipe}" tidak dikenal`); return; }
        if (r.tipe === 'KONSTAN') { if (mutuAngka(mutuTeks(r.nilai)) === null) masalah.push('angka tetap belum diisi'); return; }
        const kol = kolomPerForm(b.id_form);
        if (!kol) { masalah.push(`formulir "${b.id_form}" tidak ada di Form Builder`); return; }
        const cek = (i, label) => { const x = mutuIndeks(mutuTeks(i)); if (x === null || x >= kol.length) masalah.push(`${label} [${i}] tidak ada di formulir${b.id_form ? ' ' + b.id_form : ''} (${kol.length} kolom)`); };
        if (r.tipe === 'SUM') cek(r.target_kolom, 'kolom jumlah');
        if (r.tipe === 'COUNTIF' && r.target_kolom !== undefined && String(r.target_kolom) !== '') cek(r.target_kolom, 'kolom syarat');
        if (r.tipe === 'SUM' && r.syarat_kolom !== undefined && r.syarat_kolom !== null && String(r.syarat_kolom) !== '') cek(r.syarat_kolom, 'kolom syarat');
        (Array.isArray(r.syarat) ? r.syarat : []).forEach(s => cek(s.kolom, 'kolom syarat'));
    });
    return masalah;
}

// Indikator yang TIDAK tercapai beberapa bulan berturut-turut per unit, beserta status PDSA-nya.
//   master : profil indikator ({id_indikator, id_form, judul_indikator, target, arah_target, ...})
//   hasilDb: baris rpc hitung_capaian_mutu (indikator x unit x bulan)
//   pdsa   : baris data_pdsa ({unit_kerja, id_indikator, judul_indikator, fase_saat_ini, tanggal_dibuat})
//   opsi   : { tahun, bulanAkhir (bulan terakhir yang dinilai), minBeruntun = 3 }
// Deret dihitung mundur dari bulan terakhir yang ada capaiannya (paling lambat 1 bulan sebelum
// bulanAkhir); bulan tanpa data atau bulan tercapai memutus deret.
function cariTidakTercapaiBeruntun(master, hasilDb, pdsa, opsi) {
    const minB = opsi.minBeruntun || 3;
    const profil = new Map(master.map(p => [p.id_indikator, p]));
    const norm = t => (t || '').toString().trim().toLowerCase();
    const kelompok = new Map();
    hasilDb.forEach(h => {
        if (h.capaian === null || h.capaian === undefined || !profil.has(h.id_indikator)) return;
        if (h.bulan > opsi.bulanAkhir) return;
        const k = h.id_indikator + '|' + h.unit_kerja;
        if (!kelompok.has(k)) kelompok.set(k, { id: h.id_indikator, unit: h.unit_kerja, bulan: new Map(), versi: new Map() });
        kelompok.get(k).bulan.set(h.bulan, Number(h.capaian));
        kelompok.get(k).versi.set(h.bulan, { target: h.target, arah_target: h.arah_target });
    });
    const hasil = [];
    kelompok.forEach(g => {
        const p = profil.get(g.id);
        if (p.target === null || p.target === undefined || String(p.target).trim() === '' || isNaN(parseFloat(p.target))) return;
        const akhir = Math.max(...g.bulan.keys());
        if (akhir < opsi.bulanAkhir - 1) return;           // sudah lama tidak melapor
        const deret = [];
        for (let b = akhir; b >= 1 && g.bulan.has(b); b--) {
            const ver = g.versi.get(b) || {};
            if (cekTercapaiProfil({ ...p, target: ver.target ?? p.target, arah_target: ver.arah_target ?? p.arah_target }, g.bulan.get(b)) !== false) break;
            deret.unshift({ bulan: b, capaian: g.bulan.get(b) });
        }
        if (deret.length < minB) return;
        const mulai = deret[0].bulan;
        const cocok = (pdsa || []).filter(d => d.unit_kerja === g.unit &&
            (d.id_profil ? d.id_profil === p.id_indikator
                : (d.id_indikator === p.id_form || d.id_indikator === p.id_indikator || (norm(d.judul_indikator) && norm(d.judul_indikator) === norm(p.judul_indikator)))))
            .sort((a, b) => String(b.tanggal_dibuat || '').localeCompare(String(a.tanggal_dibuat || '')));
        const aktif = cocok.find(d => (d.fase_saat_ini || '').toUpperCase() !== 'SELESAI');
        const batas = `${opsi.tahun}-${String(mulai).padStart(2, '0')}-01`;
        const selesaiBaru = cocok.find(d => (d.fase_saat_ini || '').toUpperCase() === 'SELESAI' && String(d.tanggal_dibuat || '') >= batas);
        hasil.push({
            profil: p, unit: g.unit, deret, panjang: deret.length, bulanMulai: mulai, bulanAkhir: akhir,
            statusPdsa: aktif ? 'aktif' : selesaiBaru ? 'selesai' : 'belum',
            pdsa: aktif || selesaiBaru || null
        });
    });
    const urut = { belum: 0, selesai: 1, aktif: 2 };
    return hasil.sort((a, b) => urut[a.statusPdsa] - urut[b.statusPdsa] || b.panjang - a.panjang
        || (a.profil.judul_indikator || '').localeCompare(b.profil.judul_indikator || '', 'id') || a.unit.localeCompare(b.unit, 'id'));
}

if (typeof module !== 'undefined') module.exports = {
    mutuAngka, mutuIndeks, mutuCocok, mutuParseTemplate, mutuSyaratOk, mutuNilaiRumus, mutuBagian,
    eksekusiRumusEngine, indikatorPakaiEngine, mutuPengali, hitungCapaianND, hitungKelompokIndikator,
    cekTercapaiProfil, susunRingkasanDariHasil, jelaskanTemplate, periksaTemplate, MUTU_OPERATOR,
    cariTidakTercapaiBeruntun, mutuBulat2
};
