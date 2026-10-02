// =====================================================================
// laporan_data.js — kompilasi data Laporan Periodik Terintegrasi
// (triwulan / semester / tahunan): mutu, keselamatan pasien (IKP, KPC),
// budaya keselamatan, manajemen risiko & FMEA, keterkaitan antar komponen,
// matriks per unit, cek kesiapan, konteks untuk analis AI, dan pemeriksa
// angka (grounding) untuk narasi AI.
//
// Butuh: config.js (supabaseClient, ambilSemua, ambilSemuaBaris, esc),
//        engine_mutu.js (hitungCapaianND, mutuBulat2), risiko_skala.js.
// Semua angka capaian berasal dari mesin database (hitung_capaian_mutu)
// atau arsip Tutup Tahun, sama dengan Laporan Mutu.
// =====================================================================

const LAP_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const LAP_ROMAWI = ['I', 'II', 'III', 'IV'];
const LAP_GRADING = ['Merah', 'Kuning', 'Hijau', 'Biru'];
const LAP_JENIS_INSIDEN = ['Sentinel', 'KTD', 'KNC', 'KTC', 'KPC'];
const LAP_TINGKAT = ['Ekstrem', 'Tinggi', 'Moderat', 'Rendah'];

// ---------------------------------------------------------------------
// Periode
// ---------------------------------------------------------------------
function lapPeriode(jenis, nomor, tahun) {
    tahun = Number(tahun); nomor = Number(nomor) || 1;
    const bulan = jenis === 'triwulan' ? [1, 2, 3].map(b => (nomor - 1) * 3 + b)
        : jenis === 'semester' ? [1, 2, 3, 4, 5, 6].map(b => (nomor - 1) * 6 + b)
        : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const label = jenis === 'triwulan' ? `Triwulan ${LAP_ROMAWI[nomor - 1]} Tahun ${tahun}`
        : jenis === 'semester' ? `Semester ${LAP_ROMAWI[nomor - 1]} Tahun ${tahun}` : `Tahun ${tahun}`;
    const pendek = jenis === 'triwulan' ? `TW ${LAP_ROMAWI[nomor - 1]} ${tahun}` : jenis === 'semester' ? `Smt ${LAP_ROMAWI[nomor - 1]} ${tahun}` : `${tahun}`;
    const dd = n => String(n).padStart(2, '0');
    const akhirBln = bulan[bulan.length - 1];
    return {
        jenis, nomor, tahun, bulan, label, pendek,
        namaBulan: bulan.map(b => LAP_BULAN[b - 1]),
        awal: `${tahun}-${dd(bulan[0])}-01`,
        akhir: `${tahun}-${dd(akhirBln)}-${dd(new Date(tahun, akhirBln, 0).getDate())}`
    };
}
function lapPeriodeSebelumnya(p) {
    if (p.jenis === 'tahunan') return lapPeriode('tahunan', 1, p.tahun - 1);
    const maks = p.jenis === 'triwulan' ? 4 : 2;
    return p.nomor > 1 ? lapPeriode(p.jenis, p.nomor - 1, p.tahun) : lapPeriode(p.jenis, maks, p.tahun - 1);
}
const lapPeriodeTahunLalu = p => lapPeriode(p.jenis, p.nomor, p.tahun - 1);
function lapHariIni() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

// ---------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------
const lapAngka = v => (v === null || v === undefined || String(v).trim() === '' || isNaN(Number(v))) ? null : Number(v);
const lapBulat = (x, d = 2) => x === null || x === undefined || isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
const lapPersen = (a, b) => b > 0 ? lapBulat(a / b * 100, 1) : null;
// Angka gaya Indonesia (koma desimal); % tanpa spasi
const lapFmt = (v, satuan) => {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '-';
    const t = Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const st = String(satuan || '').trim();
    return /^%|persen/i.test(st) ? t + '%' : st ? `${t} ${st}` : t;
};
const lapHitung = (arr, kunci) => arr.reduce((o, x) => { const k = typeof kunci === 'function' ? kunci(x) : x[kunci]; o[k] = (o[k] || 0) + 1; return o; }, {});
function lapJenisIndikator(kat) {
    const j = (kat || '').toLowerCase();
    if (j.includes('nasional') || /\binm\b/.test(j)) return 'INM';
    if (j.includes('imp-rs') || j.includes('imp rs') || (j.includes('prioritas') && (/\brs\b/.test(j) || j.includes('rumah sakit')))) return 'IMP-RS';
    if (j.includes('unit')) return 'IMP-Unit';
    return 'Lainnya';
}
function lapArahKecil(arah) { const a = (arah || '').toLowerCase(); return a.includes('kecil') || a.includes('negatif') || a.includes('≤') || a.includes('<='); }
function lapTercapai(capaian, target, arah) {
    if (capaian === null || capaian === undefined || target === null || target === undefined || isNaN(target)) return null;
    return lapArahKecil(arah) ? capaian <= target : capaian >= target;
}
async function lapAmbil(label, buat) {
    const r = await ambilSemua(buat);
    if (r.error) throw new Error(`${label}: ${r.error.message}`);
    return r.data || [];
}
async function lapAmbilOpsional(label, buat, catatan) {
    const r = await ambilSemua(buat);
    if (r.error) { catatan.push(`${label} tidak dapat dibaca (${r.error.message}). Jalankan migrasi terbaru.`); return []; }
    return r.data || [];
}

// ---------------------------------------------------------------------
// Pengambilan data (butuh supabaseClient)
// ---------------------------------------------------------------------
async function lapCapaianBulanan(tahun, bulan) {
    const live = await ambilSemuaBaris(() => supabaseClient.rpc('hitung_capaian_mutu', { p_tahun: tahun, p_bulan: bulan })
        .order('id_indikator').order('unit_kerja').order('bulan'));
    const arsip = await lapAmbil('Arsip capaian', () => supabaseClient.from('arsip_capaian_mutu').select('*').eq('tahun', tahun).in('bulan', bulan).order('id'));
    const ada = new Set(live.map(r => `${r.id_indikator}|${r.unit_kerja}|${r.bulan}`));
    arsip.forEach(a => {
        const k = `${a.id_indikator}|${a.unit_pelaksana}|${a.bulan}`;
        if (ada.has(k)) return;
        live.push({ id_indikator: String(a.id_indikator), unit_kerja: a.unit_pelaksana, bulan: a.bulan, numerator: a.numerator, denominator: a.denominator,
                    capaian: a.capaian, target: a.target, arah_target: null, arsip: true });
    });
    return live;
}

async function lapAmbilInsiden(p) {
    return lapAmbil('Insiden', () => supabaseClient.from('data_insiden').select('*')
        .gte('waktu_insiden', `${p.awal}T00:00:00`).lte('waktu_insiden', `${p.akhir}T23:59:59.999`).order('id_insiden'));
}

async function lapKumpulkanSumber(p, log = () => {}) {
    const catatan = [];
    const ps = lapPeriodeSebelumnya(p), pl = lapPeriodeTahunLalu(p);
    log('Membaca profil indikator & unit...');
    const [master, unit, pdsa] = await Promise.all([
        lapAmbil('Profil indikator', () => supabaseClient.from('master_indikator').select('*').neq('status_aktif', false).order('id_indikator')),
        lapAmbil('Unit', () => supabaseClient.from('master_unit').select('nama_unit, daftar_form').order('nama_unit')),
        lapAmbil('PDSA', () => supabaseClient.from('data_pdsa').select('*').order('id_pdsa'))
    ]);
    // Hak Akses Kolom formulir (Form Builder): menentukan unit pelapor tiap indikator pada formulir bersama
    const formulir = await lapAmbilOpsional('Struktur formulir', () => supabaseClient.from('setup_formulir').select('id_form, kolom').order('id_form'), catatan);
    log(`Menghitung capaian ${p.label} di database...`);
    const capKini = await lapCapaianBulanan(p.tahun, p.bulan);
    log(`Menghitung pembanding ${ps.label}${ps.label !== pl.label ? ' dan ' + pl.label : ''}...`);
    const capSebelum = await lapCapaianBulanan(ps.tahun, ps.bulan);
    const capTahunLalu = pl.label === ps.label ? capSebelum : await lapCapaianBulanan(pl.tahun, pl.bulan);

    log('Membaca kepatuhan pelaporan, kunci periode, dan validasi...');
    const [kepatuhan, kunci, validasi] = await Promise.all([
        ambilSemuaBaris(() => supabaseClient.rpc('kepatuhan_pelaporan_mutu', { p_tahun: p.tahun }).order('unit_kerja').order('id_form').order('bulan')),
        lapAmbilOpsional('Kunci periode', () => supabaseClient.from('kunci_periode_mutu').select('tahun, bulan, unit_kerja').eq('tahun', p.tahun).order('id'), catatan),
        lapAmbilOpsional('Sesi validasi', () => supabaseClient.from('validasi_sesi').select('id, tahun, bulan, unit_kerja, id_indikator, judul_indikator, status, akurasi, status_validasi, jumlah_sampel')
            .eq('tahun', p.tahun).in('bulan', p.bulan).order('id'), catatan)
    ]);

    log('Membaca insiden (IKP & KPC)...');
    const [insiden, insidenSebelum, insidenTahunLalu] = await Promise.all([lapAmbilInsiden(p), lapAmbilInsiden(ps),
        pl.label === ps.label ? Promise.resolve(null) : lapAmbilInsiden(pl)]);
    let tindakLanjutInsiden = [];
    const ids = insiden.map(i => i.id_insiden);
    for (let i = 0; i < ids.length; i += 80) {
        tindakLanjutInsiden = tindakLanjutInsiden.concat(await lapAmbilOpsional('Tindak lanjut insiden',
            () => supabaseClient.from('insiden_tindak_lanjut').select('id, id_insiden, status, tenggat, selesai_pada').in('id_insiden', ids.slice(i, i + 80)).order('id'), catatan));
    }

    log('Membaca survei budaya keselamatan...');
    const periodeSurvei = await lapAmbilOpsional('Periode survei', () => supabaseClient.from('survei_budaya_periode').select('*').order('tanggal_mulai'), catatan);
    const surveiDipakai = lapPilihSurvei(p, periodeSurvei);
    const idSurvei = [surveiDipakai.utama, surveiDipakai.sebelumnya].filter(Boolean).map(x => x.id);
    const [stafSurvei, jawabanSurvei] = idSurvei.length ? await Promise.all([
        lapAmbilOpsional('Jumlah staf survei', () => supabaseClient.from('survei_budaya_staf').select('*').in('id_periode', idSurvei).order('unit_kerja'), catatan),
        lapAmbilOpsional('Jawaban survei', () => supabaseClient.from('data_survey_budaya').select('id_survey, id_periode, unit_kerja, profesi, jawaban_survey').in('id_periode', idSurvei).order('id_survey'), catatan)
    ]) : [[], []];

    log('Membaca register risiko, profil risiko RS, dan FMEA...');
    const [risiko, tindakanRisiko, reviewRisiko, profil, sk, fmea] = await Promise.all([
        lapAmbil('Register risiko', () => supabaseClient.from('data_risiko').select('*').order('id_risiko')),
        lapAmbilOpsional('Tindakan risiko', () => supabaseClient.from('risiko_tindakan').select('*').order('id'), catatan),
        lapAmbilOpsional('Review risiko', () => supabaseClient.from('risiko_review').select('*').gte('tanggal', p.awal).lte('tanggal', p.akhir).order('id'), catatan),
        lapAmbilOpsional('Profil risiko', () => supabaseClient.from('profil_risiko_item').select('*').eq('tahun', p.tahun).order('id'), catatan),
        lapAmbilOpsional('SK profil risiko', () => supabaseClient.from('profil_risiko_sk').select('*').eq('tahun', p.tahun).order('tahun'), catatan),
        lapAmbil('FMEA', () => supabaseClient.from('data_fmea').select('*').order('id_proyek'))
    ]);

    log('Membaca tindak lanjut laporan sebelumnya...');
    const [laporanLain, tindakLanjutLaporan] = await Promise.all([
        lapAmbilOpsional('Laporan periodik', () => supabaseClient.from('laporan_periodik').select('id, jenis, tahun, nomor, judul, status, disposisi_direktur, tanggal_disposisi').order('tahun'), catatan),
        lapAmbilOpsional('Tindak lanjut laporan', () => supabaseClient.from('laporan_tindak_lanjut').select('*').order('dibuat_pada'), catatan)
    ]);

    return { p, ps, pl, master, unit, formulir, pdsa, capKini, capSebelum, capTahunLalu, kepatuhan, kunci, validasi,
             insiden, insidenSebelum, insidenTahunLalu, tindakLanjutInsiden, periodeSurvei, surveiDipakai, stafSurvei, jawabanSurvei,
             risiko, tindakanRisiko, reviewRisiko, profil, sk, fmea, laporanLain, tindakLanjutLaporan, catatan, hariIni: lapHariIni() };
}

