-- Ganti nama / gabung unit ikut memperbarui Hak Akses Kolom formulir.
select pg_temp.sebagai('sistem');
insert into public.master_unit (nama_unit) values ('UNIT UJI LAMA'), ('UNIT UJI C');
insert into public.setup_formulir (id_form, kolom) values ('FORM_UJI_AKSES', '[
  {"judul":"Tanggal","tipe":"calendar","akses":"ALL"},
  {"judul":"Kolom A","tipe":"number","akses":"UNIT UJI A, unit uji lama"},
  {"judul":"Kolom B","tipe":"number","akses":"UNIT UJI LAMA"},
  {"judul":"Kolom C","tipe":"number","akses":"UNIT UJI B, UNIT UJI C, UNIT UJI LAMA"},
  {"judul":"Kolom D","tipe":"number","akses":"UNIT UJI A"}]');

select pg_temp.sebagai('komite');
-- Pratinjau tidak mengubah apa pun
select public.ganti_nama_unit('UNIT UJI LAMA', 'UNIT UJI BARU', false, true);
select pg_temp.cek((select kolom -> 2 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI LAMA', 'Pratinjau tidak mengubah hak akses');

-- Ganti nama: semua kemunculan (tanpa peka huruf besar/kecil) diganti, kolom lain utuh
select public.ganti_nama_unit('UNIT UJI LAMA', 'UNIT UJI BARU', false, false);
select pg_temp.cek((select kolom -> 1 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI A, UNIT UJI BARU', 'Kolom A diganti');
select pg_temp.cek((select kolom -> 2 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI BARU', 'Kolom B diganti');
select pg_temp.cek((select kolom -> 0 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'ALL', 'Kolom ALL utuh');
select pg_temp.cek((select kolom -> 4 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI A', 'Kolom tanpa unit lama utuh');
select pg_temp.cek((select kolom -> 1 ->> 'judul' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'Kolom A', 'Atribut lain kolom utuh');

-- Gabung ke unit yang sudah ada: tidak ada nama ganda
select public.ganti_nama_unit('UNIT UJI BARU', 'UNIT UJI C', true, false);
select pg_temp.cek((select kolom -> 3 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI B, UNIT UJI C', 'Gabung tanpa duplikat');
select pg_temp.cek((select kolom -> 2 ->> 'akses' from public.setup_formulir where id_form = 'FORM_UJI_AKSES') = 'UNIT UJI C', 'Gabung mengganti nama');
select pg_temp.cek((select count(*) from public.audit_log where tabel = 'setup_formulir' and id_baris = 'FORM_UJI_AKSES' and aksi = 'UPDATE') >= 2, 'Perubahan formulir tercatat di Log Audit');

-- Fungsi bantu tidak bisa dipanggil langsung oleh pengguna
select pg_temp.harus_gagal($q$select public._ganti_unit_di_akses_kolom('UNIT UJI A', 'X')$q$, 'permission denied', 'Fungsi bantu tertutup');
