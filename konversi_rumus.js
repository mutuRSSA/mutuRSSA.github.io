// =====================================================================
// konversi_rumus.js - KONVERSI RUMUS INDIKATOR LAMA (Google Sheet) KE
//                     TEMPLATE JSON MESIN BARU
// =====================================================================
// Rumus lama (kolom Template_Numerator / Template_Denominator di sheet
// Setup_Indikator) berbentuk rumus spreadsheet, contoh:
//   =COUNTIFS('{{NAMA_SHEET}}'!$L$2:$L; "<30 menit"; '{{NAMA_SHEET}}'!$B$2:$B; ">="&DATE(...))
//   =SUMIFS('{{NAMA_SHEET}}'!$D$2:$D; '{{NAMA_SHEET}}'!$A$2:$A; $C{{ROW}})
// Diubah menjadi template yang dipahami engine_mutu.js & fungsi database
// mutu_nilai_rumus:
//   {"tipe":"COUNTIF","target_kolom":11,"operator":"==","nilai_kriteria":"<30 menit"}
//   {"tipe":"SUM","target_kolom":3}
//
// Aturan:
//   * Kriteria BULAN/TANGGAL dibuang: data baru sudah dikelompokkan per bulan.
//   * Huruf kolom (A, B, ...) -> judul kolom lama (urutan Setup_Formulir)
//     -> indeks kolom formulir di Supabase (dicocokkan lewat JUDUL).
//   * "="  -> "=="  (kosong -> "kosong";  *teks* -> "includes")
//   * "<>" -> "!="  (kosong -> "tidak_kosong")
//   * "<"/">" dengan angka -> operator angka; dengan teks (mis. "<30 menit")
//     -> dicocokkan persis, karena sel berisi teks "<30 menit" hasil rumus baris.
//   * TRUE/FALSE pada kolom checkbox -> "Ya"/"Tidak".
//   * Beberapa syarat -> daftar "syarat" (semua harus terpenuhi).
//   * Penjumlahan/pengurangan beberapa rumus, rujukan ke sheet (formulir)
//     lain, dan angka tetap -> template GABUNGAN / KONSTAN.
//   * Yang tidak bisa dipetakan (rujukan sel lain, pola wildcard rumit,
//     formulir lain yang tidak ada di Form Builder) -> status "manual".
//
// Fungsi murni (tanpa DOM / database) supaya bisa diuji terpisah.
// =====================================================================

function konvNormal(s) {
    return String(s ?? '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function konvHurufKeIndeks(huruf) {
    let n = 0;
    for (const ch of String(huruf).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

// Pecah argumen tingkat atas (pemisah ; atau ,) dengan menghormati (), {} dan "..."
function konvPecahArgumen(s) {
    const out = []; let buf = '', lv = 0, q = false;
    for (const ch of s) {
        if (ch === '"') q = !q;
        if (!q) {
            if (ch === '(' || ch === '{') lv++;
            else if (ch === ')' || ch === '}') lv--;
            else if ((ch === ';' || ch === ',') && lv === 0) { out.push(buf.trim()); buf = ''; continue; }
        }
        buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

// Cari NAMA( ... ) pertama; kembalikan isi di dalam kurung + teks sebelum/sesudahnya
function konvIsiFungsi(s, nama) {
    const re = new RegExp('(^|[^A-Z0-9_.])' + nama + '\\(', 'i');
    const m = re.exec(s);
    if (!m) return null;
    const mulai = m.index + m[1].length;
    let k = mulai + nama.length + 1, lv = 1, q = false;
    while (k < s.length && lv) {
        const ch = s[k];
        if (ch === '"') q = !q;
        else if (!q && ch === '(') lv++;
        else if (!q && ch === ')') lv--;
        k++;
    }
    return { isi: s.slice(mulai + nama.length + 1, k - 1), sebelum: s.slice(0, mulai), sesudah: s.slice(k) };
}

// "'{{NAMA_SHEET}}'!$D$2:$D" -> { sheet: "{{NAMA_SHEET}}", kolom: "D" }
function konvRange(r) {
    let s = String(r || '').replace(/\$/g, '').trim();
    let sheet = null;
    const ms = s.match(/^'((?:[^']|'')*)'!(.*)$/) || s.match(/^([^'!]+)!(.*)$/);
    if (ms) { sheet = ms[1].replace(/''/g, "'"); s = ms[2]; }
    const m = s.match(/^([A-Z]+)\d*:([A-Z]+)\d*$/i);
    if (!m || m[1].toUpperCase() !== m[2].toUpperCase()) return { sheet, kolom: null };
    return { sheet, kolom: m[1].toUpperCase() };
}