// Survei yang dilaporkan: periode yang beririsan dengan periode laporan; bila tidak ada,
// survei terakhir sebelum akhir periode (ditandai "terakhir").
function lapPilihSurvei(p, daftar) {
    const urut = (daftar || []).slice().sort((a, b) => String(a.tanggal_mulai).localeCompare(String(b.tanggal_mulai)));
    const beririsan = urut.filter(s => s.tanggal_mulai <= p.akhir && s.tanggal_selesai >= p.awal);
    let utama = beririsan[beririsan.length - 1] || null, jenis = 'periode';
    if (!utama) { const lalu = urut.filter(s => s.tanggal_mulai <= p.akhir); utama = lalu[lalu.length - 1] || null; jenis = 'terakhir'; }
    const idx = utama ? urut.indexOf(utama) : -1;
    return { utama, jenis, sebelumnya: idx > 0 ? urut[idx - 1] : null };
}

// =====================================================================
// SUSUN SNAPSHOT (fungsi murni: bisa diuji tanpa database)
// =====================================================================
function lapSusunSnapshot(S) {
    const p = S.p;
    const mutu = lapSusunMutu(S);
    const insiden = lapSusunInsiden(S);
    const budaya = lapSusunBudaya(S);
    const risiko = lapSusunRisiko(S);
    const fmea = lapSusunFmea(S);
    const tindakLanjut = lapSusunTindakLanjut(S);
    const snap = {
        versi_format: 1,
        periode: { jenis: p.jenis, nomor: p.nomor, tahun: p.tahun, label: p.label, pendek: p.pendek, bulan: p.bulan, namaBulan: p.namaBulan, awal: p.awal, akhir: p.akhir },
        pembanding: { sebelumnya: { label: S.ps.label, pendek: S.ps.pendek }, tahunLalu: { label: S.pl.label, pendek: S.pl.pendek } },
        disusun: new Date().toISOString(),
        mutu, insiden, budaya, risiko, fmea, tindakLanjut,
        catatan: S.catatan || []
    };
    snap.tema = lapSusunTema(snap, S);
    snap.unit = lapSusunUnit(snap, S);
    snap.kesiapan = lapCekKesiapan(snap, S);
    return snap;
}

// ---------------------------------------------------------------------
// MUTU
// ---------------------------------------------------------------------
function lapNilaiKelompok(rows, satuan, rataRata) {
    // rows: baris hasil hitung (bisa beberapa unit / bulan)
    const sah = rows.filter(r => r);
    if (!sah.length) return { n: null, d: null, c: null };
    let N = 0, D = 0; const cs = [];
    sah.forEach(r => { N += lapAngka(r.numerator) || 0; D += lapAngka(r.denominator) || 0; const c = lapAngka(r.capaian); if (c !== null) cs.push(c); });
    if (rataRata || (D === 0 && cs.length)) return { n: lapBulat(N), d: lapBulat(D), c: cs.length ? lapBulat(cs.reduce((a, b) => a + b, 0) / cs.length) : null, rata: true };
    return { n: lapBulat(N), d: lapBulat(D), c: hitungCapaianND(N, D, satuan) };
}

