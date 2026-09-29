// =====================================================================
// Uji otomatis SIM-PMKP
//   node jalankan.mjs            -> semua uji
//   node jalankan.mjs 03 mesin   -> hanya uji yang namanya memuat "03" atau "mesin"
//
// DATABASE_URL (bawaan: Supabase lokal hasil `supabase start`)
//   postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Setiap uji berjalan di dalam transaksi yang SELALU di-ROLLBACK, jadi tidak
// ada data uji yang tersimpan. Walau begitu, uji hanya boleh diarahkan ke
// database lokal/staging; database di luar mesin ini ditolak kecuali
// IZINKAN_DB_LUAR=1.
// =====================================================================
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const URL_DB = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const host = (() => { try { return new URL(URL_DB).hostname; } catch { return ''; } })();
if (host && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && process.env.IZINKAN_DB_LUAR !== '1') {
  console.error(`Menolak menjalankan uji ke ${host}. Gunakan database lokal/staging, atau set IZINKAN_DB_LUAR=1 bila yakin.`);
  process.exit(2);
}
const saring = process.argv.slice(2);
const dipilih = nama => !saring.length || saring.some(s => nama.includes(s));
const PERSIAPAN = fs.readFileSync(path.join(DIR, 'sql', '00_persiapan.sql'), 'utf8');

async function dalamTransaksi(fn) {
  const c = new pg.Client({ connectionString: URL_DB });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(PERSIAPAN);
    return await fn(c);
  } finally {
    try { await c.query('rollback'); } catch { /* koneksi terputus */ }
    await c.end();
  }
}

// ---------------------------------------------------------------------
// 1. Uji SQL (alur & aturan database)
// ---------------------------------------------------------------------
const hasil = [];
const berkas = fs.readdirSync(path.join(DIR, 'sql')).filter(f => /^\d\d_.+\.sql$/.test(f) && f !== '00_persiapan.sql').sort();
for (const f of berkas.filter(dipilih)) {
  const sql = fs.readFileSync(path.join(DIR, 'sql', f), 'utf8');
  const mulai = Date.now();
  try {
    await dalamTransaksi(c => c.query(sql));
    hasil.push({ nama: f, ok: true, ms: Date.now() - mulai });
  } catch (e) {
    hasil.push({ nama: f, ok: false, ms: Date.now() - mulai, pesan: e.message });
  }
}