function konvSheetSendiri(sheet) {
    return sheet === null || /\{\{\s*NAMA_SHEET\s*\}\}/i.test(sheet);
}

// Kriteria COUNTIFS/SUMIFS -> { jenis: 'BULAN' } | { jenis: 'nilai', op, nilai } | { jenis: 'rujukan', teks }
function konvKriteria(c) {
    const t = String(c ?? '').trim();
    if (/DATE\s*\(|EOMONTH\s*\(|\{\{\s*(ROW|BULAN|TAHUN)\s*\}\}/i.test(t)) return { jenis: 'BULAN' };
    let m = t.match(/^"((?:[^"]|"")*)"$/);
    if (m) {
        const isi = m[1].replace(/""/g, '"');
        const mo = isi.match(/^(<>|>=|<=|=|>|<)?([\s\S]*)$/);
        return { jenis: 'nilai', op: mo[1] || '=', nilai: mo[2] };
    }
    if (/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return { jenis: 'nilai', op: '=', nilai: t.replace(',', '.') };
    if (/^(TRUE|FALSE|BENAR|SALAH)$/i.test(t)) return { jenis: 'nilai', op: '=', nilai: t.toUpperCase() };
    return { jenis: 'rujukan', teks: t };
}

// Urai teks rumus lama
function konvUrai(teks) {
    if (teks === null || teks === undefined) return { fungsi: 'KOSONG' };
    const s = String(teks).trim().replace(/^=/, '').trim();
    if (s === '' || /^none$/i.test(s)) return { fungsi: 'KOSONG' };
    if (s.startsWith('{')) return { fungsi: 'JSON' };
    if (/^[-+]?\d+(?:[.,]\d+)?$/.test(s)) return { fungsi: 'KONSTAN', nilai: s };
    for (const fn of ['COUNTIFS', 'SUMIFS', 'COUNTIF', 'SUMIF']) {
        const r = konvIsiFungsi(s, fn);
        if (!r) continue;
        let a = konvPecahArgumen(r.isi);
        const hasil = { fungsi: fn, sumRange: null, pasangan: [], sisa: (r.sebelum + r.sesudah).trim() };
        if (fn === 'SUMIFS') { hasil.sumRange = a[0]; a = a.slice(1); }
        if (fn === 'SUMIF') { hasil.sumRange = a.length > 2 ? a[2] : a[0]; a = a.slice(0, 2); }
        for (let i = 0; i + 1 < a.length; i += 2) hasil.pasangan.push({ range: a[i], kriteria: a[i + 1] });
        if (a.length % 2 === 1) hasil.sisa = (hasil.sisa + ' ' + a[a.length - 1]).trim();
        return hasil;
    }
    return { fungsi: '?' };
}

const KONV_OP_ANGKA = { '<': '<', '>': '>', '<=': '<=', '>=': '>=' };

// Kriteria lama -> { operator, nilai, cek?: catatan }
function konvOperator(op, nilai, tipeKolom) {
    let v = String(nilai ?? '');
    const checkbox = /checkbox/i.test(tipeKolom || '');
    if (/^(TRUE|BENAR)$/i.test(v) && (checkbox || op === '=' || op === '<>')) v = checkbox ? 'Ya' : 'TRUE';
    if (/^(FALSE|SALAH)$/i.test(v) && (checkbox || op === '=' || op === '<>')) v = checkbox ? 'Tidak' : 'FALSE';

    if (op === '=') {
        if (v === '') return { operator: 'kosong', nilai: '' };
        if (/[*?]/.test(v)) {
            const inti = v.replace(/^\*+|\*+$/g, '');
            if (/[*?]/.test(inti)) return { manual: `pola wildcard "${v}" tidak didukung` };
            return { operator: 'includes', nilai: inti, cek: /^\*.*\*$/.test(v) ? null : `pola "${v}" diubah menjadi "mengandung ${inti}"` };
        }
        return { operator: '==', nilai: v };
    }
    if (op === '<>') {
        if (v === '') return { operator: 'tidak_kosong', nilai: '' };
        if (/[*?]/.test(v)) {
            const inti = v.replace(/^\*+|\*+$/g, '');
            if (/[*?]/.test(inti)) return { manual: `pola wildcard "${v}" tidak didukung` };
            return { operator: 'excludes', nilai: inti, cek: /^\*.*\*$/.test(v) ? null : `pola "<>${v}" diubah menjadi "tidak mengandung ${inti}"` };
        }
        return { operator: '!=', nilai: v };
    }
    if (KONV_OP_ANGKA[op]) {
        if (/^[-+]?\d+(?:[.,]\d+)?$/.test(v.trim())) return { operator: op, nilai: v.trim().replace(',', '.') };
        // mis. "<30 menit": sel berisi teks hasil rumus baris -> dicocokkan persis
        return { operator: '==', nilai: op + v, cek: `kriteria teks "${op}${v}" dicocokkan persis dengan isi sel` };
    }
    return { manual: `operator "${op}" tidak dikenal` };
}

// Pecah ekspresi tingkat atas menjadi suku +/-: "=(A)-(B)+0,5" -> [{tanda:'+',teks:'(A)'},{tanda:'-',teks:'(B)'},{tanda:'+',teks:'0,5'}]
function konvPecahSuku(s) {
    const out = []; let buf = '', lv = 0, q = false, sq = false, tanda = '+';
    const dorong = () => { if (buf.trim()) out.push({ tanda, teks: buf.trim() }); buf = ''; };
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"' && !sq) q = !q;
        else if (ch === "'" && !q) sq = !sq;   // nama sheet 'A-B' boleh berisi tanda minus
        if (!q && !sq) {
            if (ch === '(' || ch === '{') lv++;
            else if (ch === ')' || ch === '}') lv--;
            else if ((ch === '+' || ch === '-') && lv === 0) {
                // tanda bilangan di awal (mis. "-4") bukan pemisah suku
                if (buf.trim() === '') { if (ch === '-') tanda = tanda === '-' ? '+' : '-'; continue; }
                dorong(); tanda = ch; continue;
            }
        }
        buf += ch;
    }
    dorong();
    return out;
}

