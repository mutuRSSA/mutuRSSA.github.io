// =====================================================================
// rumus_builder.js - PEMBANGUN RUMUS INDIKATOR (Profil Indikator)
// =====================================================================
// Setara dengan kemampuan rumus Google Sheet lama (COUNTIFS / SUMIFS +
// penjumlahan/pengurangan + rujukan formulir lain + angka tetap):
//   * satu sisi (N atau D) = satu atau beberapa KOMPONEN yang dijumlah/dikurangkan
//   * komponen: Hitung baris | Jumlahkan kolom | Angka tetap
//   * setiap komponen boleh dari formulir lain (unit & bulan yang sama)
//   * setiap komponen boleh punya BANYAK syarat, dihubungkan dengan DAN / ATAU
//     (DAN dikerjakan lebih dulu: A dan B atau C = (A dan B) atau C)
// Menghasilkan template JSON yang dipahami engine_mutu.js & database.
// Butuh: engine_mutu.js (jelaskanTemplate, periksaTemplate, mutuBagian,
//        mutuParseTemplate, MUTU_OPERATOR), config.js (esc, supabaseClient).
// =====================================================================

const RB = {
    state: { num: [], den: [] },
    idForm: () => '',                 // diisi halaman: formulir indikator saat ini
    daftarForm: () => [],             // diisi halaman: [{id_form, kolom}]
    cacheNilai: new Map(),            // "form|kolom" -> [{nilai, jumlah}]
    tahunSaran: new Date().getFullYear()
};

const RB_OPERATOR = ['==', '!=', 'includes', 'excludes', '>', '>=', '<', '<=', 'kosong', 'tidak_kosong'];

function rbKolom(form) {
    const f = RB.daftarForm().find(x => x.id_form === (form || RB.idForm()));
    return f && Array.isArray(f.kolom) ? f.kolom : null;
}

function rbKomponenBaru(metode = 'COUNT', denganSyarat = false) {
    return { tanda: '+', form: '', metode, kolomJumlah: '', nilai: '', syarat: denganSyarat ? [{ kolom: '', operator: '==', nilai: '' }] : [] };
}

function rbDefault() {
    RB.state.num = [rbKomponenBaru('COUNT', true)];
    RB.state.den = [rbKomponenBaru('COUNT', false)];
}

// ---------- template JSON <-> state ----------
function rbDariTemplate(sisi, teks) {
    const t = mutuParseTemplate(teks);
    if (!t) {
        RB.state[sisi] = [];
        return !(teks && String(teks).trim()) ? 'kosong' : 'tidak_dikenal';
    }
    RB.state[sisi] = mutuBagian(t).map(b => {
        const r = b.rumus;
        const k = rbKomponenBaru(r.tipe === 'SUM' ? 'SUM' : r.tipe === 'KONSTAN' ? 'KONSTAN' : 'COUNT');
        k.tanda = b.tanda < 0 ? '-' : '+';
        k.form = b.id_form || '';
        if (r.tipe === 'KONSTAN') k.nilai = r.nilai ?? '';
        if (r.tipe === 'SUM') k.kolomJumlah = r.target_kolom ?? '';
        if (r.tipe === 'COUNTIF' && r.target_kolom !== undefined && r.target_kolom !== null && String(r.target_kolom) !== '')
            k.syarat.push({ kolom: String(r.target_kolom), operator: r.operator || '==', nilai: r.nilai_kriteria ?? '' });
        if (r.tipe === 'SUM' && r.syarat_kolom !== undefined && r.syarat_kolom !== null && String(r.syarat_kolom) !== '')
            k.syarat.push({ kolom: String(r.syarat_kolom), operator: r.syarat_operator || '==', nilai: r.syarat_nilai ?? '' });
        (Array.isArray(r.syarat) ? r.syarat : []).forEach(s => k.syarat.push({ kolom: String(s.kolom ?? ''), operator: s.operator || '==', nilai: s.nilai ?? '', hubung: s.hubung === 'atau' ? 'atau' : 'dan' }));
        return k;
    });
    return 'ok';
}

