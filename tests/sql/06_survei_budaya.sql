-- Survei budaya: hanya diterima saat periode dibuka; hanya satu periode dibuka.
select pg_temp.sebagai('sistem');
update public.survei_budaya_periode set status = 'ditutup' where status = 'dibuka';

select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$select public.kirim_survei_budaya('{"unit_kerja":"UNIT UJI A","profesi":"Perawat","jawaban_survey":{"A1":"4"}}')$q$,
  'tidak dibuka', 'Survei ditolak saat tidak ada periode dibuka');
insert into public.survei_budaya_periode (nama, tanggal_mulai, tanggal_selesai, status) values ('Uji Survei', current_date - 1, current_date + 30, 'dibuka');
select pg_temp.harus_gagal($q$insert into public.survei_budaya_periode (nama, tanggal_mulai, tanggal_selesai, status) values ('Uji 2', current_date, current_date + 1, 'dibuka')$q$,
  'satu_dibuka|duplicate', 'Hanya satu periode dibuka');

select public.kirim_survei_budaya('{"unit_kerja":"UNIT UJI A","profesi":"Perawat","jawaban_survey":{"A1":"4"}}');
select pg_temp.cek((select count(*) from public.data_survey_budaya d join public.survei_budaya_periode p on p.id = d.id_periode where p.nama = 'Uji Survei') = 1,
  'Jawaban masuk ke periode yang dibuka');
select pg_temp.harus_gagal($q$select public.kirim_survei_budaya('{"unit_kerja":"UNIT TIDAK ADA","profesi":"Perawat","jawaban_survey":{}}')$q$,
  'Unit kerja', 'Unit wajib dari daftar');

-- Petugas unit tidak dapat mengelola periode
select pg_temp.sebagai('petugas');
select pg_temp.harus_gagal($q$insert into public.survei_budaya_periode (nama, tanggal_mulai, tanggal_selesai, status) values ('X', current_date, current_date, 'ditutup')$q$,
  'row-level security', 'Periode hanya dikelola Komite');