function konvBukaKurung(t) {
    let s = t.trim();
    while (s.startsWith('(') && s.endsWith(')')) {
        let lv = 0, q = false, tutupDiAkhir = true;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (ch === '"') q = !q;
            if (q) continue;
            if (ch === '(') lv++; else if (ch === ')') { lv--; if (lv === 0 && i < s.length - 1) { tutupDiAkhir = false; break; } }
        }
        if (!tutupDiAkhir) break;
        s = s.slice(1, -1).trim();
    }
    return s;
}

// Cocokkan nama sheet (maks. 31 karakter di Excel) ke id_form
function konvCariForm(nama, daftar) {
    const n = konvNormal(nama);
    const persis = daftar.find(id => konvNormal(id) === n);
    if (persis) return persis;
    const awalan = daftar.filter(id => konvNormal(id).startsWith(n));
    return awalan.length === 1 ? awalan[0] : null;
}

/**
 * Konversi satu rumus lama.
 * @param teks  rumus lama (string)
 * @param ctx   { idForm, kolomLama: Map(id_form lama -> [{judul,tipe}]), kolomBaru: Map(id_form -> [{judul,tipe}]) }
 *              (bentuk lama (teks, kolomLama[], kolomBaru[]) masih diterima)
 * @returns { status: 'otomatis'|'cek'|'manual'|'kosong'|'sudah', template: string|null, catatan: string[] }
 */