function rbKomponenKeRumus(k) {
    const angka = v => (String(v).trim() === '' || isNaN(Number(v))) ? String(v) : Number(v);
    if (k.metode === 'KONSTAN') return { tipe: 'KONSTAN', nilai: angka(k.nilai) };
    const syarat = k.syarat.map((s, j) => {
        const o = { kolom: angka(s.kolom), operator: s.operator || '==' };
        if (s.operator !== 'kosong' && s.operator !== 'tidak_kosong') o.nilai = s.nilai ?? '';
        if (j > 0 && s.hubung === 'atau') o.hubung = 'atau';
        return o;
    });
    const r = k.metode === 'SUM' ? { tipe: 'SUM', target_kolom: angka(k.kolomJumlah) } : { tipe: 'COUNTALL' };
    if (syarat.length) r.syarat = syarat;
    return r;
}

function rbKeTemplate(sisi) {
    const komp = RB.state[sisi];
    if (!komp.length) return null;
    if (komp.length === 1 && komp[0].tanda === '+' && !komp[0].form) return JSON.stringify(rbKomponenKeRumus(komp[0]));
    return JSON.stringify({
        tipe: 'GABUNGAN',
        bagian: komp.map(k => {
            const b = { tanda: k.tanda };
            if (k.form) b.id_form = k.form;
            b.rumus = rbKomponenKeRumus(k);
            return b;
        })
    });
}

// ---------- tampilan ----------
function rbOpsiKolom(form, terpilih) {
    const kol = rbKolom(form);
    if (!kol) return `<option value="">(formulir tidak ditemukan)</option>`;
    return `<option value="">-- pilih kolom --</option>` + kol.map((k, i) =>
        `<option value="${i}" ${String(terpilih) === String(i) ? 'selected' : ''}>[${i}] ${esc(k.judul)}${k.sembunyi ? ' (disembunyikan)' : ''}</option>`).join('');
}

function rbOpsiForm(terpilih) {
    const ini = RB.idForm();
    return `<option value="">Formulir ini${ini ? ` (${esc(ini)})` : ''}</option>` +
        RB.daftarForm().filter(f => f.id_form !== ini).map(f =>
            `<option value="${esc(f.id_form)}" ${terpilih === f.id_form ? 'selected' : ''}>${esc(f.id_form)}</option>`).join('');
}

