-- Kunci periode: data bulan terkunci tidak bisa diubah unit; admin bisa membuka kunci.
select pg_temp.sebagai('komite');
insert into public.kunci_periode_mutu (tahun, bulan, unit_kerja) values (2031, 1, 'UNIT UJI A');

select pg_temp.sebagai('petugas');
select pg_temp.harus_gagal(
  $q$insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input) values ('UNIT UJI A', 'UJI_FORM', 1, 2031, '["Ya"]')$q$,
  'dikunci', 'Input ke bulan terkunci harus ditolak');
insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input) values ('UNIT UJI A', 'UJI_FORM', 2, 2031, '["Ya"]');
select pg_temp.harus_gagal(
  $q$insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input) values ('UNIT UJI B', 'UJI_FORM', 2, 2031, '["Ya"]')$q$,
  'row-level security', 'Unit tidak boleh mengisi data unit lain');
-- Unit tidak bisa membuka kunci (RLS: baris tidak terhapus)
delete from public.kunci_periode_mutu where tahun = 2031;

select pg_temp.sebagai('komite');
select pg_temp.cek((select count(*) from public.kunci_periode_mutu where tahun = 2031) = 1, 'Kunci tidak boleh terhapus oleh unit');
select pg_temp.cek((select dikunci_nama from public.kunci_periode_mutu where tahun = 2031) = 'Komite Uji', 'Nama pengunci terisi otomatis');
-- Data bulan 2 dikunci setelah diisi -> ubah/hapus ditolak
insert into public.kunci_periode_mutu (tahun, bulan, unit_kerja) values (2031, 2, null);
select pg_temp.sebagai('petugas');
select pg_temp.harus_gagal($q$update public.data_mutu_harian set data_input = '["Tidak"]' where tahun = 2031 and bulan = 2$q$, 'dikunci', 'Ubah data bulan terkunci');
select pg_temp.harus_gagal($q$delete from public.data_mutu_harian where tahun = 2031 and bulan = 2$q$, 'dikunci', 'Hapus data bulan terkunci');

select pg_temp.sebagai('komite');
delete from public.kunci_periode_mutu where tahun = 2031;
select pg_temp.sebagai('petugas');
insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input) values ('UNIT UJI A', 'UJI_FORM', 1, 2031, '["Ya"]');
select pg_temp.cek((select count(*) from public.data_mutu_harian where tahun = 2031) = 2, 'Input berhasil setelah kunci dibuka');
