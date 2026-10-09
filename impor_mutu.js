// =====================================================================
// impor_mutu.js - MESIN KONVERSI DATA MUTU DARI GOOGLE SHEET (XLSX)
// =====================================================================
// Mengubah isi sheet formulir unit (hasil unduhan Google Sheet .xlsx)
// menjadi baris `data_mutu_harian` dengan format yang SAMA PERSIS seperti
// yang disimpan halaman Input Mutu:
//   - tanggal  -> "DD/MM/YYYY"      - jam      -> "HH:mm:ss"
//   - checkbox -> "Ya" / "Tidak"    - angka tetap angka, teks di-trim
//   - data_input = array sesuai URUTAN KOLOM formulir di Supabase
//
// Fungsi-fungsi di sini murni (tanpa akses database / DOM) supaya bisa
// diuji terpisah. Dipakai oleh impor_data_lama.html.
// =====================================================================

const IMPOR_BULAN = {
    januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
    agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, ags: 8,
    agust: 8, sep: 9, sept: 9, okt: 10, nov: 11, des: 12
};

function imporNormal(s) {
    return String(s ?? '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function imporKosong(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// Nama sheet Excel maksimal 31 karakter -> cocokkan dengan id_form (persis / awalan unik)
function imporCariIdForm(namaSheet, daftarIdForm) {
    const n = imporNormal(namaSheet);
    const persis = daftarIdForm.find(id => imporNormal(id) === n);
    if (persis) return { id: persis };
    const awalan = daftarIdForm.filter(id => imporNormal(id).startsWith(n));
    if (awalan.length === 1) return { id: awalan[0] };
    if (awalan.length > 1) return { id: null, alasan: `Nama sheet ambigu: cocok dengan ${awalan.join(', ')}` };
    return { id: null, alasan: 'Tidak ada formulir dengan nama ini di Form Builder' };
}

const dua = n => String(n).padStart(2, '0');

function imporApakahJamSaja(d) {
    // Excel menyimpan jam tanpa tanggal sebagai 30/12/1899 (atau 1900-01-0x untuk durasi)
    return d.getUTCFullYear() <= 1900;
}

function imporFormatNilai(v, tipe) {
    const t = (tipe || '').toLowerCase();
    if (t === 'checkbox') {
        if (v === true || v === 1) return 'Ya';
        const s = imporNormal(v);
        return (s === 'ya' || s === 'true' || s === '1' || s === 'y') ? 'Ya' : 'Tidak';
    }
    if (imporKosong(v)) return null;
    if (v instanceof Date) {
        const jam = `${dua(v.getUTCHours())}:${dua(v.getUTCMinutes())}:${dua(v.getUTCSeconds())}`;
        if (t === 'time' || t === 'durasi_hms' || imporApakahJamSaja(v)) {
            if (t === 'durasi_hms' && imporApakahJamSaja(v)) {
                // durasi bisa > 24 jam: hitung dari titik nol Excel (30/12/1899)
                const detik = Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 1000);
                return `${dua(Math.floor(detik / 3600))}:${dua(Math.floor(detik % 3600 / 60))}:${dua(detik % 60)}`;
            }
            return jam;
        }
        return `${dua(v.getUTCDate())}/${dua(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        // Angka yang tersimpan sebagai teks: "12" / "12,5" / "12.5" -> angka
        if ((t === 'numeric' || t === 'number') && /^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
        return s;
    }
    if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
    return v; // angka
}

// Bulan dari sebuah nilai sel: Date, "Januari", "12/03/2026", "2026-03-12", 3
function imporBacaBulan(v) {
    if (imporKosong(v)) return null;
    if (v instanceof Date) return imporApakahJamSaja(v) ? null : v.getUTCMonth() + 1;
    if (typeof v === 'number') return (v >= 1 && v <= 12 && Number.isInteger(v)) ? v : null;
    const s = imporNormal(v);
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);      // dd/mm/yyyy
    if (m) { const b = parseInt(m[2]); return b >= 1 && b <= 12 ? b : null; }
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);            // yyyy-mm-dd
    if (m) { const b = parseInt(m[2]); return b >= 1 && b <= 12 ? b : null; }
    for (const kata of s.split(/[^a-z]+/)) {
        if (IMPOR_BULAN[kata]) return IMPOR_BULAN[kata];
    }
    return null;
}

// Pilih kolom penentu bulan (aturan sama dengan Input Mutu + cadangan nama bulan)
function imporKolomPeriode(kolomDef, headerSheet, baris) {
    // 1) kolom tanggal di definisi formulir
    let idx = kolomDef.findIndex(k => ['date', 'calendar'].includes((k.tipe || '').toLowerCase()) || imporNormal(k.judul).includes('tanggal'));
    if (idx !== -1) return { kolom: idx, sumber: 'definisi' };
    // 2) kolom berjudul bulan / periode
    idx = kolomDef.findIndex(k => /\b(bulan|periode)\b/.test(imporNormal(k.judul)));
    if (idx !== -1) return { kolom: idx, sumber: 'definisi' };
    // 3) kolom sheet yang >= 80% isinya nama bulan / tanggal (mis. "Realisasi Pemeliharaan")
    let terbaik = null;
    headerSheet.forEach((h, i) => {
        const isi = baris.map(r => r[i]).filter(v => !imporKosong(v));
        if (isi.length === 0) return;
        const cocok = isi.filter(v => imporBacaBulan(v) !== null).length / isi.length;
        if (cocok >= 0.8 && (!terbaik || cocok > terbaik.skor || (cocok === terbaik.skor && /realisasi/.test(imporNormal(h))))) {
            terbaik = { kolomSheet: i, skor: cocok };
        }
    });
    if (terbaik) return { kolomSheet: terbaik.kolomSheet, sumber: 'tebakan' };
    return null;
}

/**
 * Konversi satu sheet formulir.
 * @param sheet     { nama, rows }   rows[0] = header
 * @param formulir  Map id_form -> kolom[] ({judul, tipe, formula})  (dari Supabase setup_formulir)
 * @param unit      nama unit (master_unit.nama_unit)
 * @param opsi      { tahun: 2026, petugas: 'Impor Google Sheet' }
 */
function imporKonversiSheet(sheet, formulir, unit, opsi = {}) {
    const tahun = opsi.tahun || 2026;
    const petugas = opsi.petugas || 'Impor Google Sheet';
    const hasil = { namaSheet: sheet.nama, idForm: null, baris: [], bermasalah: [], catatan: [], kolomSheetDiabaikan: [], kolomFormulirKosong: [] };

    const cari = imporCariIdForm(sheet.nama, [...formulir.keys()]);
    if (!cari.id) { hasil.catatan.push(cari.alasan); hasil.dilewati = true; return hasil; }
    hasil.idForm = cari.id;
    const kolomDef = formulir.get(cari.id) || [];

    const header = (sheet.rows[0] || []).map(h => (h === null || h === undefined) ? '' : String(h));
    const data = sheet.rows.slice(1);

    // Peta kolom sheet -> indeks kolom formulir (berdasarkan judul)
    const petaSheetKeForm = new Map();
    const judulForm = kolomDef.map(k => imporNormal(k.judul));
    header.forEach((h, i) => {
        const n = imporNormal(h);
        if (!n || n === 'status laporan') return;
        const j = judulForm.findIndex((jf, jdx) => jf === n && ![...petaSheetKeForm.values()].includes(jdx));
        if (j !== -1) petaSheetKeForm.set(i, j);
        else hasil.kolomSheetDiabaikan.push(h);
    });
    const kolomTerisi = new Set(petaSheetKeForm.values());
    hasil.kolomFormulirKosong = kolomDef.filter((_, i) => !kolomTerisi.has(i)).map(k => k.judul);
    if (petaSheetKeForm.size === 0) {
        hasil.catatan.push('Tidak ada satu pun judul kolom yang cocok dengan formulir di Form Builder');
        hasil.dilewati = true; return hasil;
    }

    const periode = imporKolomPeriode(kolomDef, header, data);
    let idxPeriodeSheet = null;
    if (periode && periode.sumber === 'definisi') {
        for (const [s, f] of petaSheetKeForm) if (f === periode.kolom) idxPeriodeSheet = s;
    } else if (periode) {
        idxPeriodeSheet = periode.kolomSheet;
        hasil.catatan.push(`Bulan diambil dari kolom "${header[idxPeriodeSheet]}"`);
    }
    if (idxPeriodeSheet === null) hasil.catatan.push('Tidak ditemukan kolom tanggal/bulan');

    // Hanya tipe READONLY yang terisi otomatis (rumus di tipe lain = sisa lama, diabaikan)
    const kolomInput = kolomDef.map(k => (k.tipe || '').toLowerCase().trim() !== 'readonly');

    data.forEach((row, r) => {
        const nomorBaris = r + 2; // nomor baris di Excel
        const dataInput = kolomDef.map(() => null);
        let adaIsi = false;
        for (const [s, f] of petaSheetKeForm) {
            const nilai = imporFormatNilai(row[s], kolomDef[f].tipe);
            dataInput[f] = nilai;
            if (kolomInput[f] && nilai !== null && !((kolomDef[f].tipe || '').toLowerCase() === 'checkbox' && nilai === 'Tidak')) adaIsi = true;
        }
        if (!adaIsi) return; // baris kosong

        const bulan = idxPeriodeSheet === null ? null : imporBacaBulan(row[idxPeriodeSheet]);
        if (!bulan) {
            hasil.bermasalah.push({ baris: nomorBaris, alasan: idxPeriodeSheet === null ? 'Formulir tanpa kolom tanggal/bulan' : 'Tanggal/bulan kosong atau tidak terbaca', nilai: idxPeriodeSheet === null ? '' : String(row[idxPeriodeSheet] ?? '') });
            return;
        }

        // Semua data sistem lama adalah tahun 2026: betulkan tahun salah ketik pada kolom periode
        if (idxPeriodeSheet !== null && petaSheetKeForm.has(idxPeriodeSheet)) {
            const f = petaSheetKeForm.get(idxPeriodeSheet);
            if (typeof dataInput[f] === 'string') {
                dataInput[f] = dataInput[f].replace(/^(\d{2}\/\d{2}\/)(\d{4})$/, (_, a, y) => {
                    if (Number(y) !== tahun) hasil.tahunDibetulkan = (hasil.tahunDibetulkan || 0) + 1;
                    return a + tahun;
                });
            }
        }

        hasil.baris.push({ unit_kerja: unit, id_indikator: cari.id, bulan, tahun, petugas_input: petugas, data_input: dataInput });
    });
    return hasil;
}

// Tebak unit dari nama file (mis. DB_MUTU_UGD.xlsx -> "Unit Gawat Darurat")
const IMPOR_SINGKATAN_UNIT = {
    ugd: ['gawat darurat', 'igd', 'ugd'], igd: ['gawat darurat', 'igd'], rajal: ['rawat jalan'], icu: ['rawat intensif', 'icu'],
    vk: ['kamar bersalin', 'vk'], perina: ['perinatologi'], ok: ['kamar operasi'], rm: ['rekam medis'],
    ipsrs: ['pemeliharaan sarana', 'ipsrs'], cssd: ['sterilisasi', 'cssd'], kesling: ['kesehatan lingkungan', 'kesling'],
    pemulasara: ['pemulasaraan', 'jenazah'], driver: ['pengemudi', 'ambulans'], keuangan: ['keuangan'],
    admin: ['administrasi', 'kepegawaian'], promkes: ['promosi kesehatan', 'promkes'], penjaminan: ['penjaminan'],
    ppi: ['ppi'], pengadaan: ['pengadaan'], elektromedis: ['elektromedis'], farmasi: ['farmasi'], gizi: ['gizi'],
    laboratorium: ['laboratorium'], radiologi: ['radiologi'], kasir: ['kasir'], keamanan: ['keamanan'],
    parang: ['parang'], truntum: ['truntum']
};
function imporTebakUnit(namaFile, daftarUnit) {
    const inti = imporNormal(namaFile.replace(/\.xlsx$/i, '').replace(/^(database|db)[ _]mutu[ _](unit[ _])?/i, ''));
    const semua = daftarUnit.map(u => ({ u, n: imporNormal(u) }));
    const persis = semua.find(x => x.n === inti || x.n === 'unit ' + inti);
    if (persis) return persis.u;
    const kunci = inti.split(/[^a-z]+/).filter(Boolean);
    for (const k of kunci.slice().reverse()) {
        for (const kata of (IMPOR_SINGKATAN_UNIT[k] || [])) {
            const c = semua.filter(x => x.n.includes(kata));
            if (c.length === 1) return c[0].u;
        }
    }
    const c = semua.filter(x => kunci.length && kunci.every(k => x.n.includes(k)));
    return c.length === 1 ? c[0].u : '';
}

if (typeof module !== 'undefined') {
    module.exports = { imporKonversiSheet, imporCariIdForm, imporFormatNilai, imporBacaBulan, imporKolomPeriode, imporTebakUnit, imporNormal };
}