function rbRender(sisi) {
    const wadah = document.getElementById(`rb_${sisi}`);
    if (!wadah) return;
    const komp = RB.state[sisi];
    const banyak = komp.length > 1;
    wadah.innerHTML = komp.map((k, i) => {
        const kol = rbKolom(k.form);
        const syaratHtml = k.syarat.map((s, j) => {
            const tanpaNilai = s.operator === 'kosong' || s.operator === 'tidak_kosong';
            return `<div class="d-flex gap-2 align-items-center mb-1 rb-syarat">
                ${j === 0 ? '<span class="small text-muted" style="width:86px;flex:none;padding-left:.5rem">jika</span>'
                    : `<select class="form-select form-select-sm fw-bold ${s.hubung === 'atau' ? 'text-warning-emphasis border-warning' : 'text-muted'}" style="width:86px;flex:none;padding-left:.5rem;padding-right:1.6rem" title="Penghubung dengan syarat sebelumnya"
                        onchange="rbUbahSyarat('${sisi}',${i},${j},'hubung',this.value)">
                        <option value="dan" ${s.hubung !== 'atau' ? 'selected' : ''}>dan</option><option value="atau" ${s.hubung === 'atau' ? 'selected' : ''}>atau</option></select>`}
                <select class="form-select form-select-sm" style="max-width:280px" onchange="rbUbahSyarat('${sisi}',${i},${j},'kolom',this.value)">${rbOpsiKolom(k.form, s.kolom)}</select>
                <select class="form-select form-select-sm" style="max-width:190px" onchange="rbUbahSyarat('${sisi}',${i},${j},'operator',this.value)">
                    ${RB_OPERATOR.map(o => `<option value="${esc(o)}" ${s.operator === o ? 'selected' : ''}>${esc(MUTU_OPERATOR[o])}</option>`).join('')}
                </select>
                <input type="text" class="form-control form-control-sm ${tanpaNilai ? 'd-none' : ''}" style="max-width:220px" value="${esc(s.nilai)}"
                    list="rb_dl_${sisi}_${i}_${j}" placeholder="nilai" onfocus="rbMuatSaran('${sisi}',${i},${j})"
                    oninput="rbUbahSyarat('${sisi}',${i},${j},'nilai',this.value,true)">
                <datalist id="rb_dl_${sisi}_${i}_${j}"></datalist>
                <button type="button" class="btn btn-sm btn-link text-danger p-0" title="Hapus syarat" onclick="rbHapusSyarat('${sisi}',${i},${j})"><i class="fas fa-times"></i></button>
            </div>`;
        }).join('');
        return `<div class="border rounded p-2 mb-2 bg-white">
            <div class="d-flex flex-wrap gap-2 align-items-center">
                ${banyak || k.tanda === '-' ? `<select class="form-select form-select-sm fw-bold" style="width:70px" onchange="rbUbah('${sisi}',${i},'tanda',this.value)">
                    <option value="+" ${k.tanda === '+' ? 'selected' : ''}>+</option><option value="-" ${k.tanda === '-' ? 'selected' : ''}>−</option></select>` : ''}
                <select class="form-select form-select-sm" style="max-width:200px" onchange="rbUbah('${sisi}',${i},'metode',this.value)">
                    <option value="COUNT" ${k.metode === 'COUNT' ? 'selected' : ''}>Hitung jumlah baris</option>
                    <option value="SUM" ${k.metode === 'SUM' ? 'selected' : ''}>Jumlahkan angka kolom</option>
                    <option value="KONSTAN" ${k.metode === 'KONSTAN' ? 'selected' : ''}>Angka tetap</option>
                </select>
                ${k.metode === 'SUM' ? `<select class="form-select form-select-sm" style="max-width:280px" onchange="rbUbah('${sisi}',${i},'kolomJumlah',this.value)">${rbOpsiKolom(k.form, k.kolomJumlah)}</select>` : ''}
                ${k.metode === 'KONSTAN' ? `<input type="number" step="any" class="form-control form-control-sm" style="max-width:140px" value="${esc(k.nilai)}" placeholder="mis. 0.01" oninput="rbUbah('${sisi}',${i},'nilai',this.value,true)">` : ''}
                ${k.metode !== 'KONSTAN' ? `<span class="small text-muted">dari</span>
                <select class="form-select form-select-sm" style="max-width:280px" onchange="rbUbah('${sisi}',${i},'form',this.value)">${rbOpsiForm(k.form)}</select>` : ''}
                <button type="button" class="btn btn-sm btn-outline-danger ms-auto" title="Hapus komponen" onclick="rbHapusKomponen('${sisi}',${i})"><i class="fas fa-trash"></i></button>
            </div>
            ${k.metode !== 'KONSTAN' ? `<div class="mt-2 ps-1">${syaratHtml}
                <button type="button" class="btn btn-sm btn-link p-0" onclick="rbTambahSyarat('${sisi}',${i})"><i class="fas fa-plus me-1"></i>tambah syarat</button>
                ${k.syarat.length > 2 && k.syarat.some((s, j) => j > 0 && s.hubung === 'atau') && k.syarat.some((s, j) => j > 0 && s.hubung !== 'atau')
                    ? '<div class="small text-muted"><i class="fas fa-info-circle me-1"></i>DAN dikerjakan lebih dulu daripada ATAU — lihat kurung pada penjelasan rumus di bawah.</div>' : ''}
                ${!kol ? '<div class="small text-danger">Formulir ini tidak ada di Form Builder.</div>' : ''}</div>` : ''}
        </div>`;
    }).join('') + `
        <div class="d-flex flex-wrap gap-2 align-items-center">
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="rbTambahKomponen('${sisi}')"><i class="fas fa-plus me-1"></i>Tambah komponen (+ / −)</button>
        </div>
        <div class="mt-2 small" id="rb_penjelasan_${sisi}"></div>`;
    rbPerbaruiPenjelasan(sisi);
}

