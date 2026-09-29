# Uji otomatis SIM-PMKP

Menguji aturan yang dijaga database dan kesamaan hasil mesin rumus:

| Berkas | Yang diuji |
|---|---|
| `sql/01_kunci_periode.sql` | Data bulan terkunci tidak bisa diisi/diubah/dihapus unit; hanya Komite yang bisa membuka kunci; unit tidak bisa mengisi data unit lain. |
| `sql/02_validasi.sql` | Besar sampel Slovin, sampel tersimpan & tidak diacak ulang, akurasi ≥ 90% = VALID, sesi selesai terkunci, TIDAK VALID wajib analisis. |
| `sql/03_risiko.sql` | Risiko Rendah langsung aktif, Moderat+ wajib tindakan (PIC & tenggat) sebelum diajukan, verifikasi/revisi/tutup oleh Komite, profil RS hanya Tinggi/Ekstrem, pemisahan data antar unit. |
| `sql/04_insiden.sql` | Grading dihitung ulang dari matriks (Sentinel = Merah), alur Baru → Investigasi → Tindak Lanjut → Selesai, wajib RCA, batas 45 hari, penutupan otomatis, hak baca unit. |
| `sql/05_versi_rumus.sql` | Perubahan rumus/target "berlaku mulai" tidak mengubah bulan sebelumnya; koreksi berlaku untuk semua bulan. |
| `sql/06_survei_budaya.sql` | Survei hanya diterima saat periode dibuka, hanya satu periode dibuka, unit wajib dari daftar. |
| `sql/07_laporan.sql` | Laporan periodik: draf → diajukan → disetujui, versi naik saat kompilasi ulang, isi terkunci saat diajukan/disetujui, disposisi wajib, riwayat, umpan balik unit hanya terbaca unitnya sendiri setelah disetujui. |
| mesin rumus | `hitung_capaian_mutu()` (database) dibandingkan dengan `engine_mutu.js` pada ±1.000 kelompok data & rumus acak (COUNTALL, COUNTIF, SUM, KONSTAN, syarat bertingkat, GABUNGAN, isian kosong/aneh). |

Setiap uji berjalan di dalam **satu transaksi yang selalu di-ROLLBACK**: pengguna, unit, indikator, dan data uji dibuat lalu dibuang lagi. Tidak ada yang tersimpan.

## Menjalankan

Perlu Node.js 18+.

```bash
cd tests
npm install
```

Lalu arahkan ke database yang **sudah menjalankan semua migrasi** di `supabase/migrations`:

**Pilihan 1 – proyek Supabase staging / salinan (disarankan).**
Ambil connection string di Supabase Dashboard → Project Settings → Database → *Connection string* (URI, Session pooler).

```bash
# PowerShell
$env:DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
$env:IZINKAN_DB_LUAR="1"
npm test
```

**Pilihan 2 – Supabase lokal** (`supabase start`, butuh Docker). Bawaan runner adalah
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, jadi cukup `npm test` setelah skema & migrasi dimuat ke database lokal.

Menjalankan sebagian saja: `node jalankan.mjs 03 04` atau `node jalankan.mjs mesin`.

Runner menolak database di luar komputer ini kecuali `IZINKAN_DB_LUAR=1`. Walaupun semua uji di-rollback, sebaiknya tidak dijalankan ke database produksi pada jam sibuk.

## Hasil

```
LULUS  01_kunci_periode.sql  (261 ms)
...
LULUS  mesin rumus (1044 kelompok indikator×unit×bulan, 1044 baris database)
7/7 uji lulus.
```

Kode keluar 1 bila ada yang gagal, beserta pesan `GAGAL: ...` yang menjelaskan aturan mana yang dilanggar.

## Menambah uji

Buat berkas `sql/NN_nama.sql`. Alat bantu dari `sql/00_persiapan.sql`:

- `select pg_temp.sebagai('komite' | 'petugas' | 'petugas2' | 'sistem');` – bertindak sebagai Komite Mutu, petugas UNIT UJI A, petugas UNIT UJI B, atau SQL Editor.
- `select pg_temp.cek(<kondisi>, 'pesan');`
- `select pg_temp.harus_gagal($q$<perintah>$q$, '<pola pesan galat>', 'pesan');`
