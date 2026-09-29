-- Alur manajemen risiko: draf -> diajukan -> aktif; syarat tindakan; profil RS.
create temp table skala as
select (select array[d, p] from generate_series(1, 5) d, generate_series(1, 5) p where public.mutu_tingkat_risiko(d, p) = 'Rendah'  order by d * p limit 1) as rendah,
       (select array[d, p] from generate_series(1, 5) d, generate_series(1, 5) p where public.mutu_tingkat_risiko(d, p) = 'Moderat' order by d * p limit 1) as moderat,
       (select array[d, p] from generate_series(1, 5) d, generate_series(1, 5) p where public.mutu_tingkat_risiko(d, p) = 'Ekstrem' order by d * p limit 1) as ekstrem;
grant select on skala to authenticated;

select pg_temp.sebagai('petugas');
-- Rendah: diajukan langsung aktif
insert into public.data_risiko (id_risiko, unit_kerja, tahun, risiko_teridentifikasi, kategori_risiko, dampak, frekuensi, status)
select 'UJI-R1', 'UNIT UJI A', 2031, 'Risiko rendah uji', 'A', rendah[1], rendah[2], 'diajukan' from skala;
select pg_temp.cek((select status from public.data_risiko where id_risiko = 'UJI-R1') = 'aktif', 'Risiko Rendah langsung aktif');
select pg_temp.cek((select review_berikutnya from public.data_risiko where id_risiko = 'UJI-R1') is not null, 'Jadwal review terisi');

-- Unit tidak boleh langsung mengaktifkan risiko
select pg_temp.harus_gagal($q$insert into public.data_risiko (id_risiko, unit_kerja, tahun, risiko_teridentifikasi, kategori_risiko, dampak, frekuensi, status)
  select 'UJI-R2', 'UNIT UJI A', 2031, 'x', 'A', moderat[1], moderat[2], 'aktif' from skala$q$, 'draf atau mengajukan', 'Unit tidak boleh set aktif');

-- Moderat tanpa tindakan tidak bisa diajukan
insert into public.data_risiko (id_risiko, unit_kerja, tahun, risiko_teridentifikasi, kategori_risiko, dampak, frekuensi, status)
select 'UJI-R2', 'UNIT UJI A', 2031, 'Risiko moderat uji', 'A', moderat[1], moderat[2], 'draft' from skala;
select pg_temp.harus_gagal($q$update public.data_risiko set status = 'diajukan' where id_risiko = 'UJI-R2'$q$, 'rencana tindakan', 'Moderat wajib punya tindakan');
insert into public.risiko_tindakan (id_risiko, tindakan, pic, tenggat) values ('UJI-R2', 'Tindakan uji', 'Ka Unit', date '2031-06-30');
update public.data_risiko set status = 'diajukan' where id_risiko = 'UJI-R2';
select pg_temp.cek((select status from public.data_risiko where id_risiko = 'UJI-R2') = 'diajukan', 'Moderat menunggu verifikasi');
select pg_temp.harus_gagal($q$update public.data_risiko set risiko_teridentifikasi = 'ubah' where id_risiko = 'UJI-R2'$q$, 'tidak dapat diubah', 'Risiko diajukan terkunci bagi unit');

-- Komite: revisi wajib catatan, lalu verifikasi
select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$update public.data_risiko set status = 'revisi' where id_risiko = 'UJI-R2'$q$, 'Catatan revisi', 'Revisi wajib catatan');
update public.data_risiko set status = 'aktif' where id_risiko = 'UJI-R2';
select pg_temp.cek((select diverifikasi_oleh from public.data_risiko where id_risiko = 'UJI-R2') = 'Komite Uji', 'Verifikator tercatat');
select pg_temp.harus_gagal($q$update public.data_risiko set status = 'ditutup' where id_risiko = 'UJI-R2'$q$, 'Alasan penutupan', 'Tutup wajib alasan');

-- Profil RS hanya Tinggi/Ekstrem aktif
select pg_temp.harus_gagal($q$insert into public.profil_risiko_item (tahun, id_risiko) values (2031, 'UJI-R2')$q$, 'Tinggi atau Ekstrem', 'Profil menolak risiko Moderat');
insert into public.data_risiko (id_risiko, unit_kerja, tahun, risiko_teridentifikasi, kategori_risiko, dampak, frekuensi, status)
select 'UJI-R3', 'UNIT UJI A', 2031, 'Risiko ekstrem uji', 'B', ekstrem[1], ekstrem[2], 'aktif' from skala;
insert into public.profil_risiko_item (tahun, id_risiko) values (2031, 'UJI-R3');
select pg_temp.cek((select is_profil_rs from public.data_risiko where id_risiko = 'UJI-R3'), 'Tanda profil RS tersinkron');
select pg_temp.cek((select kategori from public.profil_risiko_item where id_risiko = 'UJI-R3') = 'B', 'Kategori profil dari risiko');

-- Unit lain tidak melihat risiko unit A
select pg_temp.sebagai('petugas2');
select pg_temp.cek((select count(*) from public.data_risiko where id_risiko like 'UJI-%') = 0, 'Risiko unit lain tidak terlihat');
