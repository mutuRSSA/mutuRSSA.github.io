-- =====================================================================
-- Migrasi: status "role administrator" diatur dari database
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000_rls_per_role_unit.sql sudah dijalankan.
--
-- Sebelumnya daftar role admin ditulis di 3 tempat (config.js, Edge
-- Function, fungsi RLS). Sekarang cukup centang "Role administrator" di
-- Manajemen Akun > Panel Otorisasi; ketiganya membaca kolom
-- role_permissions.is_admin.
--
-- Pengaman: perubahan yang membuat TIDAK ADA LAGI role admin dengan akun
-- aktif akan ditolak database (mencegah semua orang terkunci).
-- =====================================================================

begin;

-- 1. Kolom penanda role admin
alter table public.role_permissions
  add column if not exists is_admin boolean not null default false;

update public.role_permissions
   set is_admin = true
 where role in ('Komite Mutu', 'Administrator Aplikasi');

-- 2. Fungsi RLS sekarang membaca kolom tersebut
create or replace function public.mutu_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select rp.is_admin
      from public.profiles p
      join public.role_permissions rp on rp.role = p.role
     where p.id = auth.uid() and p.status = 'Aktif'
     limit 1
  ), false)
$$;

-- 3. Pengaman: minimal satu role admin yang punya akun aktif
create or replace function public.jaga_minimal_satu_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1
      from public.role_permissions rp
      join public.profiles p on p.role = rp.role
     where rp.is_admin and p.status = 'Aktif'
  ) then
    raise exception 'Ditolak: minimal harus ada satu role administrator yang memiliki akun aktif.'
      using errcode = 'P0001';
  end if;
  return null;
end $$;

drop trigger if exists jaga_admin_role_permissions on public.role_permissions;
create trigger jaga_admin_role_permissions
  after update or delete on public.role_permissions
  for each statement execute function public.jaga_minimal_satu_admin();

drop trigger if exists jaga_admin_profiles on public.profiles;
create trigger jaga_admin_profiles
  after update or delete on public.profiles
  for each statement execute function public.jaga_minimal_satu_admin();

commit;

-- Cek:
-- select role, is_admin from public.role_permissions order by is_admin desc, role;
