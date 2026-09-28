// =====================================================================
// engine_mutu.js - MESIN PERHITUNGAN CAPAIAN INDIKATOR (SATU SUMBER)
// =====================================================================
// Dipakai oleh: laporan_mutu.html, laporan_komprehensif.html,
//               database_admin.html (Tutup Tahun).
// Karena ketiganya memakai fungsi yang sama, angka yang diarsipkan saat
// Tutup Tahun dijamin identik dengan angka yang tampil di laporan live.
// =====================================================================

// Hitung Numerator / Denominator dari template JSON di profil indikator.
// template: '{"tipe":"SUM"|"COUNTALL"|"COUNTIF","target_kolom":n,...}'
function eksekusiRumusEngine(template, rows, colsConfig) {
    if (!template) return 0;
    let t = template.toString().trim();
    if (t.startsWith('{') && t.endsWith('}')) {
        try {
            let rule = JSON.parse(t);
            let colIdx = parseInt(rule.target_kolom);

            if (rule.tipe === "COUNTALL") return rows.length;
            else if (rule.tipe === "SUM") {
                if (isNaN(colIdx)) return 0;
                return rows.reduce((acc, r) => acc + (parseFloat(r.data_input[colIdx]) || 0), 0);
            }
            else if (rule.tipe === "COUNTIF") {
                if (isNaN(colIdx)) return 0;
                let kriteria = (rule.nilai_kriteria || "").toString().toLowerCase().trim();
                let op = rule.operator || "==";

                return rows.filter(r => {
                    let val = (r.data_input[colIdx] !== null && r.data_input[colIdx] !== undefined)
                                ? r.data_input[colIdx].toString().toLowerCase().trim() : "";
                    if (op === "==") return val === kriteria;
                    if (op === "!=") return val !== kriteria;
                    if (op === "includes") return val.includes(kriteria);
                    return false;
                }).length;
            }
        } catch (e) {}
    }
    return 0;
}

// Apakah profil indikator punya template engine yang valid?
function indikatorPakaiEngine(profil) {
    const tmplNum = (profil.template_numerator || "").toString().trim();
    const tmplDen = (profil.template_denominator || "").toString().trim();
    return tmplNum.startsWith('{') || tmplDen.startsWith('{');
}

// Capaian dari N/D (dibulatkan 2 desimal); null jika D = 0.
function hitungCapaianND(N, D, satuan) {
    if (!(D > 0)) return null;
    let c = N / D;
    if ((satuan || "").includes('%')) c *= 100;
    return Math.round(c * 100) / 100;
}

// Tercapai / tidak menurut arah target di profil. null jika capaian null.
function cekTercapaiProfil(profil, capaian) {
    if (capaian === null || capaian === undefined) return null;
    const target = parseFloat(profil.target) || 0;
    const arah = (profil.arah_target || "Positif").toLowerCase();
    if (arah.includes("kecil") || arah.includes("negatif") || arah.includes("≤")) return capaian <= target;
    return capaian >= target;
}

// Ringkasan Tutup Tahun: satu baris per INDIKATOR x UNIT x BULAN.
// Kolom arsip `unit_pelaksana` diisi unit yang melapor (unit_kerja),
// sehingga laporan dapat menampilkan rincian per unit & RLS per unit berlaku.
// Mengembalikan { ringkasan: [...], barisTerangkum: n }.
function susunRingkasanTutupTahun(tahun, masterIndikator, setupForm, rawRows) {
    const ringkasan = [];
    const idTerangkum = new Set();

    masterIndikator.forEach(profil => {
        const sf = setupForm.find(f => f.id_form === profil.id_form);
        if (!sf || !indikatorPakaiEngine(profil)) return;

        const rowsIndikator = rawRows.filter(d => d.id_indikator === profil.id_form);
        if (rowsIndikator.length === 0) return;

        const tmplNum = (profil.template_numerator || "").toString().trim();
        const tmplDen = (profil.template_denominator || "").toString().trim();

        // Kelompokkan per unit per bulan
        const grup = {};
        rowsIndikator.forEach(r => {
            const kunci = `${r.unit_kerja}||${r.bulan}`;
            (grup[kunci] = grup[kunci] || []).push(r);
            idTerangkum.add(r.id);
        });

        Object.entries(grup).forEach(([kunci, rows]) => {
            const [unit, bulanStr] = kunci.split('||');
            const N = eksekusiRumusEngine(tmplNum, rows, sf.kolom);
            const D = eksekusiRumusEngine(tmplDen, rows, sf.kolom);
            const C = hitungCapaianND(N, D, profil.satuan);

            ringkasan.push({
                tahun: tahun,
                bulan: parseInt(bulanStr),
                id_indikator: profil.id_indikator,
                judul_indikator: profil.judul_indikator,
                kategori_indikator: profil.kategori_indikator,
                unit_pelaksana: unit,
                numerator: N,
                denominator: D,
                capaian: C,
                target: parseFloat(profil.target) || 0,
                satuan: profil.satuan,
                is_tercapai: cekTercapaiProfil(profil, C)
            });
        });
    });

    return { ringkasan, barisTerangkum: idTerangkum.size };
}
