-- =====================================================================
-- Migrasi RLS: akses data per ROLE dan per UNIT KERJA
-- Tanggal : 2026-09-28
--
-- Kebijakan (disepakati Komite Mutu):
--   * Admin = 'Komite Mutu' + 'Administrator Aplikasi'
--       -> baca & tulis semua data, kelola master (unit/indikator/formulir).
--   * Staf unit ('Kepala Unit', 'Petugas Input', dst.)
--       -> data mutu, PDSA, risiko: hanya baca & tulis UNIT SENDIRI.
--       -> insiden: semua staf boleh MELAPOR; hanya boleh MEMBACA laporan
--          dari unitnya sendiri (unit_pelapor). Hapus = admin saja.
--       -> validasi mutu: hanya baca hasil unit sendiri; input oleh admin.
--   * 'Admin PPI' -> seperti staf unit + boleh MEMBACA seluruh data mutu
--                    (untuk dasbor surveilans PPI).
--   * Survei budaya: semua staf boleh mengisi; hasil hanya dibaca admin
--     (menjaga anonimitas responden).
--   * FMEA: semua staf boleh membaca; tulis oleh admin.
--   * Akun berstatus 'Nonaktif' langsung kehilangan akses ke SEMUA data,
--     walaupun token login lamanya belum kedaluwarsa.
--
-- Cara pakai : jalankan seluruh file ini di Supabase SQL Editor.
--              Dibungkus transaksi: jika ada satu error, tidak ada yang berubah.
-- Rollback   : lihat blok di paling bawah file.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. FUNGSI BANTU
--    SECURITY DEFINER supaya bisa membaca profiles tanpa terhalang RLS
--    profiles sendiri (menghindari rekursi policy).
-- ---------------------------------------------------------------------
create or replace function public.mutu_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'Aktif'
$$;

create or replace function public.mutu_unit()
returns text language sql stable security definer set search_path = public as $$
  select unit_kerja from public.profiles where id = auth.uid() and status = 'Aktif'
$$;

create or replace function public.mutu_aktif()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'Aktif')
$$;

create or replace function public.mutu_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mutu_role() in ('Komite Mutu', 'Administrator Aplikasi'), false)
$$;

-- Boleh akses baris milik `unit`? (admin: semua; staf: unit sendiri)
create or replace function public.mutu_boleh_unit(unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mutu_is_admin()
      or (public.mutu_aktif() and unit is not null and unit = public.mutu_unit())
$$;

revoke execute on function public.mutu_role(), public.mutu_unit(), public.mutu_aktif(),
                           public.mutu_is_admin(), public.mutu_boleh_unit(text) from public, anon;
grant  execute on function public.mutu_role(), public.mutu_unit(), public.mutu_aktif(),
                           public.mutu_is_admin(), public.mutu_boleh_unit(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. BERSIHKAN POLICY LAMA (yang serba `true` / masih merujuk 'Super Admin')
-- ---------------------------------------------------------------------
drop policy if exists require_login_data_fmea            on public.data_fmea;
drop policy if exists require_login_data_insiden         on public.data_insiden;
drop policy if exists require_login_data_mutu_harian     on public.data_mutu_harian;
drop policy if exists require_login_data_pdsa            on public.data_pdsa;
drop policy if exists require_login_data_risiko          on public.data_risiko;
drop policy if exists require_login_data_survey_budaya   on public.data_survey_budaya;
drop policy if exists require_login_data_validasi        on public.data_validasi;
drop policy if exists require_login_master_indikator     on public.master_indikator;
drop policy if exists require_login_master_unit          on public.master_unit;
drop policy if exists require_login_setup_formulir       on public.setup_formulir;
drop policy if exists profiles_select_admin              on public.profiles;
drop policy if exists role_permissions_select_authenticated on public.role_permissions;
drop policy if exists role_permissions_insert_admin      on public.role_permissions;
drop policy if exists role_permissions_update_admin      on public.role_permissions;
drop policy if exists role_permissions_delete_admin      on public.role_permissions;
-- profiles_select_own dipertahankan.

-- Pastikan RLS aktif di semua tabel aplikasi
alter table public.arsip_capaian_mutu  enable row level security;
alter table public.data_fmea           enable row level security;
alter table public.data_insiden        enable row level security;
alter table public.data_mutu_harian    enable row level security;
alter table public.data_pdsa           enable row level security;
alter table public.data_risiko         enable row level security;
alter table public.data_survey_budaya  enable row level security;
alter table public.data_validasi       enable row level security;
alter table public.master_indikator    enable row level security;
alter table public.master_unit         enable row level security;
alter table public.setup_formulir      enable row level security;
alter table public.profiles            enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.users               enable row level security; -- tabel lama, sengaja tanpa policy

-- ---------------------------------------------------------------------
-- 3. AKUN & HAK AKSES
-- ---------------------------------------------------------------------
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.mutu_is_admin());
-- Tulis ke profiles hanya lewat Edge Function admin-manage-users (service role).

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);  -- dibutuhkan saat login untuk membaca menu
create policy role_permissions_tulis_admin on public.role_permissions
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

-- ---------------------------------------------------------------------
-- 4. DATA MASTER: semua staf aktif membaca, admin menulis
-- ---------------------------------------------------------------------
create policy master_unit_select on public.master_unit
  for select to authenticated using (public.mutu_aktif());
