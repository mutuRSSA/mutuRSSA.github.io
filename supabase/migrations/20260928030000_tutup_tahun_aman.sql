-- =====================================================================
-- Migrasi: Tutup Tahun yang aman
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 2026092800..., 2026092801..., 2026092802... sudah jalan.
-- Aman dijalankan ulang (idempoten).
--
-- Masalah sebelumnya (database_admin.html):
--   * Ringkasan dihitung dari maksimal 1.000 baris (batas API Supabase),
--     tetapi DELETE menghapus SEMUA baris tahun itu -> data hilang permanen.
--   * Simpan arsip & hapus data mentah = 2 request terpisah (tidak atomik).
--   * Bisa dijalankan 2x -> arsip dobel.
--
-- Sekarang:
--   * Satu fungsi database `tutup_tahun_mutu` menjalankan semuanya dalam
--     SATU TRANSAKSI: gagal di tengah = tidak ada yang berubah.
--   * Menolak jika jumlah baris yang dihitung browser berbeda dengan isi
--     database (mencegah ringkasan dari data terpotong / data baru masuk).
--   * Menolak jika tahun tersebut sudah pernah ditutup.
--   * Ringkasan dibuat PER UNIT (kolom unit_pelaksana = unit pelapor),
--     dihitung dengan mesin rumus yang sama dengan laporan (engine_mutu.js).
--   * Data mentah TIDAK dihapus permanen, tetapi dipindah ke
--     `data_mutu_harian_arsip` (bisa dipulihkan / dihitung ulang).
-- =====================================================================

begin;

-- 1. Tabel penyimpanan dingin untuk data mentah yang sudah ditutup
create table if not exists public.data_mutu_harian_arsip
  (like public.data_mutu_harian including defaults);

alter table public.data_mutu_harian_arsip
  add column if not exists diarsipkan_pada timestamptz not null default now(),
  add column if not exists diarsipkan_oleh uuid;

create index if not exists data_mutu_harian_arsip_tahun_idx
  on public.data_mutu_harian_arsip (tahun);

alter table public.data_mutu_harian_arsip enable row level security;
revoke all on public.data_mutu_harian_arsip from anon, authenticated;
grant select on public.data_mutu_harian_arsip to authenticated;  -- dibatasi lagi oleh RLS (admin saja)

drop policy if exists mutu_harian_arsip_select_admin on public.data_mutu_harian_arsip;
create policy mutu_harian_arsip_select_admin on public.data_mutu_harian_arsip
  for select to authenticated using (public.mutu_is_admin());
-- Tidak ada policy tulis: hanya fungsi di bawah (security definer) yang mengisi.

-- 1b. Arsip capaian: satu baris per INDIKATOR x UNIT x BULAN.
--     Capaian boleh kosong (bulan dengan denominator 0).
alter table public.arsip_capaian_mutu alter column capaian drop not null;
alter table public.arsip_capaian_mutu alter column is_tercapai drop not null;
comment on column public.arsip_capaian_mutu.unit_pelaksana is
  'Unit yang melaporkan data (unit_kerja). Sejak 2026-09-28 arsip dibuat per unit.';
create index if not exists arsip_capaian_mutu_tahun_bulan_idx
  on public.arsip_capaian_mutu (tahun, bulan);

-- 2. Fungsi Tutup Tahun (atomik)
create or replace function public.tutup_tahun_mutu(
  p_tahun int,
  p_jumlah_baris int,
  p_ringkasan jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jumlah_db   int;
  v_arsip_masuk int;
  v_dipindah    int;
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya role administrator yang dapat menjalankan Tutup Tahun.';
  end if;

  if p_tahun is null or p_tahun >= extract(year from now() at time zone 'Asia/Jakarta')::int then
    raise exception 'Tutup Tahun hanya untuk tahun yang sudah berakhir.';
  end if;

  if jsonb_typeof(p_ringkasan) is distinct from 'array' then
    raise exception 'Format ringkasan tidak valid.';
  end if;

  -- Kunci tabel: tidak boleh ada input baru selama proses berlangsung
  lock table public.data_mutu_harian in share row exclusive mode;

  select count(*) into v_jumlah_db from public.data_mutu_harian where tahun = p_tahun;

  if v_jumlah_db = 0 then
    raise exception 'Tidak ada data mentah untuk tahun %.', p_tahun;
  end if;

  if v_jumlah_db <> p_jumlah_baris then
    raise exception 'Jumlah data tidak cocok: aplikasi menghitung % baris, database berisi % baris. Proses dibatalkan, tidak ada data yang berubah. Muat ulang halaman lalu coba lagi.',
      p_jumlah_baris, v_jumlah_db;
  end if;

  if exists (select 1 from public.arsip_capaian_mutu where tahun = p_tahun) then
    raise exception 'Tahun % sudah pernah ditutup (arsip capaian sudah ada).', p_tahun;
  end if;

  -- a. Simpan ringkasan capaian
  insert into public.arsip_capaian_mutu
    (tahun, bulan, id_indikator, judul_indikator, kategori_indikator, unit_pelaksana,
     numerator, denominator, capaian, target, satuan, is_tercapai)
  select tahun, bulan, id_indikator, judul_indikator, kategori_indikator, unit_pelaksana,
         numerator, denominator, capaian, target, satuan, is_tercapai
    from jsonb_populate_recordset(null::public.arsip_capaian_mutu, p_ringkasan);
  get diagnostics v_arsip_masuk = row_count;

  -- b. Pindahkan data mentah ke penyimpanan dingin, lalu hapus dari tabel aktif
  insert into public.data_mutu_harian_arsip
  select d.*, now(), auth.uid()
    from public.data_mutu_harian d
   where d.tahun = p_tahun;
  get diagnostics v_dipindah = row_count;

  delete from public.data_mutu_harian where tahun = p_tahun;

  return jsonb_build_object(
    'tahun', p_tahun,
    'ringkasan_disimpan', v_arsip_masuk,
    'data_mentah_dipindah', v_dipindah
  );
end $$;

revoke execute on function public.tutup_tahun_mutu(int, int, jsonb) from public, anon;
grant  execute on function public.tutup_tahun_mutu(int, int, jsonb) to authenticated;

commit;

-- =====================================================================
-- PEMULIHAN (jika perlu membatalkan Tutup Tahun untuk tahun tertentu)
-- Ganti 2025 dengan tahun yang dimaksud, jalankan di SQL Editor.
-- =====================================================================
-- begin;
-- insert into public.data_mutu_harian
-- select id, created_at, unit_kerja, id_indikator, bulan, tahun, petugas_input, data_input
--   from public.data_mutu_harian_arsip where tahun = 2025;
-- delete from public.data_mutu_harian_arsip where tahun = 2025;
-- delete from public.arsip_capaian_mutu where tahun = 2025;
-- commit;
