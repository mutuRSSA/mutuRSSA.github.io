-- =====================================================================
-- Migrasi: "wajib ganti password"
-- Tanggal : 2026-09-28
-- Syarat  : 20260928000000_rls_per_role_unit.sql dan
--           20260928010000_role_admin_dinamis.sql sudah dijalankan.
--
-- Akun yang passwordnya di-reset ke password default ditandai
-- wajib_ganti_password = true. Selama tanda itu aktif:
--   * aplikasi hanya menampilkan halaman ganti_password.html;
--   * di DATABASE, akun diperlakukan seperti tidak aktif: tidak bisa
--     membaca/mengubah data apa pun (hanya profil miliknya sendiri).
-- Tanda dihapus otomatis oleh Edge Function admin-manage-users setelah
-- pengguna berhasil membuat password baru.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists wajib_ganti_password boolean not null default false;

-- Semua fungsi bantu RLS sekarang mensyaratkan: Aktif DAN tidak wajib ganti password
create or replace function public.mutu_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles
   where id = auth.uid() and status = 'Aktif' and not wajib_ganti_password
$$;

create or replace function public.mutu_unit()
returns text language sql stable security definer set search_path = public as $$
  select unit_kerja from public.profiles
   where id = auth.uid() and status = 'Aktif' and not wajib_ganti_password
$$;

create or replace function public.mutu_aktif()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'Aktif' and not wajib_ganti_password
  )
$$;

create or replace function public.mutu_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select rp.is_admin
      from public.profiles p
      join public.role_permissions rp on rp.role = p.role
     where p.id = auth.uid() and p.status = 'Aktif' and not p.wajib_ganti_password
     limit 1
  ), false)
$$;

commit;

-- Cek akun yang masih wajib ganti password:
-- select email, nama_lengkap, unit_kerja from public.profiles
--  where wajib_ganti_password order by nama_lengkap;
