-- =====================================================================
-- Migrasi: rapikan nama halaman di hak akses RBAC
-- Tanggal : 2026-09-28
--
-- * analisa_rca.html (salah ketik, file tidak ada) -> analisis_rca.html
-- * daftar_kpc.html dihapus (KPC sudah digabung ke daftar_insiden.html)
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

update public.role_permissions
   set allowed_pages = (
     select string_agg(distinct halaman, ',' order by halaman)
       from unnest(string_to_array(
              replace(coalesce(allowed_pages, ''), 'analisa_rca.html', 'analisis_rca.html'), ','
            )) as h(halaman_mentah),
            lateral (select trim(halaman_mentah) as halaman) t
      where halaman <> '' and halaman <> 'daftar_kpc.html'
   )
 where allowed_pages like '%analisa_rca.html%'
    or allowed_pages like '%daftar_kpc.html%';

commit;

-- Cek:
-- select role, allowed_pages from public.role_permissions order by role;