function rbPerbaruiPenjelasan(sisi) {
    const el = document.getElementById(`rb_penjelasan_${sisi}`);
    if (!el) return;
    const t = rbKeTemplate(sisi);
    const masalah = t ? periksaTemplate(t, f => rbKolom(f)) : ['belum ada rumus'];
    el.innerHTML = `<div class="p-2 rounded ${masalah.length ? 'bg-danger bg-opacity-10' : 'bg-success bg-opacity-10'}">
        <i class="fas ${masalah.length ? 'fa-exclamation-circle text-danger' : 'fa-check-circle text-success'} me-1"></i>
        <b>${sisi === 'num' ? 'N' : 'D'} =</b> ${esc(t ? jelaskanTemplate(t, f => rbKolom(f)) : '(kosong)')}
        ${masalah.length ? `<div class="text-danger mt-1">${masalah.map(m => esc(m)).join('<br>')}</div>` : ''}</div>`;
    const json = document.getElementById(`rb_json_${sisi}`);
    if (json && document.activeElement !== json) json.value = t || '';
}

// ---------- aksi ----------
window.rbUbah = function (sisi, i, kolom, nilai, tanpaRender) {
    const k = RB.state[sisi][i];
    k[kolom] = nilai;
    if (kolom === 'form') { k.kolomJumlah = ''; k.syarat.forEach(s => s.kolom = ''); }
    if (kolom === 'metode' && nilai === 'COUNT' && sisi === 'num' && !k.syarat.length) k.syarat.push({ kolom: '', operator: '==', nilai: '' });
    if (tanpaRender) rbPerbaruiPenjelasan(sisi); else rbRender(sisi);
};
window.rbUbahSyarat = function (sisi, i, j, kolom, nilai, tanpaRender) {
    RB.state[sisi][i].syarat[j][kolom] = nilai;
    if (tanpaRender) rbPerbaruiPenjelasan(sisi); else rbRender(sisi);
};
window.rbTambahSyarat = function (sisi, i) { RB.state[sisi][i].syarat.push({ kolom: '', operator: '==', nilai: '', hubung: 'dan' }); rbRender(sisi); };
window.rbHapusSyarat = function (sisi, i, j) { RB.state[sisi][i].syarat.splice(j, 1); rbRender(sisi); };
window.rbTambahKomponen = function (sisi) { RB.state[sisi].push(rbKomponenBaru('COUNT', false)); rbRender(sisi); };
window.rbHapusKomponen = function (sisi, i) { RB.state[sisi].splice(i, 1); rbRender(sisi); };

window.rbTerapkanJson = function (sisi) {
    const teks = document.getElementById(`rb_json_${sisi}`).value.trim();
    if (teks && !mutuParseTemplate(teks)) { Swal.fire('JSON tidak valid', 'Periksa kembali penulisan JSON.', 'warning'); return; }
    rbDariTemplate(sisi, teks);
    rbRender(sisi);
};