function konversiRumusLama(teks, ctx, kolomBaruLama) {
    if (Array.isArray(ctx) || ctx === undefined || ctx === null) {
        ctx = { idForm: '__ini__', kolomLama: new Map([['__ini__', ctx || []]]), kolomBaru: new Map([['__ini__', kolomBaruLama || []]]) };
    }
    const catatan = [];
    const manual = alasan => ({ status: 'manual', template: null, catatan: [alasan] });
    const u = konvUrai(teks);

    if (u.fungsi === 'KOSONG') return { status: 'kosong', template: null, catatan: ['rumus lama kosong'] };
    if (u.fungsi === 'JSON') {
        const t = (typeof mutuParseTemplate === 'function') ? mutuParseTemplate(teks) : (() => { try { return JSON.parse(teks); } catch (e) { return null; } })();
        return t ? { status: 'sudah', template: JSON.stringify(t), catatan: ['sudah format baru'] } : manual('JSON tidak valid');
    }

    const idLama = [...ctx.kolomLama.keys()], idBaru = [...ctx.kolomBaru.keys()];
    const ekspresi = String(teks).trim().replace(/^=/, '').trim();
    const suku = konvPecahSuku(ekspresi);
    if (!suku.length) return manual('rumus tidak dikenali');

    const bagian = [];
    for (const sk of suku) {
        const isi = konvBukaKurung(sk.teks);
        // Angka tetap
        if (/^[-+]?\d+(?:[.,]\d+)?$/.test(isi)) {
            bagian.push({ tanda: sk.tanda, form: null, rumus: { tipe: 'KONSTAN', nilai: Number(isi.replace(',', '.')) } });
            catatan.push(`angka tetap ${isi}`);
            continue;
        }
        const f = konvUrai('=' + isi);
        if (f.fungsi === '?' || f.fungsi === 'KOSONG' || f.fungsi === 'JSON' || f.fungsi === 'KONSTAN') return manual(`bagian "${isi.slice(0, 60)}" bukan COUNTIFS/SUMIFS`);
        if (f.sisa) return manual(`bagian "${isi.slice(0, 60)}" berisi operasi lain`);

        // Sheet yang dibaca bagian ini (semua rentang harus dari sheet yang sama)
        const semuaRange = [...f.pasangan.map(p => p.range), ...(f.sumRange ? [f.sumRange] : [])];
        const sheets = new Set(semuaRange.map(r => { const x = konvRange(r); return konvSheetSendiri(x.sheet) ? '' : x.sheet; }));
        if (sheets.size > 1) return manual('satu COUNTIFS/SUMIFS membaca beberapa sheet sekaligus');
        const sheet = [...sheets][0] || '';
        let formBaru = ctx.idForm, formLama = ctx.idForm, formLain = null;
        if (sheet) {
            formBaru = konvCariForm(sheet, idBaru);
            formLama = konvCariForm(sheet, idLama);
            if (!formBaru) return manual(`merujuk sheet "${sheet}" yang tidak ada di Form Builder`);
            if (!formLama) return manual(`struktur kolom sheet "${sheet}" tidak ada di Setup_Formulir lama`);
            if (formBaru !== ctx.idForm) { formLain = formBaru; catatan.push(`mengambil data formulir ${formBaru} (unit & bulan yang sama)`); }
        }
        const kolomLama = ctx.kolomLama.get(formLama) || [];
        const kolomBaru = ctx.kolomBaru.get(formBaru) || [];

        const petaKolom = (range) => {
            const r = konvRange(range);
            if (!r.kolom) return { salah: `rentang "${range}" tidak dikenali` };
            const kl = kolomLama[konvHurufKeIndeks(r.kolom)];
            if (!kl) return { salah: `kolom ${r.kolom} tidak ada di formulir lama ${formLama === '__ini__' ? '' : formLama}`.trim() };
            const cocok = [];
            kolomBaru.forEach((k, i) => { if (konvNormal(k.judul) === konvNormal(kl.judul)) cocok.push(i); });
            if (!cocok.length) return { salah: `kolom "${kl.judul}" (${r.kolom}) tidak ditemukan di Form Builder${formLain ? ' ' + formLain : ''}` };
            if (cocok.length > 1) catatan.push(`judul kolom "${kl.judul}" muncul ${cocok.length}x di Form Builder; dipakai yang pertama`);
            return { indeks: cocok[0], judul: kolomBaru[cocok[0]].judul, tipe: kolomBaru[cocok[0]].tipe };
        };

        const syarat = [];
        for (const p of f.pasangan) {
            const k = konvKriteria(p.kriteria);
            if (k.jenis === 'BULAN') continue;
            if (k.jenis === 'rujukan') return manual(`kriteria merujuk sel/rumus lain (${k.teks})`);
            const kol = petaKolom(p.range);
            if (kol.salah) return manual(kol.salah);
            const o = konvOperator(k.op, k.nilai, kol.tipe);
            if (o.manual) return manual(o.manual);
            if (o.cek) catatan.push(o.cek);
            const sy = { kolom: kol.indeks, operator: o.operator };
            if (o.operator !== 'kosong' && o.operator !== 'tidak_kosong') sy.nilai = o.nilai;
            syarat.push(sy);
        }
        let rumus;
        if (f.fungsi === 'COUNTIFS' || f.fungsi === 'COUNTIF') rumus = { tipe: 'COUNTALL' };
        else {
            const kol = petaKolom(f.sumRange);
            if (kol.salah) return manual(kol.salah);
            rumus = { tipe: 'SUM', target_kolom: kol.indeks };
        }
        if (syarat.length) rumus.syarat = syarat;
        bagian.push({ tanda: sk.tanda, form: formLain, rumus });
    }

    let t;
    if (bagian.length === 1 && bagian[0].tanda === '+' && !bagian[0].form) t = bagian[0].rumus;
    else t = { tipe: 'GABUNGAN', bagian: bagian.map(b => Object.assign({ tanda: b.tanda }, b.form ? { id_form: b.form } : {}, { rumus: b.rumus })) };
    // Catatan informatif (formulir lain / angka tetap) tidak membuat status "perlu cek"
    const perluCek = catatan.filter(c => !/^angka tetap|^mengambil data formulir/.test(c));
    return { status: perluCek.length ? 'cek' : 'otomatis', template: JSON.stringify(t), catatan };
}

if (typeof module !== 'undefined') module.exports = { konversiRumusLama, konvUrai, konvKriteria, konvRange, konvPecahArgumen, konvPecahSuku, konvBukaKurung, konvNormal };