create policy master_unit_tulis_admin on public.master_unit
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

create policy master_indikator_select on public.master_indikator
  for select to authenticated using (public.mutu_aktif());
create policy master_indikator_tulis_admin on public.master_indikator
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

create policy setup_formulir_select on public.setup_formulir
  for select to authenticated using (public.mutu_aktif());
create policy setup_formulir_tulis_admin on public.setup_formulir
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

-- ---------------------------------------------------------------------
-- 5. DATA MUTU HARIAN: per unit (+ Admin PPI membaca semua)
-- ---------------------------------------------------------------------
create policy mutu_harian_select on public.data_mutu_harian
  for select to authenticated using (
    public.mutu_boleh_unit(unit_kerja) or public.mutu_role() = 'Admin PPI'
  );
create policy mutu_harian_insert on public.data_mutu_harian
  for insert to authenticated with check (public.mutu_boleh_unit(unit_kerja));
create policy mutu_harian_update on public.data_mutu_harian
  for update to authenticated
  using (public.mutu_boleh_unit(unit_kerja)) with check (public.mutu_boleh_unit(unit_kerja));
create policy mutu_harian_delete on public.data_mutu_harian
  for delete to authenticated using (public.mutu_boleh_unit(unit_kerja));

-- Arsip capaian (hasil "freeze" tahunan): baca per unit, tulis admin
create policy arsip_select on public.arsip_capaian_mutu
  for select to authenticated using (
    public.mutu_boleh_unit(unit_pelaksana) or public.mutu_role() = 'Admin PPI'
  );
create policy arsip_tulis_admin on public.arsip_capaian_mutu
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

-- ---------------------------------------------------------------------
-- 6. PDSA & RISIKO: penuh per unit
-- ---------------------------------------------------------------------
create policy pdsa_per_unit on public.data_pdsa
  for all to authenticated
  using (public.mutu_boleh_unit(unit_kerja)) with check (public.mutu_boleh_unit(unit_kerja));

create policy risiko_per_unit on public.data_risiko
  for all to authenticated
  using (public.mutu_boleh_unit(unit_kerja)) with check (public.mutu_boleh_unit(unit_kerja));

-- ---------------------------------------------------------------------
-- 7. VALIDASI MUTU: unit membaca hasilnya sendiri, admin yang menginput
-- ---------------------------------------------------------------------
create policy validasi_select on public.data_validasi
  for select to authenticated using (public.mutu_boleh_unit(unit_kerja));
create policy validasi_tulis_admin on public.data_validasi
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

-- ---------------------------------------------------------------------
-- 8. INSIDEN (berisi nama pasien & No. RM)
-- ---------------------------------------------------------------------
create policy insiden_insert on public.data_insiden
  for insert to authenticated with check (public.mutu_aktif());          -- semua staf boleh melapor
create policy insiden_select on public.data_insiden
  for select to authenticated using (public.mutu_boleh_unit(unit_pelapor));
create policy insiden_update on public.data_insiden
  for update to authenticated                                            -- investigasi sederhana oleh unit / komite
  using (public.mutu_boleh_unit(unit_pelapor)) with check (public.mutu_boleh_unit(unit_pelapor));
create policy insiden_delete_admin on public.data_insiden
  for delete to authenticated using (public.mutu_is_admin());

-- ---------------------------------------------------------------------
-- 9. SURVEI BUDAYA & FMEA
-- ---------------------------------------------------------------------
create policy survey_insert on public.data_survey_budaya
  for insert to authenticated with check (public.mutu_aktif());
create policy survey_select_admin on public.data_survey_budaya
  for select to authenticated using (public.mutu_is_admin());
create policy survey_hapus_admin on public.data_survey_budaya
  for delete to authenticated using (public.mutu_is_admin());

create policy fmea_select on public.data_fmea
  for select to authenticated using (public.mutu_aktif());
create policy fmea_tulis_admin on public.data_fmea
  for all to authenticated using (public.mutu_is_admin()) with check (public.mutu_is_admin());

commit;

-- =====================================================================
-- CEK HASIL (jalankan terpisah setelah migrasi)
-- =====================================================================
-- select tablename, policyname, cmd from pg_policies
-- where schemaname = 'public' order by tablename, policyname;

-- =====================================================================
-- ROLLBACK DARURAT (kembali ke "semua user login boleh semua")
-- Jalankan HANYA jika aplikasi bermasalah setelah migrasi di atas.
-- =====================================================================
-- begin;
-- do $$
-- declare r record;
-- begin
--   for r in select tablename, policyname from pg_policies
--            where schemaname = 'public'
--              and tablename in ('arsip_capaian_mutu','data_fmea','data_insiden','data_mutu_harian',
--                                'data_pdsa','data_risiko','data_survey_budaya','data_validasi',
--                                'master_indikator','master_unit','setup_formulir')
--   loop
--     execute format('drop policy %I on public.%I', r.policyname, r.tablename);
--   end loop;
--   for r in select unnest(array['arsip_capaian_mutu','data_fmea','data_insiden','data_mutu_harian',
--                                'data_pdsa','data_risiko','data_survey_budaya','data_validasi',
--                                'master_indikator','master_unit','setup_formulir']) as t
--   loop
--     execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)',
--                    'require_login_' || r.t, r.t);
--   end loop;
-- end $$;
-- commit;