// Saran nilai: opsi dropdown kolom + isi data terbanyak (dari database)
window.rbMuatSaran = async function (sisi, i, j) {
    const k = RB.state[sisi][i]; const s = k.syarat[j];
    const dl = document.getElementById(`rb_dl_${sisi}_${i}_${j}`);
    const kol = rbKolom(k.form); const idx = parseInt(s.kolom, 10);
    if (!dl || !kol || isNaN(idx) || !kol[idx]) return;
    const def = kol[idx];
    const saran = new Map();
    if (/checkbox/i.test(def.tipe || '')) { saran.set('Ya', ''); saran.set('Tidak', ''); }
    String(def.opsi || '').split(',').map(x => x.trim()).filter(Boolean).forEach(x => saran.set(x, 'opsi'));
    const form = k.form || RB.idForm(); const kunci = `${form}|${idx}`;
    const isi = () => { dl.innerHTML = [...saran.entries()].map(([v, ket]) => `<option value="${esc(v)}">${esc(ket)}</option>`).join(''); };
    isi();
    if (!RB.cacheNilai.has(kunci)) {
        RB.cacheNilai.set(kunci, []);
        try {
            const { data } = await supabaseClient.rpc('nilai_kolom_mutu', { p_id_form: form, p_kolom: idx, p_tahun: RB.tahunSaran, p_batas: 20 });
            RB.cacheNilai.set(kunci, data || []);
        } catch (e) { console.error(e); }
    }
    RB.cacheNilai.get(kunci).forEach(r => { if (r.nilai !== '') saran.set(r.nilai, `${r.jumlah} baris di data ${RB.tahunSaran}`); });
    isi();
};

