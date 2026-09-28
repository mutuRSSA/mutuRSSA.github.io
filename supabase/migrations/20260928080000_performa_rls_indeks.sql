-- =====================================================================
-- Migrasi: Performa RLS & indeks
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928070000 sudah dijalankan.
--
-- Masalah: setelah impor ±50 ribu baris, Laporan Mutu gagal dengan
--   "canceling statement due to statement timeout" (kode 57014).
-- Penyebab:
--   1. Policy RLS memanggil fungsi (mutu_boleh_unit, mutu_role, ...) UNTUK
--      SETIAP BARIS. Fungsi SECURITY DEFINER tidak bisa di-inline oleh
--      Postgres, jadi tiap baris = beberapa query ke tabel profiles.
--   2. Belum ada indeks untuk filter tahun/bulan/unit.
-- Perbaikan:
--   1. Policy ditulis ulang dengan pola "(select fungsi())": Postgres
--      menghitungnya SEKALI per query (InitPlan), lalu tiap baris cukup
--      dibandingkan dengan hasilnya. Aturan akses TIDAK berubah.
--   2. Indeks untuk kolom yang dipakai filter & RLS.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. INDEKS
-- ---------------------------------------------------------------------
create index if not exists data_mutu_harian_tahun_bulan_idx on public.data_mutu_harian (tahun, bulan, id);
create index if not exists data_mutu_harian_unit_idx        on public.data_mutu_harian (unit_kerja, id_indikator, tahun, bulan);
create index if not exists data_mutu_harian_indikator_idx   on public.data_mutu_harian (id_indikator, tahun, bulan);
create index if not exists arsip_capaian_mutu_unit_idx      on public.arsip_capaian_mutu (unit_pelaksana, tahun, bulan);
create index if not exists data_insiden_unit_idx            on public.data_insiden (unit_pelapor);
create index if not exists data_insiden_waktu_idx           on public.data_insiden (waktu_insiden);
create index if not exists data_insiden_lapor_idx           on public.data_insiden (waktu_lapor);
create index if not exists data_risiko_unit_idx             on public.data_risiko (unit_kerja, tahun);
create index if not exists data_pdsa_unit_idx               on public.data_pdsa (unit_kerja);
create index if not exists data_validasi_unit_idx           on public.data_validasi (unit_kerja, tahun);
create index if not exists profiles_role_idx                on public.profiles (role);

-- ---------------------------------------------------------------------
-- 2. POLICY: fungsi dievaluasi sekali per query
--    Pola:  (select public.mutu_is_admin())  -> konstanta per query
--           unit_kerja = (select public.mutu_unit())
--    mutu_unit()/mutu_role() mengembalikan NULL untuk akun tidak aktif
--    atau wajib ganti password, sehingga perbandingan otomatis gagal.
-- ---------------------------------------------------------------------

-- Data master
drop policy if exists master_unit_select on public.master_unit;
create policy master_unit_select on public.master_unit
  for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists master_unit_tulis_admin on public.master_unit;
create policy master_unit_tulis_admin on public.master_unit
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists master_indikator_select on public.master_indikator;
create policy master_indikator_select on public.master_indikator
  for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists master_indikator_tulis_admin on public.master_indikator;
create policy master_indikator_tulis_admin on public.master_indikator
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists setup_formulir_select on public.setup_formulir;
create policy setup_formulir_select on public.setup_formulir
  for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists setup_formulir_tulis_admin on public.setup_formulir;
create policy setup_formulir_tulis_admin on public.setup_formulir
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists role_permissions_tulis_admin on public.role_permissions;
create policy role_permissions_tulis_admin on public.role_permissions
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated using ((select public.mutu_is_admin()));

-- Data mutu harian
drop policy if exists mutu_harian_select on public.data_mutu_harian;
create policy mutu_harian_select on public.data_mutu_harian
  for select to authenticated using (
    (select public.mutu_is_admin())
    or (select public.mutu_role()) = 'Admin PPI'
    or unit_kerja = (select public.mutu_unit())
  );
drop policy if exists mutu_harian_insert on public.data_mutu_harian;
create policy mutu_harian_insert on public.data_mutu_harian
  for insert to authenticated with check (
    (select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
drop policy if exists mutu_harian_update on public.data_mutu_harian;
create policy mutu_harian_update on public.data_mutu_harian
  for update to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()))
  with check ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
drop policy if exists mutu_harian_delete on public.data_mutu_harian;
create policy mutu_harian_delete on public.data_mutu_harian
  for delete to authenticated using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));

-- Arsip capaian & cadangan data mentah
drop policy if exists arsip_select on public.arsip_capaian_mutu;
create policy arsip_select on public.arsip_capaian_mutu
  for select to authenticated using (
    (select public.mutu_is_admin())
    or (select public.mutu_role()) = 'Admin PPI'
    or unit_pelaksana = (select public.mutu_unit())
  );
drop policy if exists arsip_tulis_admin on public.arsip_capaian_mutu;
create policy arsip_tulis_admin on public.arsip_capaian_mutu
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists mutu_harian_arsip_select_admin on public.data_mutu_harian_arsip;
create policy mutu_harian_arsip_select_admin on public.data_mutu_harian_arsip
  for select to authenticated using ((select public.mutu_is_admin()));

-- PDSA & risiko
drop policy if exists pdsa_per_unit on public.data_pdsa;
create policy pdsa_per_unit on public.data_pdsa
  for all to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()))
  with check ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));

drop policy if exists risiko_per_unit on public.data_risiko;
create policy risiko_per_unit on public.data_risiko
  for all to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()))
  with check ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));

-- Validasi
drop policy if exists validasi_select on public.data_validasi;
create policy validasi_select on public.data_validasi
  for select to authenticated using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
drop policy if exists validasi_tulis_admin on public.data_validasi;
create policy validasi_tulis_admin on public.data_validasi
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

-- Insiden (kirim laporan lewat fungsi lapor_insiden)
drop policy if exists insiden_select on public.data_insiden;
create policy insiden_select on public.data_insiden
  for select to authenticated using ((select public.mutu_is_admin()) or unit_pelapor = (select public.mutu_unit()));
drop policy if exists insiden_update on public.data_insiden;
create policy insiden_update on public.data_insiden
  for update to authenticated
  using ((select public.mutu_is_admin()) or unit_pelapor = (select public.mutu_unit()))
  with check ((select public.mutu_is_admin()) or unit_pelapor = (select public.mutu_unit()));
drop policy if exists insiden_delete_admin on public.data_insiden;
create policy insiden_delete_admin on public.data_insiden
  for delete to authenticated using ((select public.mutu_is_admin()));

-- Survei & FMEA
drop policy if exists survey_select_admin on public.data_survey_budaya;
create policy survey_select_admin on public.data_survey_budaya
  for select to authenticated using ((select public.mutu_is_admin()));
drop policy if exists survey_hapus_admin on public.data_survey_budaya;
create policy survey_hapus_admin on public.data_survey_budaya
  for delete to authenticated using ((select public.mutu_is_admin()));

drop policy if exists fmea_select on public.data_fmea;
create policy fmea_select on public.data_fmea
  for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists fmea_tulis_admin on public.data_fmea;
create policy fmea_tulis_admin on public.data_fmea
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

-- Log audit
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ((select public.mutu_is_admin()));

analyze public.data_mutu_harian;
analyze public.data_insiden;
analyze public.arsip_capaian_mutu;

commit;