function lapSusunMutu(S) {
    const p = S.p;
    const idxCap = rows => { const m = new Map(); rows.forEach(r => { const k = String(r.id_indikator); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
    // Hanya unit yang melaporkan formulir indikator (Pengaturan Unit Kerja), bukan unit pelaksana di profil
    // ... dan hanya unit yang berhak mengisi kolom rumus indikator (Hak Akses Kolom di Form Builder)
    const peta = mutuPasangAksesKolom(mutuPetaFormUnit(S.unit), S.formulir || [], S.master), formDari = new Map(S.master.map(m => [String(m.id_indikator), m.id_form]));
    const diabaikan = new Set(), tanpaAkses = new Set();
    const sahUnit = rows => rows.filter(r => {
        const ok = mutuUnitMelaporkan(peta, r.unit_kerja, formDari.get(String(r.id_indikator)), r.id_indikator);
        if (!ok && formDari.has(String(r.id_indikator))) (mutuUnitBerhakIndikator(peta, r.unit_kerja, r.id_indikator) ? diabaikan : tanpaAkses).add(`${r.unit_kerja}|${r.id_indikator}`);
        return ok;
    });
    const kini = idxCap(sahUnit(S.capKini)), sebelum = idxCap(sahUnit(S.capSebelum)), lalu = idxCap(sahUnit(S.capTahunLalu));
    if (diabaikan.size) (S.catatan = S.catatan || []).push(`${diabaikan.size} kombinasi unit × indikator tidak dihitung karena formulirnya tidak terdaftar untuk unit tersebut di Pengaturan Unit Kerja.`);
    if (tanpaAkses.size) (S.catatan = S.catatan || []).push(`${tanpaAkses.size} kombinasi unit × indikator tidak dihitung karena unit tersebut tidak berhak mengisi kolom rumus indikatornya (Hak Akses Kolom di Form Builder).`);
    const indikator = [], perUnit = [];
    const pdsaUntuk = (prof, unit) => S.pdsa.filter(d => (d.id_profil ? d.id_profil === prof.id_indikator : (d.id_indikator === prof.id_form || d.id_indikator === prof.id_indikator))
        && (!unit || !d.unit_kerja || d.unit_kerja === unit));
    const statusPdsa = (daftar) => {
        // PDSA dengan periode analisis dalam 12 bulan terakhir s.d. akhir periode laporan
        const akhirIdx = p.tahun * 12 + p.bulan[p.bulan.length - 1];
        const idx = d => {
            const t = Number(d.periode_tahun), b = Number(d.periode_bulan);
            if (t && b) return t * 12 + b;
            const tg = String(d.tanggal_dibuat || '');
            return tg.length >= 7 ? Number(tg.slice(0, 4)) * 12 + Number(tg.slice(5, 7)) : null;
        };
        const dalam = daftar.filter(d => { const i = idx(d); return i !== null && i <= akhirIdx && i > akhirIdx - 12; })
            .sort((a, b) => idx(a) - idx(b));
        const aktif = dalam.find(d => (d.fase_saat_ini || '').toUpperCase() !== 'SELESAI');
        const selesai = dalam.filter(d => (d.fase_saat_ini || '').toUpperCase() === 'SELESAI').pop();
        const d = aktif || selesai;
        if (!d) return { status: 'belum' };
        const plan = d.plan_data || {}, study = d.study_data || {}, act = d.act_data || {};
        const aksi = Array.isArray(plan.action) ? plan.action : [];
        return { status: aktif ? 'berjalan' : 'selesai', fase: d.fase_saat_ini || '-', periode: d.periode_analisis || '',
                 masalah: plan.masalah || '', akar: plan.akar || '', rencana: (aksi[0] && (aksi[0].act || aksi[0].kegiatan)) || '',
                 sebelum: study.data_sebelum || '', sesudah: study.data_sesudah || '', keputusan: act.keputusan || '' };
    };

    S.master.forEach(prof => {
        const id = String(prof.id_indikator);
        const jenis = lapJenisIndikator(prof.kategori_indikator);
        const rataRata = /kepuasan/i.test(prof.judul_indikator || '');
        const rowsKini = kini.get(id) || [], rowsSeb = sebelum.get(id) || [], rowsLalu = lalu.get(id) || [];
        if (!rowsKini.length && !rowsSeb.length && !rowsLalu.length) return;
        const satuan = prof.satuan || '';
        const targetDari = rows => { const t = rows.map(r => lapAngka(r.target)).filter(x => x !== null); return t.length ? t[t.length - 1] : lapAngka(prof.target); };
        const arahDari = rows => (rows.find(r => r.arah_target) || {}).arah_target || prof.arah_target || '';
        const susun = (rows, unit) => {
            const bulan = {};
            p.bulan.forEach(b => {
                const rb = rows.filter(r => Number(r.bulan) === b);
                const v = lapNilaiKelompok(rb, satuan, rataRata);
                const t = targetDari(rb.length ? rb : rows);
                bulan[b] = v.c === null ? null : { c: v.c, n: v.n, d: v.d, t, ok: lapTercapai(v.c, t, arahDari(rows)) };
            });
            const per = lapNilaiKelompok(rows, satuan, rataRata);
            const target = targetDari(rows.slice().sort((a, b) => a.bulan - b.bulan));
            const arah = arahDari(rows);
            let beruntun = 0;
            for (let i = p.bulan.length - 1; i >= 0; i--) { const x = bulan[p.bulan[i]]; if (x && x.ok === false) beruntun++; else break; }
            return { bulan, nilai: per.c, n: per.n, d: per.d, rata: !!per.rata, target, arah, tercapai: lapTercapai(per.c, target, arah), beruntun,
                     tidakTercapaiBulan: p.bulan.filter(b => bulan[b] && bulan[b].ok === false).length };
        };
        const banding = (rowsA, unit) => { const r = unit ? rowsA.filter(x => x.unit_kerja === unit) : rowsA; return lapNilaiKelompok(r, satuan, rataRata).c; };
        const arahTren = (a, b, arah) => a === null || b === null ? null : a === b ? 'tetap' : ((a > b) !== lapArahKecil(arah) ? 'membaik' : 'memburuk');
        const dasar = { id, judul: prof.judul_indikator, jenis, satuan, form: prof.id_form };

        // Per unit (semua kategori) — dipakai matriks & umpan balik unit
        const unitList = [...new Set(rowsKini.map(r => r.unit_kerja))].filter(Boolean).sort();
        unitList.forEach(u => {
            const r = susun(rowsKini.filter(x => x.unit_kerja === u), u);
            const seb = banding(rowsSeb, u);
            perUnit.push({ ...dasar, unit: u, ...r, sebelumnya: seb, tren: arahTren(r.nilai, seb, r.arah), pdsa: r.tercapai === false || r.beruntun ? statusPdsa(pdsaUntuk(prof, u)) : null });
        });

        if (jenis === 'IMP-Unit') {
            perUnit.filter(x => x.id === id).forEach(x => indikator.push({ ...x, sebelumnya: x.sebelumnya, tahunLalu: banding(rowsLalu, x.unit) }));
            if (!unitList.length && rowsSeb.length) indikator.push({ ...dasar, unit: prof.unit_pelaksana || '-', bulan: {}, nilai: null, target: lapAngka(prof.target), arah: prof.arah_target, tercapai: null, beruntun: 0, sebelumnya: banding(rowsSeb), tahunLalu: banding(rowsLalu), tidakLapor: true });
        } else {
            const r = susun(rowsKini, null);
            const seb = banding(rowsSeb), ly = banding(rowsLalu);
            indikator.push({ ...dasar, unit: 'RS', ...r, sebelumnya: seb, tahunLalu: ly, tren: arahTren(r.nilai, seb, r.arah),
                             jumlahUnit: unitList.length, pdsa: r.tercapai === false || r.beruntun ? statusPdsa(pdsaUntuk(prof, null)) : null,
                             tidakLapor: !rowsKini.length });
        }
    });

    const urutJenis = { 'INM': 0, 'IMP-RS': 1, 'IMP-Unit': 2, 'Lainnya': 3 };
    indikator.sort((a, b) => urutJenis[a.jenis] - urutJenis[b.jenis] || String(a.unit).localeCompare(String(b.unit), 'id') || String(a.judul).localeCompare(String(b.judul), 'id'));
    const ringkasan = {};
    ['INM', 'IMP-RS', 'IMP-Unit', 'Lainnya'].forEach(j => {
        const xs = indikator.filter(i => i.jenis === j && !i.tidakLapor);
        if (!xs.length && j === 'Lainnya') return;
        ringkasan[j] = { total: xs.length, tercapai: xs.filter(i => i.tercapai === true).length, tidak: xs.filter(i => i.tercapai === false).length,
                         tanpaTarget: xs.filter(i => i.tercapai === null).length, persen: lapPersen(xs.filter(i => i.tercapai === true).length, xs.filter(i => i.tercapai !== null).length) };
    });
    const semua = indikator.filter(i => !i.tidakLapor && i.tercapai !== null);
    ringkasan.total = { total: semua.length, tercapai: semua.filter(i => i.tercapai).length, tidak: semua.filter(i => !i.tercapai).length, persen: lapPersen(semua.filter(i => i.tercapai).length, semua.length) };

    // PDSA
    const perluPdsa = indikator.filter(i => i.tercapai === false || i.beruntun);
    const pdsa = {
        perlu: perluPdsa.length,
        berjalan: perluPdsa.filter(i => i.pdsa && i.pdsa.status === 'berjalan').length,
        selesai: perluPdsa.filter(i => i.pdsa && i.pdsa.status === 'selesai').length,
        belum: perluPdsa.filter(i => !i.pdsa || i.pdsa.status === 'belum').length,
        daftar: perluPdsa.filter(i => i.pdsa && i.pdsa.status !== 'belum').map(i => ({ judul: i.judul, unit: i.unit, ...i.pdsa }))
    };

    // Validasi (sesi selesai pada bulan periode)
    const vs = S.validasi.filter(v => v.status === 'selesai');
    const indRs = indikator.filter(i => (i.jenis === 'INM' || i.jenis === 'IMP-RS') && !i.tidakLapor);
    const tervalidasi = new Set(vs.map(v => String(v.id_indikator)));
    const validasi = {
        sesi: vs.length, valid: vs.filter(v => v.status_validasi === 'VALID').length, tidakValid: vs.filter(v => v.status_validasi === 'TIDAK VALID').length,
        rerataAkurasi: vs.length ? lapBulat(vs.reduce((a, v) => a + (lapAngka(v.akurasi) || 0), 0) / vs.length, 1) : null,
        cakupanRs: { tervalidasi: indRs.filter(i => tervalidasi.has(i.id)).length, total: indRs.length },
        daftar: vs.map(v => ({ judul: v.judul_indikator, unit: v.unit_kerja, bulan: LAP_BULAN[v.bulan - 1], akurasi: lapAngka(v.akurasi), status: v.status_validasi }))
    };

    // Kepatuhan pelaporan: formulir wajib x bulan (acuan daftar formulir unit)
    const terisi = new Set(S.kepatuhan.filter(k => p.bulan.includes(Number(k.bulan)) && Number(k.jumlah) > 0).map(k => `${k.unit_kerja}|${k.id_form}|${k.bulan}`));
    const batasBulan = p.bulan.filter(b => `${p.tahun}-${String(b).padStart(2, '0')}` < S.hariIni.slice(0, 7));
    const kepUnit = S.unit.map(u => {
        const form = String(u.daftar_form || '').split(',').map(s => s.trim()).filter(Boolean);
        const wajib = form.length * batasBulan.length;
        const ada = form.reduce((a, f) => a + batasBulan.filter(b => terisi.has(`${u.nama_unit}|${f}|${b}`)).length, 0);
        return { unit: u.nama_unit, formulir: form.length, wajib, terisi: ada, persen: lapPersen(ada, wajib) };
    }).filter(k => k.wajib > 0);
    const totW = kepUnit.reduce((a, k) => a + k.wajib, 0), totT = kepUnit.reduce((a, k) => a + k.terisi, 0);
    const kepatuhan = { persen: lapPersen(totT, totW), wajib: totW, terisi: totT, unitLengkap: kepUnit.filter(k => k.persen === 100).length, jumlahUnit: kepUnit.length,
                        bulanDinilai: batasBulan.map(b => LAP_BULAN[b - 1]), perUnit: kepUnit.sort((a, b) => a.persen - b.persen) };

    return { ringkasan, indikator, perUnit, pdsa, validasi, kepatuhan };
}

// ---------------------------------------------------------------------
// INSIDEN (IKP & KPC) — tanpa kronologi / identitas
// ---------------------------------------------------------------------
function lapUnitInsiden(r) { return (r.detail_spesifik && r.detail_spesifik.unit_penyebab) || r.unit_terkait || r.unit_pelapor || 'Tidak diketahui'; }
function lapTipeInsiden(r) {
    const t = r.investigasi_komite && r.investigasi_komite.tipe_insiden;
    return t ? String(t).split(' | ')[0].trim() : null;
}
function lapRingkasInsiden(rows) {
    const jenis = {}; LAP_JENIS_INSIDEN.forEach(j => jenis[j] = 0);
    rows.forEach(r => { const j = LAP_JENIS_INSIDEN.includes(r.jenis_insiden) ? r.jenis_insiden : 'Lainnya'; jenis[j] = (jenis[j] || 0) + 1; });
    return { total: rows.length, jenis, ikp: rows.filter(r => r.jenis_insiden !== 'KPC').length };
}
function lapSusunInsiden(S) {
    const p = S.p, rows = S.insiden, hariIni = S.hariIni;
    const dasar = lapRingkasInsiden(rows);
    const grading = {}; LAP_GRADING.forEach(g => grading[g] = 0);
    rows.filter(r => r.jenis_insiden !== 'KPC').forEach(r => { if (grading[r.grading_risiko] !== undefined) grading[r.grading_risiko]++; });
    const status = lapHitung(rows, r => r.status_investigasi || 'Baru');
    const aktif = r => ['Baru', 'Investigasi'].includes(r.status_investigasi || 'Baru');
    const batas = r => {
        if (r.batas_investigasi) return r.batas_investigasi;
        const hari = (r.jenis_investigasi === 'rca' || ['Merah', 'Kuning'].includes(r.grading_risiko) || r.jenis_insiden === 'Sentinel') ? 45 : r.grading_risiko === 'Hijau' ? 14 : 7;
        const d = new Date(String(r.waktu_insiden || r.waktu_lapor).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + hari);
        return d.toISOString().slice(0, 10);
    };
    const lewatBatas = rows.filter(r => aktif(r) && batas(r) < hariIni);
    const jamLapor = r => r.waktu_insiden && r.waktu_lapor ? (new Date(r.waktu_lapor) - new Date(String(r.waktu_insiden).replace(' ', 'T'))) / 36e5 : null;
    const terlambat = rows.filter(r => { const j = jamLapor(r); return j !== null && j > 48; });
    const perUnit = lapHitung(rows, lapUnitInsiden);
    const perUnitArr = Object.entries(perUnit).map(([unit, n]) => {
        const xs = rows.filter(r => lapUnitInsiden(r) === unit);
        return { unit, total: n, ktd: xs.filter(r => r.jenis_insiden === 'KTD' || r.jenis_insiden === 'Sentinel').length,
                 merahKuning: xs.filter(r => r.jenis_insiden !== 'KPC' && ['Merah', 'Kuning'].includes(r.grading_risiko)).length, kpc: xs.filter(r => r.jenis_insiden === 'KPC').length };
    }).sort((a, b) => b.total - a.total);
    const pelapor = lapHitung(rows, r => r.unit_pelapor || 'Tidak diketahui');
    const tipe = Object.entries(lapHitung(rows.filter(r => lapTipeInsiden(r)), lapTipeInsiden)).map(([tipe, n]) => ({ tipe, n })).sort((a, b) => b.n - a.n);
    const bulanan = p.bulan.map(b => {
        const xs = rows.filter(r => Number(String(r.waktu_insiden).slice(5, 7)) === b);
        const o = { bulan: LAP_BULAN[b - 1], total: xs.length }; LAP_JENIS_INSIDEN.forEach(j => o[j] = xs.filter(r => r.jenis_insiden === j).length); return o;
    });
    const tl = S.tindakLanjutInsiden.filter(t => t.status !== 'batal');
    const tindakLanjut = { total: tl.length, selesai: tl.filter(t => t.status === 'selesai').length,
                           terbuka: tl.filter(t => ['rencana', 'berjalan'].includes(t.status)).length,
                           terlambat: tl.filter(t => ['rencana', 'berjalan'].includes(t.status) && t.tenggat && t.tenggat < hariIni).length };
    const sentinel = rows.filter(r => r.jenis_insiden === 'Sentinel').map(r => ({
        tanggal: String(r.waktu_insiden).slice(0, 10), unit: lapUnitInsiden(r), status: r.status_investigasi || 'Baru',
        knkp: r.lapor_eksternal_pada || null, knkpTepat: r.lapor_eksternal_pada ? (new Date(r.lapor_eksternal_pada) - new Date(String(r.waktu_insiden).slice(0, 10))) / 864e5 <= 2 : false }));
    const nyaris = (dasar.jenis.KNC || 0) + (dasar.jenis.KTC || 0) + (dasar.jenis.KPC || 0);
    const cedera = (dasar.jenis.KTD || 0) + (dasar.jenis.Sentinel || 0);
    return {
        ...dasar, grading, status, perUnit: perUnitArr, perUnitPelapor: pelapor, tipe, bulanan, tindakLanjut, sentinel,
        rasioNyarisCedera: cedera ? lapBulat(nyaris / cedera, 1) : null, nyaris, cedera,
        belumVerifikasi: status['Baru'] || 0, lewatBatas: lewatBatas.length, terlambatLapor: terlambat.length,
        persenTepatLapor: lapPersen(rows.length - terlambat.length, rows.filter(r => jamLapor(r) !== null).length),
        investigasi: { rca: rows.filter(r => r.jenis_investigasi === 'rca').length, sederhana: rows.filter(r => r.jenis_investigasi === 'sederhana').length,
                       selesaiInvestigasi: rows.filter(r => ['Tindak Lanjut', 'Selesai'].includes(r.status_investigasi)).length },
        sebelumnya: lapRingkasInsiden(S.insidenSebelum || []),
        tahunLalu: S.insidenTahunLalu ? lapRingkasInsiden(S.insidenTahunLalu) : lapRingkasInsiden(S.insidenSebelum || [])
    };
}

// ---------------------------------------------------------------------
// BUDAYA KESELAMATAN (skor sama dengan dasbor_budaya.html)
// ---------------------------------------------------------------------
const LAP_BUDAYA_POSITIF = ["A1", "A2", "A3", "A4", "A6", "A9", "A11", "A13", "A15", "A18", "B1", "B2", "C1", "C2", "C3", "C4", "C5", "D1", "D2", "D3", "F1", "F4", "F8", "F10"];
const LAP_BUDAYA_NEGATIF = ["A5", "A7", "A8", "A10", "A12", "A14", "A16", "A17", "B3", "B4", "C6", "F2", "F3", "F5", "F6", "F7", "F9", "F11"];
const LAP_DIMENSI = {
    "Kerjasama dalam Unit": ["A1", "A3", "A4", "A11"], "Harapan Manajer": ["B1", "B2", "B3", "B4"], "Organisasi Pembelajar": ["A6", "A9", "A13"],
    "Dukungan Manajemen": ["F1", "F8", "F9"], "Persepsi Keselamatan": ["A15", "A18", "A10", "A17"], "Umpan Balik Komunikasi": ["C1", "C3", "C5"],
    "Keterbukaan Komunikasi": ["C2", "C4", "C6"], "Pelaporan Insiden": ["D1", "D2", "D3"], "Kerjasama Antar Unit": ["F4", "F10", "F2", "F6"],
    "Aspek Ketenagaan": ["A2", "A5", "A7", "A14"], "Serah Terima Jaga": ["F3", "F5", "F7", "F11"], "Respon Tdk Menghakimi": ["A8", "A12", "A16"]
};
function lapSkorBudaya(rows) {
    const item = {};
    Object.values(LAP_DIMENSI).flat().forEach(s => {
        let pos = 0, n = 0;
        rows.forEach(r => { const v = parseInt((r.jawaban_survey || {})[s]); if (v >= 1 && v <= 5) { n++; if ((LAP_BUDAYA_POSITIF.includes(s) && v >= 4) || (LAP_BUDAYA_NEGATIF.includes(s) && v <= 2)) pos++; } });
        item[s] = n ? pos / n * 100 : 0;
    });
    const dimensi = {};
    Object.entries(LAP_DIMENSI).forEach(([d, xs]) => dimensi[d] = lapBulat(xs.reduce((a, s) => a + item[s], 0) / xs.length, 1));
    const g = n => dimensi[n] || 0;
    const budaya = {
        'Budaya Lapor': g('Pelaporan Insiden'), 'Budaya Adil': g('Respon Tdk Menghakimi'),
        'Budaya Fleksibel': lapBulat((g('Kerjasama Antar Unit') + g('Kerjasama dalam Unit') + g('Aspek Ketenagaan') + g('Serah Terima Jaga') + g('Keterbukaan Komunikasi')) / 5, 1),
        'Budaya Belajar': lapBulat((g('Organisasi Pembelajar') + g('Umpan Balik Komunikasi') + g('Dukungan Manajemen') + g('Harapan Manajer')) / 4, 1)
    };
    return { dimensi, budaya };
}
function lapSusunBudaya(S) {
    const pilih = S.surveiDipakai || {};
    if (!pilih.utama) return { ada: false };
    const ringkas = sv => {
        if (!sv) return null;
        const rows = S.jawabanSurvei.filter(j => j.id_periode === sv.id);
        const staf = S.stafSurvei.filter(s => s.id_periode === sv.id);
        const respUnit = lapHitung(rows, r => r.unit_kerja || '-');
        const totStaf = staf.reduce((a, s) => a + s.jumlah_staf, 0);
        const totResp = staf.reduce((a, s) => a + Math.min(respUnit[s.unit_kerja] || 0, s.jumlah_staf), 0);
        const skor = rows.length ? lapSkorBudaya(rows) : null;
        const urut = skor ? Object.entries(skor.dimensi).sort((a, b) => b[1] - a[1]) : [];
        return { nama: sv.nama, mulai: sv.tanggal_mulai, selesai: sv.tanggal_selesai, status: sv.status, responden: rows.length,
                 tingkatRespons: totStaf ? lapPersen(totResp, totStaf) : null, target: lapAngka(sv.target_respons), stafDiisi: staf.length > 0,
                 ...(skor || {}), terkuat: urut.slice(0, 3).map(([d, v]) => ({ dimensi: d, skor: v })), terlemah: urut.slice(-3).reverse().map(([d, v]) => ({ dimensi: d, skor: v })),
                 profesi: lapHitung(rows, r => r.profesi || '-'),
                 perUnit: Object.entries(respUnit).map(([unit, n]) => { const st = staf.find(s => s.unit_kerja === unit); return { unit, responden: n, staf: st ? st.jumlah_staf : null, persen: st ? lapPersen(Math.min(n, st.jumlah_staf), st.jumlah_staf) : null }; })
                     .sort((a, b) => b.responden - a.responden) };
    };
    return { ada: true, jenis: pilih.jenis, utama: ringkas(pilih.utama), sebelumnya: ringkas(pilih.sebelumnya) };
}

// ---------------------------------------------------------------------
// RISIKO & FMEA
// ---------------------------------------------------------------------
function lapSusunRisiko(S) {
    const p = S.p, hariIni = S.hariIni;
    const tglId = r => String(r.tanggal_identifikasi || r.created_at || '').slice(0, 10) || p.awal;
    const berlaku = S.risiko.filter(r => r.status !== 'draft' && tglId(r) <= p.akhir
        && (r.status !== 'ditutup' || String(r.ditutup_pada || '').slice(0, 10) >= p.awal));
    const terbuka = berlaku.filter(r => r.status !== 'ditutup');
    const tindakan = S.tindakanRisiko.filter(t => terbuka.some(r => r.id_risiko === t.id_risiko) && t.status !== 'batal');
    const telat = t => ['rencana', 'berjalan'].includes(t.status) && t.tenggat && t.tenggat < hariIni;
    const perTingkat = {}; LAP_TINGKAT.forEach(t => perTingkat[t] = terbuka.filter(r => r.tingkat_risiko === t).length);
    const perKategori = Object.entries(lapHitung(terbuka, r => r.kategori_risiko || 'Belum dikategorikan')).map(([kategori, n]) => ({ kategori, n,
        tinggiEkstrem: terbuka.filter(r => (r.kategori_risiko || 'Belum dikategorikan') === kategori && ['Tinggi', 'Ekstrem'].includes(r.tingkat_risiko)).length }))
        .sort((a, b) => a.kategori.localeCompare(b.kategori, 'id'));
    const perUnit = Object.entries(lapHitung(terbuka, r => r.unit_kerja || '-')).map(([unit, n]) => {
        const xs = terbuka.filter(r => (r.unit_kerja || '-') === unit);
        const tx = tindakan.filter(t => xs.some(r => r.id_risiko === t.id_risiko));
        return { unit, n, tinggiEkstrem: xs.filter(r => ['Tinggi', 'Ekstrem'].includes(r.tingkat_risiko)).length, tindakanTerlambat: tx.filter(telat).length,
                 reviewJatuhTempo: xs.filter(r => r.status === 'aktif' && r.review_berikutnya && r.review_berikutnya <= hariIni).length };
    }).sort((a, b) => b.tinggiEkstrem - a.tinggiEkstrem || b.n - a.n);
    const profilRows = S.profil.map(pi => {
        const r = S.risiko.find(x => x.id_risiko === pi.id_risiko) || {};
        const tx = S.tindakanRisiko.filter(t => t.id_risiko === pi.id_risiko && t.status !== 'batal');
        return { id: pi.id_risiko, kategori: pi.kategori || r.kategori_risiko || '-', risiko: r.risiko_teridentifikasi || '-', unit: r.unit_kerja || '-',
                 tingkat: r.tingkat_risiko || '-', skor: lapAngka(r.skor_risiko), status: r.status || '-', statusProfil: pi.status,
                 tindakan: tx.length, tindakanSelesai: tx.filter(t => t.status === 'selesai').length, tindakanTerlambat: tx.filter(telat).length,
                 reviewBerikutnya: r.review_berikutnya || null };
    }).sort((a, b) => String(a.kategori).localeCompare(String(b.kategori), 'id'));
    const sk = S.sk[0] || null;
    return {
        jumlah: terbuka.length, baru: berlaku.filter(r => tglId(r) >= p.awal).length, ditutup: berlaku.filter(r => r.status === 'ditutup').length,
        perTingkat, perKategori, perUnit, status: lapHitung(berlaku, r => r.status),
        menungguVerifikasi: terbuka.filter(r => r.status === 'diajukan').length, perluRevisi: terbuka.filter(r => r.status === 'revisi').length,
        tindakan: { total: tindakan.length, selesai: tindakan.filter(t => t.status === 'selesai').length, terlambat: tindakan.filter(telat).length,
                    persenSelesai: lapPersen(tindakan.filter(t => t.status === 'selesai').length, tindakan.length) },
        review: { dilakukan: S.reviewRisiko.length, jatuhTempo: terbuka.filter(r => r.status === 'aktif' && r.review_berikutnya && r.review_berikutnya <= hariIni).length },
        profil: { jumlah: profilRows.length, daftar: profilRows, sk: sk ? { nomor: sk.nomor_sk || sk.nomor || '', tanggal: sk.tanggal_sk || sk.tanggal || '' } : null }
    };
}
function lapRpnBaris(row) {
    const n = c => parseInt(row[c]);
    const awal = (n(3) || 0) * (n(5) || 0) * (n(7) || 0);
    const akhir = [14, 15, 16].every(c => n(c) >= 1) ? n(14) * n(15) * n(16) : null;
    return { awal, akhir };
}
function lapSusunFmea(S) {
    const akhir = S.p.akhir;
    const proyek = S.fmea.filter(f => String(f.tanggal_dibuat || '').slice(0, 10) <= akhir && (f.status_proyek || 'Aktif') !== 'Batal').map(f => {
        let mode = 0, kritis = 0, dinilaiUlang = 0, awal = 0, sesudah = 0, kritisSisa = 0, maks = 0;
        (f.tabel_data || []).forEach(row => {
            if (!(row[0] || row[1])) return;
            mode++; const r = lapRpnBaris(row);
            maks = Math.max(maks, r.awal);
            if (r.awal >= 80) kritis++;
            if (r.akhir !== null) { dinilaiUlang++; awal += r.awal; sesudah += r.akhir; }
            if ((r.akhir !== null ? r.akhir : r.awal) >= 80) kritisSisa++;
        });
        return { nama: f.nama_proses, ketua: f.ketua_tim || '-', status: f.status_proyek || 'Aktif', sumber: f.sumber_risiko || '', idRisiko: f.id_risiko || null,
                 mulai: String(f.tanggal_dibuat || '').slice(0, 10), mode, kritis, kritisSisa, rpnMaks: maks, dinilaiUlang,
                 rpnAwal: awal, rpnSesudah: sesudah, turun: awal ? lapBulat((awal - sesudah) / awal * 100, 1) : null };
    });
    return { jumlah: proyek.length, aktif: proyek.filter(x => x.status === 'Aktif').length, proyek,
             modeKegagalan: proyek.reduce((a, x) => a + x.mode, 0), kritis: proyek.reduce((a, x) => a + x.kritis, 0), kritisSisa: proyek.reduce((a, x) => a + x.kritisSisa, 0) };
}

// ---------------------------------------------------------------------
// TINDAK LANJUT LAPORAN SEBELUMNYA
// ---------------------------------------------------------------------
function lapSusunTindakLanjut(S) {
    const p = S.p;
    const kunciIni = `${p.jenis}|${p.tahun}|${p.nomor}`;
    const lain = new Map(S.laporanLain.filter(l => `${l.jenis}|${l.tahun}|${l.nomor}` !== kunciIni).map(l => [l.id, l]));
    const daftar = S.tindakLanjutLaporan.filter(t => lain.has(t.id_laporan) && t.status !== 'batal'
        && (t.status !== 'selesai' || String(t.selesai_pada || '').slice(0, 10) >= p.awal)).map(t => {
        const l = lain.get(t.id_laporan);
        return { dari: l.judul || `${l.jenis} ${l.nomor} ${l.tahun}`, sumber: t.sumber, uraian: t.uraian, unit: t.unit_kerja || '', pic: t.pic || '',
                 tenggat: t.tenggat || null, status: t.status, progres: t.progres || '', terlambat: t.status !== 'selesai' && t.tenggat && t.tenggat < S.hariIni };
    });
    const disposisiTerakhir = [...lain.values()].filter(l => l.status === 'disetujui' && l.disposisi_direktur).sort((a, b) => String(a.tanggal_disposisi).localeCompare(String(b.tanggal_disposisi))).pop();
    return { daftar, selesai: daftar.filter(d => d.status === 'selesai').length, terbuka: daftar.filter(d => d.status !== 'selesai').length,
             terlambat: daftar.filter(d => d.terlambat).length,
             disposisiTerakhir: disposisiTerakhir ? { dari: disposisiTerakhir.judul, tanggal: disposisiTerakhir.tanggal_disposisi, isi: disposisiTerakhir.disposisi_direktur } : null };
}

// ---------------------------------------------------------------------
// TEMA LINTAS KOMPONEN (kata kunci)
// ---------------------------------------------------------------------
const LAP_TEMA = [
    { tema: 'Pasien jatuh', kata: ['jatuh'] },
    { tema: 'Obat & medikasi', kata: ['obat', 'medikasi', 'medication', 'resep', 'farmasi', 'high alert', 'lasa'] },
    { tema: 'Identifikasi pasien', kata: ['identifikasi', 'gelang', 'salah pasien', 'rm ganda', 'rekam medis ganda'] },
    { tema: 'Infeksi (PPI)', kata: ['infeksi', 'ido', 'ilo', 'phlebitis', 'plebitis', 'hais', 'ppi', 'kebersihan tangan', 'cuci tangan', 'hand hygiene', 'cauti', 'vap', 'clabsi', 'isk', 'apd'] },
    { tema: 'Operasi & anestesi', kata: ['operasi', 'bedah', 'sectio', 'caesar', 'anestesi', 'surgical', 'kamar operasi', 'sign in', 'time out'] },
    { tema: 'Komunikasi & serah terima', kata: ['komunikasi', 'serah terima', 'sbar', 'handover', 'tbak', 'instruksi'] },
    { tema: 'Transfusi darah', kata: ['transfusi', 'darah'] },
    { tema: 'Waktu tunggu & tanggap', kata: ['waktu tunggu', 'waktu tanggap', 'response time', 'respon time', 'emergensi', 'tunggu'] },
    { tema: 'Diagnostik (lab & radiologi)', kata: ['laborat', 'radiolog', 'nilai kritis', 'hasil kritis', 'sampel'] },
    { tema: 'Alat, sarana & keamanan', kata: ['alat', 'fasilitas', 'listrik', 'lantai', 'gedung', 'kebakaran', 'apar', 'lift', 'keamanan', 'bencana'] },
    { tema: 'Dokumentasi & kelengkapan', kata: ['dokumen', 'kelengkapan', 'asesmen', 'formulir', 'resume', 'informed consent', 'persetujuan'] },
    { tema: 'Kepuasan & komplain', kata: ['kepuasan', 'komplain', 'keluhan'] }
];
function lapTemaTeks(teks) {
    const t = ' ' + String(teks || '').toLowerCase() + ' ';
    return LAP_TEMA.filter(x => x.kata.some(k => t.includes(k))).map(x => x.tema);
}
function lapSusunTema(snap, S) {
    const hasil = LAP_TEMA.map(x => ({ tema: x.tema, indikatorTidakTercapai: [], indikatorDipantau: 0, insiden: 0, insidenBerat: 0, risiko: 0, risikoTinggi: 0, fmea: [] }));
    const cari = t => hasil.find(h => h.tema === t);
    snap.mutu.indikator.forEach(i => lapTemaTeks(i.judul).forEach(t => { const h = cari(t); h.indikatorDipantau++; if (i.tercapai === false) h.indikatorTidakTercapai.push(i.jenis === 'IMP-Unit' ? `${i.judul} (${i.unit})` : i.judul); }));
    S.insiden.forEach(r => {
        const inv = r.investigasi_komite || {};
        lapTemaTeks([inv.tipe_insiden, inv.akar_masalah].filter(Boolean).join(' ')).forEach(t => { const h = cari(t); h.insiden++; if (['Merah', 'Kuning'].includes(r.grading_risiko) || r.jenis_insiden === 'Sentinel') h.insidenBerat++; });
    });
    S.risiko.filter(r => !['draft', 'ditutup'].includes(r.status)).forEach(r => lapTemaTeks(`${r.risiko_teridentifikasi || ''} ${r.penyebab || ''} ${r.kategori_risiko || ''}`).forEach(t => {
        const h = cari(t); h.risiko++; if (['Tinggi', 'Ekstrem'].includes(r.tingkat_risiko)) h.risikoTinggi++; }));
    snap.fmea.proyek.forEach(f => lapTemaTeks(f.nama).forEach(t => cari(t).fmea.push(f.nama)));
    return hasil.map(h => ({ ...h, komponen: [h.indikatorDipantau > 0, h.insiden > 0, h.risiko > 0, h.fmea.length > 0].filter(Boolean).length,
                             sinyal: h.indikatorTidakTercapai.length + h.insidenBerat * 2 + h.insiden + h.risikoTinggi * 2 }))
        .filter(h => h.komponen > 0).sort((a, b) => b.sinyal - a.sinyal || b.komponen - a.komponen);
}

// ---------------------------------------------------------------------
// MATRIKS PER UNIT (dasar umpan balik unit & unit prioritas)
// ---------------------------------------------------------------------
function lapSusunUnit(snap, S) {
    const nama = new Set(S.unit.map(u => u.nama_unit));
    snap.mutu.perUnit.forEach(x => nama.add(x.unit));
    S.insiden.forEach(r => { nama.add(lapUnitInsiden(r)); if (r.unit_pelapor) nama.add(r.unit_pelapor); });
    S.risiko.forEach(r => r.unit_kerja && nama.add(r.unit_kerja));
    nama.delete('Tidak diketahui'); nama.delete('-'); nama.delete('');
    const hariIni = S.hariIni;
    const out = {};
    [...nama].sort((a, b) => a.localeCompare(b, 'id')).forEach(u => {
        const ind = snap.mutu.perUnit.filter(x => x.unit === u && x.nilai !== null);
        const kep = snap.mutu.kepatuhan.perUnit.find(k => k.unit === u) || null;
        const ins = S.insiden.filter(r => lapUnitInsiden(r) === u);
        const lapor = S.insiden.filter(r => r.unit_pelapor === u);
        const rsk = S.risiko.filter(r => r.unit_kerja === u && r.status !== 'ditutup');
        const tx = S.tindakanRisiko.filter(t => rsk.some(r => r.id_risiko === t.id_risiko) && t.status !== 'batal');
        const val = snap.mutu.validasi.daftar.filter(v => v.unit === u);
        const tidak = ind.filter(x => x.tercapai === false);
        const data = {
            unit: u,
            kepatuhan: kep ? { persen: kep.persen, terisi: kep.terisi, wajib: kep.wajib } : null,
            indikator: { total: ind.length, tercapai: ind.filter(x => x.tercapai === true).length, tidak: tidak.length,
                         daftar: ind.map(x => ({ judul: x.judul, jenis: x.jenis, satuan: x.satuan, target: x.target, arah: x.arah, nilai: x.nilai, sebelumnya: x.sebelumnya,
                                                  tren: x.tren, tercapai: x.tercapai, beruntun: x.beruntun, pdsa: x.pdsa ? x.pdsa.status : null,
                                                  bulan: snap.periode.bulan.map(b => x.bulan[b] ? x.bulan[b].c : null) })) },
            insiden: { terkait: ins.length, dilaporkan: lapor.length, jenis: lapHitung(ins, 'jenis_insiden'),
                       merahKuning: ins.filter(r => r.jenis_insiden !== 'KPC' && ['Merah', 'Kuning'].includes(r.grading_risiko)).length,
                       terlambatLapor: lapor.filter(r => r.waktu_insiden && r.waktu_lapor && (new Date(r.waktu_lapor) - new Date(String(r.waktu_insiden).replace(' ', 'T'))) / 36e5 > 48).length,
                       tipe: Object.entries(lapHitung(ins.filter(lapTipeInsiden), lapTipeInsiden)).map(([t, n]) => `${t} (${n})`) },
            risiko: { aktif: rsk.filter(r => r.status === 'aktif').length, draf: S.risiko.filter(r => r.unit_kerja === u && ['draft', 'revisi'].includes(r.status)).length,
                      diajukan: rsk.filter(r => r.status === 'diajukan').length,
                      tinggiEkstrem: rsk.filter(r => ['Tinggi', 'Ekstrem'].includes(r.tingkat_risiko) && r.status !== 'draft').length,
                      tindakan: tx.length, tindakanSelesai: tx.filter(t => t.status === 'selesai').length,
                      tindakanTerlambat: tx.filter(t => ['rencana', 'berjalan'].includes(t.status) && t.tenggat && t.tenggat < hariIni).length,
                      reviewJatuhTempo: rsk.filter(r => r.status === 'aktif' && r.review_berikutnya && r.review_berikutnya <= hariIni).length,
                      daftarTinggi: rsk.filter(r => ['Tinggi', 'Ekstrem'].includes(r.tingkat_risiko) && r.status !== 'draft').map(r => `${r.risiko_teridentifikasi || r.id_risiko} (${r.tingkat_risiko})`).slice(0, 6) },
            validasi: { sesi: val.length, tidakValid: val.filter(v => v.status === 'TIDAK VALID').length },
            pdsa: { perlu: tidak.length, berjalan: tidak.filter(x => x.pdsa && x.pdsa.status === 'berjalan').length, belum: tidak.filter(x => !x.pdsa || x.pdsa.status === 'belum').length }
        };
        // Sinyal lintas komponen (unit prioritas)
        const sinyal = [];
        if (tidak.length) sinyal.push(`${tidak.length} indikator tidak tercapai`);
        if (data.insiden.merahKuning) sinyal.push(`${data.insiden.merahKuning} insiden grading merah/kuning`);
        if (data.risiko.tinggiEkstrem) sinyal.push(`${data.risiko.tinggiEkstrem} risiko tinggi/ekstrem`);
        if (data.risiko.tindakanTerlambat) sinyal.push(`${data.risiko.tindakanTerlambat} tindakan risiko terlambat`);
        if (kep && kep.persen !== null && kep.persen < 80) sinyal.push(`kepatuhan lapor ${kep.persen}%`);
        if (data.validasi.tidakValid) sinyal.push(`${data.validasi.tidakValid} validasi tidak valid`);
        data.sinyal = sinyal;
        data.skorPrioritas = tidak.length + data.insiden.merahKuning * 2 + data.risiko.tinggiEkstrem + data.risiko.tindakanTerlambat
            + (kep && kep.persen !== null && kep.persen < 80 ? 2 : 0) + data.validasi.tidakValid * 2;
        data.aktif = ind.length > 0 || ins.length > 0 || lapor.length > 0 || rsk.length > 0 || !!kep;
        out[u] = data;
    });
    return out;
}
function lapUnitPrioritas(snap, n = 10) {
    return Object.values(snap.unit).filter(u => u.skorPrioritas > 0 && u.sinyal.length >= 2)
        .sort((a, b) => b.skorPrioritas - a.skorPrioritas).slice(0, n).map(u => ({ unit: u.unit, sinyal: u.sinyal }));
}

// ---------------------------------------------------------------------
// CEK KESIAPAN
// ---------------------------------------------------------------------
function lapCekKesiapan(snap, S) {
    const p = S.p, cek = [];
    const tambah = (judul, ok, detail) => cek.push({ judul, status: ok ? 'ok' : 'peringatan', detail });
    tambah('Periode sudah berakhir', p.akhir < S.hariIni, p.akhir < S.hariIni ? `Periode berakhir ${p.akhir}.` : `Periode baru berakhir ${p.akhir}; angka masih bisa bertambah.`);
    const unitWajib = S.unit.filter(u => String(u.daftar_form || '').trim());
    const bulanBelumKunci = p.bulan.filter(b => {
        const k = S.kunci.filter(x => Number(x.bulan) === b);
        if (k.some(x => !x.unit_kerja)) return false;
        return !unitWajib.every(u => k.some(x => x.unit_kerja === u.nama_unit));
    });
    tambah('Periode data mutu dikunci', !bulanBelumKunci.length, bulanBelumKunci.length ? `Belum dikunci: ${bulanBelumKunci.map(b => LAP_BULAN[b - 1]).join(', ')}. Data masih bisa diubah unit setelah laporan disusun.` : 'Semua bulan sudah dikunci.');
    const kp = snap.mutu.kepatuhan;
    tambah('Kepatuhan pelaporan unit', kp.persen === null || kp.persen >= 90, kp.persen === null ? 'Belum ada kewajiban formulir yang dinilai.' : `${lapFmt(kp.persen, "%")} formulir wajib terisi; ${kp.unitLengkap} dari ${kp.jumlahUnit} unit lengkap.`);
    const v = snap.mutu.validasi.cakupanRs;
    tambah('Validasi data INM & IMP-RS', v.total === 0 || v.tervalidasi >= v.total, `${v.tervalidasi} dari ${v.total} indikator INM/IMP-RS sudah divalidasi pada periode ini.`);
    tambah('Insiden sudah diverifikasi', !snap.insiden.belumVerifikasi, snap.insiden.belumVerifikasi ? `${snap.insiden.belumVerifikasi} laporan insiden masih berstatus Baru.` : 'Semua laporan insiden sudah diverifikasi.');
    tambah('Investigasi tepat waktu', !snap.insiden.lewatBatas, snap.insiden.lewatBatas ? `${snap.insiden.lewatBatas} investigasi melewati batas waktu.` : 'Tidak ada investigasi yang melewati batas.');
    tambah('Risiko sudah diverifikasi', !snap.risiko.menungguVerifikasi, snap.risiko.menungguVerifikasi ? `${snap.risiko.menungguVerifikasi} risiko menunggu verifikasi Komite.` : 'Tidak ada antrean verifikasi risiko.');
    tambah('Data survei budaya', snap.budaya.ada && snap.budaya.jenis === 'periode', !snap.budaya.ada ? 'Belum ada periode survei.' : snap.budaya.jenis === 'periode' ? `${snap.budaya.utama.nama}: ${snap.budaya.utama.responden} responden.` : `Tidak ada survei pada periode ini; dipakai hasil terakhir (${snap.budaya.utama.nama}).`);
    (S.catatan || []).forEach(c => tambah('Sumber data', false, c));
    return cek;
}

// =====================================================================
// SARAN BERBASIS ATURAN (tanpa AI) — dasar umpan balik unit
// =====================================================================
function lapSaranAturan(u) {
    const apresiasi = [], perhatian = [], saran = [];
    const ind = u.indikator;
    if (u.kepatuhan && u.kepatuhan.persen === 100) apresiasi.push(`Seluruh formulir wajib dilaporkan lengkap (${u.kepatuhan.terisi} dari ${u.kepatuhan.wajib}).`);
    if (ind.total && ind.tercapai === ind.total) apresiasi.push(`Semua ${ind.total} indikator yang dilaporkan unit mencapai target.`);
    ind.daftar.filter(x => x.tren === 'membaik' && x.tercapai).slice(0, 3).forEach(x => apresiasi.push(`${x.judul} membaik dari ${lapFmt(x.sebelumnya, x.satuan)} menjadi ${lapFmt(x.nilai, x.satuan)}.`));
    if (u.insiden.dilaporkan && !u.insiden.terlambatLapor) apresiasi.push(`Unit aktif melaporkan ${u.insiden.dilaporkan} insiden/KPC tepat waktu.`);
    if (u.risiko.tindakan && u.risiko.tindakanSelesai === u.risiko.tindakan) apresiasi.push(`Semua ${u.risiko.tindakan} rencana tindakan risiko sudah selesai.`);

    if (u.kepatuhan && u.kepatuhan.persen !== null && u.kepatuhan.persen < 100) {
        perhatian.push(`Kepatuhan pelaporan ${lapFmt(u.kepatuhan.persen, '%')} (${u.kepatuhan.terisi} dari ${u.kepatuhan.wajib} formulir-bulan).`);
        saran.push('Tetapkan PIC dan jadwal pengisian data harian; periksa kelengkapan di menu Kepatuhan Pelaporan sebelum tanggal 5 bulan berikutnya.');
    }
    ind.daftar.filter(x => x.tercapai === false).forEach(x => {
        perhatian.push(`${x.judul}: ${lapFmt(x.nilai, x.satuan)} (target ${lapArahKecil(x.arah) ? '≤' : '≥'} ${lapFmt(x.target, x.satuan)})${x.beruntun > 1 ? `, tidak tercapai ${x.beruntun} bulan berturut-turut` : ''}.`);
        if (x.pdsa === 'belum' || !x.pdsa) saran.push(`Susun PDSA untuk "${x.judul}": identifikasi akar masalah bersama tim unit dan uji satu perubahan kecil dalam satu bulan.`);
        else if (x.pdsa === 'selesai') saran.push(`PDSA "${x.judul}" sudah selesai tetapi target belum tercapai; evaluasi hasil Study dan jalankan siklus PDSA berikutnya.`);
    });
    if (u.insiden.merahKuning) {
        perhatian.push(`${u.insiden.merahKuning} insiden dengan grading merah/kuning terkait unit.`);
        saran.push('Pastikan rekomendasi RCA dijalankan sesuai tenggat dan sosialisasikan pembelajaran insiden pada briefing/rapat unit.');
    }
    if (u.insiden.terlambatLapor) {
        perhatian.push(`${u.insiden.terlambatLapor} laporan insiden masuk lebih dari 2x24 jam setelah kejadian.`);
        saran.push('Ingatkan staf bahwa insiden wajib dilaporkan paling lambat 2x24 jam; laporan dapat dikirim tanpa login melalui Formulir IKP/KPC.');
    }
    if (!u.insiden.dilaporkan && u.indikator.total) saran.push('Belum ada laporan insiden/KPC dari unit pada periode ini; dorong pelaporan kejadian nyaris cedera sebagai bagian budaya keselamatan.');
    if (u.risiko.tindakanTerlambat) { perhatian.push(`${u.risiko.tindakanTerlambat} rencana tindakan risiko melewati tenggat.`); saran.push('Perbarui status tindakan risiko yang terlambat atau ajukan tenggat baru beserta alasannya.'); }
    if (u.risiko.reviewJatuhTempo) { perhatian.push(`${u.risiko.reviewJatuhTempo} risiko aktif sudah jatuh tempo review.`); saran.push('Lakukan review berkala risiko yang jatuh tempo di Risk Register Unit.'); }
    if (u.risiko.draf) saran.push(`Selesaikan ${u.risiko.draf} risiko berstatus draf/revisi dan ajukan ke Komite Mutu.`);
    if (!u.risiko.aktif && !u.risiko.draf && !u.risiko.diajukan) saran.push('Unit belum memiliki risiko aktif di register; identifikasi minimal risiko utama unit bersama tim.');
    if (u.validasi.tidakValid) { perhatian.push(`${u.validasi.tidakValid} hasil validasi data TIDAK VALID.`); saran.push('Tinjau cara pengisian data bersama validator dan perbaiki definisi operasional di unit.'); }
    return { ringkasan: '', apresiasi, perhatian, saran: [...new Set(saran)], sumber: 'aturan' };
}

// =====================================================================
// NARASI BERBASIS ATURAN (tanpa AI) — skema sama dengan jawaban AI, dipakai
// bila AI tidak tersedia atau sebagai draf awal yang disunting Komite
// =====================================================================
function lapNarasiAturan(tugas, snap) {
    const P = snap.periode, SB = snap.pembanding.sebelumnya.label;
    const m = snap.mutu, ins = snap.insiden, b = snap.budaya, r = snap.risiko, f = snap.fmea, tl = snap.tindakLanjut;
    const tgt = i => `${lapArahKecil(i.arah) ? '≤' : '≥'} ${lapFmt(i.target, i.satuan)}`;
    const daftarInd = xs => xs.map(i => `${i.judul}${i.jenis === 'IMP-Unit' ? ` (${i.unit})` : ''} ${lapFmt(i.nilai, i.satuan)} (target ${tgt(i)})`);
    switch (tugas) {
        case 'mutu': {
            const t = m.ringkasan.total || {};
            const kat = ['INM', 'IMP-RS', 'IMP-Unit'].filter(k => m.ringkasan[k] && m.ringkasan[k].total)
                .map(k => `${k} ${m.ringkasan[k].tercapai} dari ${m.ringkasan[k].total - m.ringkasan[k].tanpaTarget} tercapai`);
            const tidakRs = m.indikator.filter(i => i.jenis !== 'IMP-Unit' && i.tercapai === false);
            const beruntun = m.indikator.filter(i => i.beruntun >= P.bulan.length && i.tercapai === false);
            const memburuk = m.indikator.filter(i => i.tren === 'memburuk');
            const pemb = [`Pada ${P.label} dipantau ${t.total || 0} indikator bertarget; ${t.tercapai || 0} tercapai (${lapFmt(t.persen, '%')}) dan ${t.tidak || 0} tidak tercapai. Rinciannya: ${kat.join('; ') || 'belum ada data'}.`];
            if (tidakRs.length) pemb.push(`Indikator tingkat rumah sakit yang tidak mencapai target: ${daftarInd(tidakRs).join('; ')}.`);
            if (beruntun.length || memburuk.length) pemb.push(`${beruntun.length} indikator tidak tercapai di seluruh bulan periode ini dan ${memburuk.length} indikator memburuk dibanding ${SB}.`);
            pemb.push(`Dari ${m.pdsa.perlu} indikator yang memerlukan perbaikan, ${m.pdsa.berjalan} memiliki PDSA berjalan, ${m.pdsa.selesai} PDSA selesai, dan ${m.pdsa.belum} belum memiliki PDSA.`);
            pemb.push(`Kepatuhan pelaporan data ${m.kepatuhan.persen === null ? 'belum dapat dinilai' : lapFmt(m.kepatuhan.persen, '%') + ` (${m.kepatuhan.unitLengkap} dari ${m.kepatuhan.jumlahUnit} unit lengkap)`}. Validasi data: ${m.validasi.sesi} sesi, ${m.validasi.valid} valid dan ${m.validasi.tidakValid} tidak valid; ${m.validasi.cakupanRs.tervalidasi} dari ${m.validasi.cakupanRs.total} indikator INM/IMP-RS tervalidasi.`);
            const rek = [];
            if (m.pdsa.belum) rek.push({ uraian: `Menyusun PDSA untuk ${m.pdsa.belum} indikator yang tidak tercapai dan belum memiliki PDSA.`, penanggung_jawab: 'Kepala unit & PIC mutu', prioritas: 'tinggi' });
            if (m.kepatuhan.persen !== null && m.kepatuhan.persen < 100) rek.push({ uraian: 'Meningkatkan kelengkapan pelaporan data indikator oleh unit sebelum periode dikunci.', penanggung_jawab: 'Komite Mutu & kepala unit', prioritas: 'sedang' });
            if (m.validasi.cakupanRs.tervalidasi < m.validasi.cakupanRs.total) rek.push({ uraian: 'Menuntaskan validasi data seluruh indikator INM dan IMP-RS.', penanggung_jawab: 'Komite Mutu', prioritas: 'sedang' });
            return { ringkasan: `${t.tercapai || 0} dari ${t.total || 0} indikator bertarget tercapai pada ${P.label}.`, pembahasan: pemb,
                     temuan_kunci: [...daftarInd(tidakRs).slice(0, 5)], rekomendasi: rek, sumber: 'aturan' };
        }
        case 'keselamatan': {
            const g = ins.grading, j = ins.jenis;
            const pemb = [`Selama ${P.label} tercatat ${ins.total} laporan: KTD ${j.KTD || 0}, Sentinel ${j.Sentinel || 0}, KNC ${j.KNC || 0}, KTC ${j.KTC || 0}, dan KPC ${j.KPC || 0} (periode sebelumnya ${ins.sebelumnya.total}). Grading IKP: merah ${g.Merah}, kuning ${g.Kuning}, hijau ${g.Hijau}, biru ${g.Biru}.`];
            if (ins.rasioNyarisCedera !== null) pemb.push(`Rasio laporan nyaris cedera (KNC, KTC, KPC) terhadap cedera (KTD dan Sentinel) adalah ${lapFmt(ins.rasioNyarisCedera)} banding 1.`);
            if (ins.tipe.length) pemb.push(`Tipe insiden terbanyak: ${ins.tipe.slice(0, 4).map(x => `${x.tipe} (${x.n})`).join(', ')}. Unit dengan insiden terbanyak: ${ins.perUnit.slice(0, 4).map(x => `${x.unit} (${x.total})`).join(', ')}.`);
            pemb.push(`${ins.terlambatLapor} laporan masuk lebih dari 2x24 jam; ${ins.belumVerifikasi} laporan belum diverifikasi; ${ins.lewatBatas} investigasi melewati batas waktu. Tindak lanjut rekomendasi: ${ins.tindakLanjut.selesai} selesai dari ${ins.tindakLanjut.total}, ${ins.tindakLanjut.terlambat} terlambat.`);
            if (ins.sentinel.length) pemb.push(`Terdapat ${ins.sentinel.length} kejadian sentinel; ${ins.sentinel.filter(x => x.knkp).length} sudah dilaporkan ke KNKP.`);
            const rek = [];
            if (ins.lewatBatas || ins.belumVerifikasi) rek.push({ uraian: 'Menuntaskan verifikasi dan investigasi insiden yang melewati batas waktu.', penanggung_jawab: 'Komite Mutu (Subkomite Keselamatan Pasien)', prioritas: 'tinggi' });
            if (ins.tindakLanjut.terlambat) rek.push({ uraian: 'Memantau penyelesaian rekomendasi investigasi yang terlambat.', penanggung_jawab: 'Kepala unit terkait', prioritas: 'tinggi' });
            if (ins.sentinel.some(x => !x.knkp)) rek.push({ uraian: 'Melaporkan kejadian sentinel ke KNKP.', penanggung_jawab: 'Komite Mutu', prioritas: 'tinggi' });
            return { ringkasan: `${ins.total} laporan insiden pada ${P.label}, ${g.Merah + g.Kuning} di antaranya grading merah/kuning.`, pembahasan: pemb, temuan_kunci: [], rekomendasi: rek, sumber: 'aturan' };
        }
        case 'budaya': {
            if (!b.ada || !b.utama) return { ringkasan: 'Belum ada data survei budaya keselamatan.', pembahasan: ['Belum ada periode survei budaya keselamatan yang dapat dilaporkan.'], temuan_kunci: [], rekomendasi: [], sumber: 'aturan' };
            const u = b.utama, s = b.sebelumnya;
            const pemb = [`${b.jenis === 'periode' ? '' : 'Tidak ada survei pada periode ini; hasil terakhir adalah '}${u.nama}${b.jenis === 'periode' ? '' : ','} diikuti ${u.responden} responden${u.tingkatRespons !== null ? ` dengan tingkat respons ${lapFmt(u.tingkatRespons, '%')}` : ''}${u.target !== null && u.target !== undefined ? ` (target ${lapFmt(u.target, '%')})` : ''}.`];
            if (u.budaya) pemb.push(`Skor budaya: ${Object.entries(u.budaya).map(([k, v]) => `${k} ${lapFmt(v, '%')}`).join(', ')}.`);
            if (u.terkuat) pemb.push(`Dimensi terkuat: ${u.terkuat.map(x => `${x.dimensi} (${lapFmt(x.skor, '%')})`).join(', ')}. Dimensi terlemah: ${u.terlemah.map(x => `${x.dimensi} (${lapFmt(x.skor, '%')})`).join(', ')}.`);
            if (s && s.budaya) pemb.push(`Dibanding ${s.nama}: ${Object.keys(u.budaya).map(k => `${k} ${lapFmt(s.budaya[k], '%')} menjadi ${lapFmt(u.budaya[k], '%')}`).join('; ')}.`);
            return { ringkasan: `Hasil ${u.nama}: ${u.responden} responden.`, pembahasan: pemb, temuan_kunci: [],
                     rekomendasi: (u.terlemah || []).filter(x => x.skor < 50).map(x => ({ uraian: `Menyusun program perbaikan dimensi ${x.dimensi}.`, penanggung_jawab: 'Komite Mutu & manajemen', prioritas: 'sedang' })), sumber: 'aturan' };
        }
        case 'risiko': {
            const t = r.perTingkat;
            const pemb = [`Register risiko memuat ${r.jumlah} risiko terbuka (ekstrem ${t.Ekstrem}, tinggi ${t.Tinggi}, moderat ${t.Moderat}, rendah ${t.Rendah}); ${r.baru} risiko baru teridentifikasi dan ${r.ditutup} ditutup pada periode ini. ${r.menungguVerifikasi} risiko menunggu verifikasi dan ${r.perluRevisi} perlu revisi.`,
                          `Rencana tindakan: ${r.tindakan.selesai} dari ${r.tindakan.total} selesai (${lapFmt(r.tindakan.persenSelesai, '%')}), ${r.tindakan.terlambat} melewati tenggat. Review berkala: ${r.review.dilakukan} dilakukan, ${r.review.jatuhTempo} jatuh tempo.`,
                          `Profil risiko rumah sakit berisi ${r.profil.jumlah} risiko${r.profil.sk ? ` dan telah ditetapkan dengan SK ${r.profil.sk.nomor}` : ' dan belum ditetapkan dengan SK Direktur'}.`];
            if (f.jumlah) pemb.push(`Terdapat ${f.jumlah} proyek FMEA dengan ${f.modeKegagalan} mode kegagalan; ${f.kritis} titik kritis (RPN ≥ 80), ${f.kritisSisa} masih ≥ 80 setelah tindakan.` +
                (f.proyek.filter(x => x.dinilaiUlang).length ? ' ' + f.proyek.filter(x => x.dinilaiUlang).map(x => `${x.nama}: RPN ${x.rpnAwal} menjadi ${x.rpnSesudah} (turun ${lapFmt(x.turun, '%')})`).join('; ') + '.' : ''));
            const rek = [];
            if (r.tindakan.terlambat) rek.push({ uraian: 'Menindaklanjuti rencana tindakan risiko yang melewati tenggat.', penanggung_jawab: 'Pemilik risiko', prioritas: 'tinggi' });
            if (r.menungguVerifikasi) rek.push({ uraian: 'Menyelesaikan verifikasi risiko yang diajukan unit.', penanggung_jawab: 'Komite Mutu', prioritas: 'sedang' });
            if (!r.profil.sk && r.profil.jumlah) rek.push({ uraian: 'Menetapkan profil risiko rumah sakit dengan SK Direktur.', penanggung_jawab: 'Direktur', prioritas: 'sedang' });
            return { ringkasan: `${r.jumlah} risiko terbuka, ${t.Ekstrem + t.Tinggi} di antaranya tinggi/ekstrem.`, pembahasan: pemb, temuan_kunci: [], rekomendasi: rek, sumber: 'aturan' };
        }
        case 'integrasi': {
            const tema = snap.tema.filter(x => x.komponen >= 2).slice(0, 5);
            const pemb = tema.length ? tema.map(x => `${x.tema}: ${x.indikatorTidakTercapai.length} indikator tidak tercapai, ${x.insiden} insiden (${x.insidenBerat} berat), ${x.risiko} risiko di register (${x.risikoTinggi} tinggi/ekstrem)${x.fmea.length ? `, FMEA: ${x.fmea.join(', ')}` : ''}.`)
                : ['Belum ditemukan tema yang muncul di lebih dari satu komponen.'];
            const up = lapUnitPrioritas(snap, 6);
            if (up.length) pemb.push(`Unit dengan sinyal dari beberapa komponen: ${up.map(x => `${x.unit} (${x.sinyal.join(', ')})`).join('; ')}.`);
            if (tl.daftar.length) pemb.push(`Tindak lanjut laporan sebelumnya: ${tl.selesai} selesai, ${tl.terbuka} masih berjalan, ${tl.terlambat} terlambat.`);
            return { pembahasan: pemb, keterkaitan: tema.map(x => ({ tema: x.tema, uraian: `muncul di ${x.komponen} komponen` })),
                     rekomendasi_strategis: up.slice(0, 3).map(x => ({ uraian: `Pendampingan terpadu untuk ${x.unit}.`, penanggung_jawab: 'Komite Mutu', tenggat_saran: 'periode berikutnya', prioritas: 'tinggi' })), sumber: 'aturan' };
        }
        case 'eksekutif': {
            const t = m.ringkasan.total || {};
            return { ringkasan_eksekutif: [`Laporan ${P.label} merangkum capaian mutu, keselamatan pasien, budaya keselamatan, dan manajemen risiko rumah sakit.`],
                     sorotan: [`${t.tercapai || 0} dari ${t.total || 0} indikator bertarget tercapai (${lapFmt(t.persen, '%')}).`,
                               `${ins.total} laporan insiden; ${ins.grading.Merah + ins.grading.Kuning} grading merah/kuning; ${ins.jenis.Sentinel || 0} sentinel.`,
                               `${r.jumlah} risiko terbuka; ${r.perTingkat.Ekstrem + r.perTingkat.Tinggi} tinggi/ekstrem; ${r.tindakan.terlambat} tindakan terlambat.`,
                               b.ada && b.utama ? `${b.utama.nama}: ${b.utama.responden} responden.` : 'Belum ada data survei budaya.'], sumber: 'aturan' };
        }
    }
    return {};
}

// =====================================================================
// KONTEKS UNTUK ANALIS AI (ringkas: batas token penyedia gratis)
// =====================================================================
function lapKonteksAI(tugas, snap, hasilAI = {}, unit = null) {
    const m = snap.mutu, ins = snap.insiden, b = snap.budaya, r = snap.risiko, f = snap.fmea;
    const indRingkas = i => ({ indikator: i.judul, unit: i.unit === 'RS' ? undefined : i.unit, target: `${lapArahKecil(i.arah) ? '≤' : '≥'} ${i.target} ${i.satuan || ''}`.trim(),
                               capaian: i.nilai, bulanan: snap.periode.bulan.map(x => i.bulan[x] ? i.bulan[x].c : null), sebelumnya: i.sebelumnya, tahun_lalu: i.tahunLalu,
                               status: i.tercapai === null ? 'tanpa target' : i.tercapai ? 'tercapai' : 'tidak tercapai', beruntun_tidak_tercapai: i.beruntun || undefined,
                               pdsa: i.pdsa ? i.pdsa.status : undefined });
    const ringkasKomponen = k => hasilAI[k] ? { ringkasan: hasilAI[k].ringkasan, temuan_kunci: (hasilAI[k].temuan_kunci || []).slice(0, 5) } : null;
    const angkaKunci = {
        indikator: m.ringkasan.total, per_kategori: Object.fromEntries(Object.entries(m.ringkasan).filter(([k]) => k !== 'total')),
        insiden: { total: ins.total, jenis: ins.jenis, grading_ikp: ins.grading, merah_kuning: ins.grading.Merah + ins.grading.Kuning }, risiko_terbuka: r.jumlah, risiko_per_tingkat: r.perTingkat,
        profil_risiko: r.profil.jumlah, fmea: f.jumlah, survei: b.ada ? { nama: b.utama.nama, responden: b.utama.responden, budaya: b.utama.budaya } : null,
        kepatuhan_pelaporan_persen: m.kepatuhan.persen
    };
    switch (tugas) {
        case 'mutu': {
            const rs = m.indikator.filter(i => i.jenis !== 'IMP-Unit' && !i.tidakLapor);
            const unitTidak = m.indikator.filter(i => i.jenis === 'IMP-Unit' && i.tercapai === false).sort((a, c) => (c.beruntun || 0) - (a.beruntun || 0));
            return { pembanding: snap.pembanding, ringkasan: m.ringkasan, indikator_rs: rs.map(indRingkas).slice(0, 45),
                     imp_unit_tidak_tercapai: unitTidak.slice(0, 35).map(indRingkas), imp_unit_tidak_tercapai_total: unitTidak.length,
                     pdsa: { perlu: m.pdsa.perlu, berjalan: m.pdsa.berjalan, selesai: m.pdsa.selesai, belum: m.pdsa.belum,
                             contoh: m.pdsa.daftar.slice(0, 8).map(d => ({ indikator: d.judul, unit: d.unit, fase: d.fase, masalah: d.masalah, rencana: d.rencana, sebelum: d.sebelum, sesudah: d.sesudah })) },
                     validasi: { sesi: m.validasi.sesi, valid: m.validasi.valid, tidak_valid: m.validasi.tidakValid, rerata_akurasi: m.validasi.rerataAkurasi, cakupan_inm_imprs: m.validasi.cakupanRs },
                     kepatuhan: { persen: m.kepatuhan.persen, unit_lengkap: m.kepatuhan.unitLengkap, jumlah_unit: m.kepatuhan.jumlahUnit,
                                  unit_terendah: m.kepatuhan.perUnit.filter(k => k.persen < 100).slice(0, 10).map(k => ({ unit: k.unit, persen: k.persen })) } };
        }
        case 'keselamatan':
            return { pembanding: snap.pembanding, total: ins.total, ikp: ins.ikp, jenis: ins.jenis, grading_ikp: ins.grading, merah_kuning: ins.grading.Merah + ins.grading.Kuning, bulanan: ins.bulanan,
                     rasio_nyaris_cedera_per_cedera: ins.rasioNyarisCedera, nyaris_cedera: ins.nyaris, cedera: ins.cedera,
                     tipe_teratas: ins.tipe.slice(0, 8), unit_teratas: ins.perUnit.slice(0, 8), status_penanganan: ins.status,
                     belum_diverifikasi: ins.belumVerifikasi, investigasi_lewat_batas: ins.lewatBatas, laporan_terlambat_2x24jam: ins.terlambatLapor,
                     persen_tepat_waktu_lapor: ins.persenTepatLapor, investigasi: ins.investigasi, tindak_lanjut_rekomendasi: ins.tindakLanjut,
                     sentinel: ins.sentinel.map(s => ({ tanggal: s.tanggal, unit: s.unit, status: s.status, dilaporkan_knkp: !!s.knkp, knkp_2x24jam: s.knkpTepat })),
                     periode_sebelumnya: ins.sebelumnya, tahun_lalu: ins.tahunLalu };
        case 'budaya':
            if (!b.ada) return { survei: null, keterangan: 'Belum ada periode survei budaya.' };
            return { keterangan: b.jenis === 'periode' ? 'Survei dilaksanakan dalam periode laporan.' : 'Tidak ada survei dalam periode laporan; ini hasil survei terakhir.',
                     survei: lapRingkasSurvei(b.utama), survei_sebelumnya: b.sebelumnya ? lapRingkasSurvei(b.sebelumnya) : null };
        case 'risiko':
            return { risiko_terbuka: r.jumlah, baru_teridentifikasi: r.baru, ditutup: r.ditutup, per_tingkat: r.perTingkat, per_kategori: r.perKategori,
                     menunggu_verifikasi: r.menungguVerifikasi, perlu_revisi: r.perluRevisi, tindakan: r.tindakan, review: r.review,
                     unit_teratas: r.perUnit.slice(0, 8),
                     profil_risiko_rs: { jumlah: r.profil.jumlah, sk: r.profil.sk, daftar: r.profil.daftar.slice(0, 20).map(x => ({ kategori: x.kategori, risiko: x.risiko, unit: x.unit, tingkat: x.tingkat, tindakan: x.tindakan, selesai: x.tindakanSelesai, terlambat: x.tindakanTerlambat })) },
                     fmea: { jumlah: f.jumlah, mode_kegagalan: f.modeKegagalan, rpn_kritis: f.kritis, kritis_tersisa: f.kritisSisa,
                             proyek: f.proyek.slice(0, 10).map(x => ({ proses: x.nama, status: x.status, mode: x.mode, kritis: x.kritis, rpn_awal: x.rpnAwal, rpn_sesudah: x.dinilaiUlang ? x.rpnSesudah : null, turun_persen: x.turun })) } };
        case 'integrasi':
            return { angka_kunci: angkaKunci,
                     ringkasan_komponen: { mutu: ringkasKomponen('mutu'), keselamatan: ringkasKomponen('keselamatan'), budaya: ringkasKomponen('budaya'), risiko: ringkasKomponen('risiko') },
                     tema: snap.tema.slice(0, 8).map(t => ({ tema: t.tema, indikator_tidak_tercapai: t.indikatorTidakTercapai.slice(0, 5), insiden: t.insiden, insiden_berat: t.insidenBerat,
                                                              risiko: t.risiko, risiko_tinggi_ekstrem: t.risikoTinggi, fmea: t.fmea })),
                     unit_prioritas: lapUnitPrioritas(snap, 8),
                     budaya_lapor: b.ada ? b.utama.budaya && b.utama.budaya['Budaya Lapor'] : null, rasio_nyaris_cedera_per_cedera: ins.rasioNyarisCedera,
                     tindak_lanjut_laporan_sebelumnya: { terbuka: snap.tindakLanjut.terbuka, selesai: snap.tindakLanjut.selesai, terlambat: snap.tindakLanjut.terlambat,
                                                         disposisi_terakhir: snap.tindakLanjut.disposisiTerakhir } };
        case 'eksekutif':
            return { angka_kunci: angkaKunci, ringkasan_komponen: { mutu: ringkasKomponen('mutu'), keselamatan: ringkasKomponen('keselamatan'), budaya: ringkasKomponen('budaya'), risiko: ringkasKomponen('risiko') },
                     integrasi: hasilAI.integrasi ? { keterkaitan: (hasilAI.integrasi.keterkaitan || []).slice(0, 5), rekomendasi: (hasilAI.integrasi.rekomendasi_strategis || []).map(x => x.uraian).slice(0, 5) } : null };
        case 'unit': {
            const u = snap.unit[unit];
            return { unit, periode: snap.periode.label, kepatuhan: u.kepatuhan, indikator: u.indikator.daftar.slice(0, 25), insiden: u.insiden, risiko: u.risiko,
                     validasi: u.validasi, pdsa: u.pdsa, catatan_awal: lapSaranAturan(u) };
        }
    }
    return {};
}
function lapRingkasSurvei(s) {
    return { nama: s.nama, tanggal: `${s.mulai} s.d. ${s.selesai}`, responden: s.responden, tingkat_respons: s.tingkatRespons, target_respons: s.target,
             budaya: s.budaya, dimensi: s.dimensi, terkuat: s.terkuat, terlemah: s.terlemah, profesi: s.profesi };
}

// =====================================================================
// PEMERIKSA ANGKA (grounding): angka di narasi harus ada di data
// =====================================================================
function lapAngkaDalam(obj, set = new Set()) {
    if (obj === null || obj === undefined) return set;
    if (typeof obj === 'number') { [obj, lapBulat(obj, 1), lapBulat(obj, 0), lapBulat(obj, 2)].forEach(x => set.add(String(x))); return set; }
    if (typeof obj === 'string') { (obj.match(/\d+(?:[.,]\d+)?/g) || []).forEach(t => { const n = Number(t.replace(',', '.')); if (!isNaN(n)) lapAngkaDalam(n, set); }); return set; }
    if (Array.isArray(obj)) { obj.forEach(x => lapAngkaDalam(x, set)); set.add(String(obj.length)); return set; }
    if (typeof obj === 'object') Object.entries(obj).forEach(([k, v]) => { lapAngkaDalam(k, set); lapAngkaDalam(v, set); });
    return set;
}
// Ambang & ketentuan baku yang boleh disebut tanpa ada di data
const LAP_ANGKA_BAKU = [80, 90, 75, 50, 100, 24, 48, 45, 14, 7, 2, 20, 60];
function lapPeriksaAngka(teks, sahSet) {
    const temuan = [];
    LAP_ANGKA_BAKU.forEach(n => sahSet.add(String(n)));
    const kalimat = String(teks || '').split(/(?<=[.!?])\s+/);
    kalimat.forEach(k => {
        // abaikan nomor butir/tahun/tanggal pendek
        (k.match(/(?<![\w/-])\d+(?:[.,]\d+)?(?![\w/])/g) || []).forEach(t => {
            let n = Number(t.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
            if (isNaN(n) || (Number.isInteger(n) && n <= 12) || (n >= 1990 && n <= 2100 && Number.isInteger(n))) return;
            // Himpunan sah sudah memuat angka data asli dan pembulatannya (0, 1, 2 desimal),
            // jadi angka di teks harus sama dengan salah satunya pada presisi yang ditulis.
            const cocok = sahSet.has(String(n));
            if (!cocok) temuan.push({ angka: t, kalimat: k.trim().slice(0, 240) });
        });
    });
    return temuan;
}

if (typeof module !== 'undefined') module.exports = {
    lapPeriode, lapPeriodeSebelumnya, lapPeriodeTahunLalu, lapSusunSnapshot, lapSaranAturan, lapKonteksAI, lapPeriksaAngka, lapAngkaDalam,
    lapUnitPrioritas, lapSkorBudaya, lapFmt, lapArahKecil, lapNarasiAturan, lapJenisIndikator, lapTercapai, LAP_BULAN, LAP_TEMA, lapTemaTeks, lapPilihSurvei, lapRpnBaris
};