// ---------- uji dengan data database ----------
async function rbUji({ tahun, satuan, unitPelaksana, wadah }) {
    const tn = rbKeTemplate('num'), td = rbKeTemplate('den');
    wadah.innerHTML = '<div class="text-muted small"><i class="fas fa-spinner fa-spin me-1"></i> Menghitung...</div>';
    const { data, error } = await supabaseClient.rpc('uji_rumus_mutu', {
        p_id_form: RB.idForm(), p_template_n: tn, p_template_d: td, p_satuan: satuan || '', p_tahun: tahun, p_unit_pelaksana: unitPelaksana || null
    });
    if (error) { wadah.innerHTML = `<div class="alert alert-danger small mb-0">${esc(error.message)}</div>`; return; }
    const rows = data || [];
    if (!rows.length) { wadah.innerHTML = `<div class="alert alert-warning small mb-0">Belum ada data formulir <code>${esc(RB.idForm())}</code> tahun ${tahun}.</div>`; return; }
    const angka = v => v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const sumN = rows.reduce((a, r) => a + Number(r.numerator), 0), sumD = rows.reduce((a, r) => a + Number(r.denominator), 0);
    const dNol = rows.filter(r => !(Number(r.denominator) > 0)).length;
    let saran = '';
    if (sumD === 0) saran = 'Penyebut (D) selalu 0: syarat D tidak pernah cocok dengan isi data. Klik kotak nilai syarat untuk melihat isi data yang sebenarnya.';
    else if (sumN === 0) saran = 'Pembilang (N) selalu 0. Wajar untuk indikator kejadian (mis. insiden), tetapi periksa syarat N bila tidak seharusnya.';
    else if (dNol) saran = `${dNol} unit × bulan dengan D = 0 (capaian kosong).`;
    wadah.innerHTML = `${saran ? `<div class="alert alert-warning small py-2">${esc(saran)}</div>` : ''}
        <div class="table-responsive" style="max-height:300px;overflow-y:auto"><table class="table table-sm small mb-0">
        <thead class="table-light"><tr><th>Unit</th><th>Bulan</th><th class="text-end">Baris</th><th class="text-end">N</th><th class="text-end">D</th><th class="text-end">Capaian</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${Number(r.denominator) > 0 ? '' : 'table-warning'}"><td>${esc(r.unit_kerja)}</td><td>${r.bulan}</td><td class="text-end">${r.jumlah_baris}</td>
            <td class="text-end">${angka(r.numerator)}</td><td class="text-end">${angka(r.denominator)}</td><td class="text-end fw-bold">${angka(r.capaian)}</td></tr>`).join('')}</tbody>
        </table></div>`;
}

// ---------- cek kesehatan rumus semua indikator ----------
// Mengembalikan [{profil, tingkat: 'ok'|'info'|'peringatan'|'masalah', pesan, ringkas}]
async function diagnosaRumusSemua(profilList, daftarForm, tahun) {
    const [hasil, ringkas] = await Promise.all([
        ambilSemuaBaris(() => supabaseClient.rpc('hitung_capaian_mutu', { p_tahun: tahun }).order('id_indikator').order('unit_kerja').order('bulan')),
        supabaseClient.rpc('ringkasan_formulir_mutu', { p_tahun: tahun })
    ]);
    if (ringkas.error) throw ringkas.error;
    const perForm = new Map((ringkas.data || []).map(r => [r.id_form, r]));
    const perInd = new Map();
    hasil.forEach(h => { if (!perInd.has(h.id_indikator)) perInd.set(h.id_indikator, []); perInd.get(h.id_indikator).push(h); });
    const kolomForm = f => { const x = daftarForm.find(d => d.id_form === f); return x && Array.isArray(x.kolom) ? x.kolom : undefined; };

    return profilList.map(p => {
        const out = (tingkat, pesan, ringkasTeks = '') => ({ profil: p, tingkat, pesan, ringkas: ringkasTeks });
        const tn = p.template_numerator, td = p.template_denominator;
        const lamaSheet = [tn, td].some(t => t && String(t).trim().startsWith('='));
        if (!indikatorPakaiEngine(p)) return out('masalah', lamaSheet ? 'Masih rumus Google Sheet — ubah lewat halaman Konversi Rumus Lama atau pembangun rumus.' : 'Belum ada rumus N/D.');
        if (!kolomForm(p.id_form)) return out('masalah', `Formulir "${p.id_form}" tidak ada di Form Builder.`);
        const masalah = [...periksaTemplate(tn, f => kolomForm(f || p.id_form)).map(m => 'N: ' + m), ...periksaTemplate(td, f => kolomForm(f || p.id_form)).map(m => 'D: ' + m)];
        if (masalah.length) return out('masalah', masalah.join('; '));
        const rf = perForm.get(p.id_form);
        if (!rf) return out('peringatan', `Belum ada data ${tahun} di formulir ini.`);
        const g = perInd.get(p.id_indikator) || [];
        const sumN = g.reduce((a, r) => a + Number(r.numerator), 0), sumD = g.reduce((a, r) => a + Number(r.denominator), 0);
        const ter = `${g.length} unit×bulan; bulan terisi ${rf.bulan.join(', ')}; N ${sumN.toLocaleString('id-ID')} / D ${sumD.toLocaleString('id-ID')}`;
        if (!g.length) return out('peringatan', 'Formulir berisi data, tetapi rumus tidak menghasilkan angka.', ter);
        if (sumD === 0) return out('masalah', 'Penyebut (D) selalu 0 — syarat D tidak pernah cocok dengan isi data (cek ejaan nilai, mis. "Ya" vs "YA ", atau kolom yang dipilih).', ter);
        const dNol = g.filter(r => !(Number(r.denominator) > 0)).length;
        if (dNol) return out('peringatan', `${dNol} dari ${g.length} unit×bulan punya D = 0 (capaian kosong).`, ter);
        if (sumN === 0) return out('info', 'Pembilang (N) selalu 0 — wajar untuk indikator kejadian, periksa bila tidak seharusnya.', ter);
        return out('ok', 'Rumus menghasilkan capaian.', ter);
    });
}

if (typeof module !== 'undefined') module.exports = { RB, rbDefault, rbDariTemplate, rbKeTemplate, rbKomponenKeRumus, diagnosaRumusSemua };
