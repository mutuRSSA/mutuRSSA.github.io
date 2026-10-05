-- =====================================================================
-- Migrasi: Waktu server untuk halaman Input Mutu
-- Tanggal : 2026-10-05
-- Syarat  : migrasi sampai 20261002090000 sudah dijalankan.
--
-- Input Mutu memilih bulan & tahun bawaan dari tanggal perangkat. Komputer
-- dengan tanggal/jam salah membuka periode yang salah, sehingga data yang
-- sudah tersimpan tampak kosong. waktu_server() dipakai untuk mendeteksi
-- selisih jam perangkat (> 12 jam) dan memakai tanggal server.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public.waktu_server()
returns timestamptz
language sql stable
set search_path = public
as $$ select now() $$;

revoke execute on function public.waktu_server() from public;
grant execute on function public.waktu_server() to anon, authenticated;

commit;