// ---------------------------------------------------------------------
// 2. Mesin rumus: hitung_capaian_mutu (database) == engine_mutu.js (browser)
//    Data & rumus acak (benih tetap) meliputi COUNTALL, COUNTIF, SUM, KONSTAN,
//    syarat bertingkat, GABUNGAN antar formulir, nilai kosong/aneh.
// ---------------------------------------------------------------------
if (dipilih('mesin')) {
  const mulai = Date.now();
  try {
    const require = createRequire(import.meta.url);
    const E = require(path.join(DIR, '..', 'engine_mutu.js'));
    let benih = 20260929;
    const acak = () => { benih |= 0; benih = benih + 0x6D2B79F5 | 0; let t = Math.imul(benih ^ benih >>> 15, 1 | benih); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pilih = a => a[Math.floor(acak() * a.length)];
    const antara = (a, b) => a + Math.floor(acak() * (b - a + 1));

    const NILAI = ['Ya', 'ya ', 'YA', 'Tidak', 'tidak', '', null, '<30 menit', '>60 menit', '30-60 Menit', 0, 1, 2.5, '3', '12.5%', '-4', 'abc', '.5', '1e2', ' 7 ', 15, 14.99, 'Ya, lengkap', 'Sesuai', 'Tidak Sesuai', true, false];
    const OPS = ['==', '!=', 'includes', 'excludes', '>', '>=', '<', '<=', 'kosong', 'tidak_kosong'];
    const KRIT = ['ya', 'Tidak', '<30 menit', '15', '2.5', '', 'menit', 'sesuai', '0', 'abc', 'true'];
    const FORM = ['UJM1', 'UJM2', 'UJM3'];
    const baris = [];
    for (let i = 0; i < 4000; i++) {
      const f = pilih(FORM);
      baris.push({ unit_kerja: f === 'UJM3' ? pilih(['UJ B', 'UJ C', 'UJ D']) : pilih(['UJ A', 'UJ B', 'UJ C']),
                   id_indikator: f, bulan: f === 'UJM3' ? antara(3, 6) : antara(1, 4), tahun: 2031,
                   data_input: Array.from({ length: 8 }, () => pilih(NILAI)) });
    }
    const syarat = () => Array.from({ length: antara(0, 3) }, () => ({ kolom: pilih([0, 2, '5', 7, '9']), operator: pilih(OPS), nilai: pilih(KRIT) }));
    const sederhana = () => {
      const r = acak(); let t;
      if (r < .2) t = { tipe: 'COUNTALL' };
      else if (r < .45) t = { tipe: 'COUNTIF', target_kolom: pilih([0, 3, '5', '7x']), operator: pilih(OPS), nilai_kriteria: pilih(KRIT) };
      else if (r < .55) t = { tipe: 'COUNTIF' };
      else if (r < .6) t = { tipe: 'KONSTAN', nilai: pilih([0.01, 5, '2.5', -1]) };
      else {
        t = { tipe: 'SUM', target_kolom: pilih([1, 4, '6']) };
        if (acak() < .3) Object.assign(t, { syarat_kolom: pilih([0, 2]), syarat_operator: pilih(OPS), syarat_nilai: pilih(KRIT) });
      }
      if (acak() < .5 && t.tipe !== 'KONSTAN') t.syarat = syarat();
      return t;
    };
    const rumus = () => acak() < .35
      ? { tipe: 'GABUNGAN', bagian: Array.from({ length: antara(1, 3) }, () => ({ tanda: pilih(['+', '-']), id_form: pilih([null, '', 'UJM2', 'UJM3', 'UJMX']), rumus: sederhana() })) }
      : sederhana();
    const indikator = Array.from({ length: 80 }, (_, i) => ({
      id_indikator: `d0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      id_form: pilih(FORM), satuan: pilih(['%', 'Persen', '‰ permil', 'menit', 'indeks']), unit_pelaksana: pilih([null, 'UJ A', 'UJ B', 'UJ D', 'UJ Z']),
      template_numerator: i === 0 ? 'bukan json' : JSON.stringify(rumus()),
      template_denominator: i === 1 ? null : JSON.stringify(rumus())
    }));

    const { dbRows, cek, beda, contoh } = await dalamTransaksi(async c => {
      await c.query(`insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input)
                     select unit_kerja, id_indikator, bulan, tahun, data_input from jsonb_to_recordset($1::jsonb)
                       as x(unit_kerja text, id_indikator text, bulan int, tahun int, data_input jsonb)`, [JSON.stringify(baris)]);
      await c.query(`insert into public.master_indikator (id_indikator, id_form, satuan, unit_pelaksana, template_numerator, template_denominator)
                     select id_indikator, id_form, satuan, unit_pelaksana, template_numerator, template_denominator from jsonb_to_recordset($1::jsonb)
                       as x(id_indikator uuid, id_form text, satuan text, unit_pelaksana text, template_numerator text, template_denominator text)`, [JSON.stringify(indikator)]);
      const r = await c.query(`select * from public.hitung_capaian_mutu(2031) where id_indikator = any($1::uuid[])`, [indikator.map(i => i.id_indikator)]);
      const idx = new Map(r.rows.map(s => [`${s.id_indikator}|${s.unit_kerja}|${s.bulan}`, s]));
      const angka = v => v === null ? null : Number(v);
      let cek = 0, beda = 0; const contoh = []; const kunciJs = new Set();
      for (const ind of indikator) {
        for (const x of E.hitungKelompokIndikator(ind, baris)) {
          cek++; const k = `${ind.id_indikator}|${x.unit_kerja}|${x.bulan}`; kunciJs.add(k); const s = idx.get(k);
          const sama = s && Number(s.jumlah_baris) === x.jumlah_baris
            && Math.abs(angka(s.numerator) - x.numerator) < 1e-9 && Math.abs(angka(s.denominator) - x.denominator) < 1e-9
            && (s.capaian === null ? x.capaian === null : Math.abs(angka(s.capaian) - x.capaian) < 1e-9);
          if (!sama) { beda++; if (contoh.length < 3) contoh.push({ k, js: x, db: s || null }); }
        }
      }
      for (const k of idx.keys()) if (!kunciJs.has(k)) { beda++; if (contoh.length < 3) contoh.push({ k, js: null, db: idx.get(k) }); }
      return { dbRows: r.rows.length, cek, beda, contoh };
    });
    if (!cek) throw new Error('Tidak ada hasil yang dibandingkan');
    hasil.push({ nama: `mesin rumus (${cek} kelompok indikator×unit×bulan, ${dbRows} baris database)`, ok: beda === 0, ms: Date.now() - mulai,
                 pesan: beda ? `${beda} hasil berbeda, contoh: ${JSON.stringify(contoh)}` : undefined });
  } catch (e) {
    hasil.push({ nama: 'mesin rumus', ok: false, ms: Date.now() - mulai, pesan: e.message });
  }
}

// ---------------------------------------------------------------------
for (const h of hasil) {
  console.log(`${h.ok ? 'LULUS' : 'GAGAL'}  ${h.nama}  (${h.ms} ms)`);
  if (!h.ok) console.log('       ' + h.pesan);
}
const gagal = hasil.filter(h => !h.ok).length;
console.log(`\n${hasil.length - gagal}/${hasil.length} uji lulus.`);
process.exit(gagal ? 1 : 0);
