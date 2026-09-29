-- Laporan periodik: alur draf -> diajukan -> disetujui, penguncian, umpan balik unit.
select pg_temp.sebagai('petugas');
select pg_temp.harus_gagal($q$insert into public.laporan_periodik (jenis, tahun, nomor) values ('triwulan', 2031, 1)$q$, 'row-level security', 'Unit tidak bisa membuat laporan');

select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$insert into public.laporan_periodik (jenis, tahun, nomor) values ('triwulan', 2031, 5)$q$, 'check', 'Nomor triwulan 1-4');
insert into public.laporan_periodik (jenis, tahun, nomor, judul, status) values ('triwulan', 2031, 1, 'Uji TW I', 'disetujui');
create temp table lap as select id from public.laporan_periodik where tahun = 2031 and jenis = 'triwulan' and nomor = 1;
grant select on lap to authenticated;
select pg_temp.cek((select status = 'draf' and versi = 0 and dibuat_oleh = 'Komite Uji' from public.laporan_periodik where id = (select id from lap)), 'Laporan baru selalu draf');

select pg_temp.harus_gagal($q$update public.laporan_periodik set status = 'diajukan' where id = (select id from lap)$q$, 'Kompilasi data', 'Tidak bisa diajukan tanpa data');
update public.laporan_periodik set data = '{"mutu":1}' where id = (select id from lap);
update public.laporan_periodik set data = '{"mutu":2}', narasi = '{"mutu":{"ringkasan":"x"}}' where id = (select id from lap);
select pg_temp.cek((select versi from public.laporan_periodik where id = (select id from lap)) = 2, 'Kompilasi ulang menaikkan versi');

insert into public.laporan_umpan_balik_unit (id_laporan, unit_kerja, ringkasan, saran) values ((select id from lap), 'UNIT UJI A', 'Baik', '["Pertahankan"]');
select pg_temp.harus_gagal($q$update public.laporan_periodik set status = 'disetujui' where id = (select id from lap)$q$, 'diajukan', 'Harus diajukan dulu');
update public.laporan_periodik set status = 'diajukan' where id = (select id from lap);
select pg_temp.harus_gagal($q$update public.laporan_periodik set narasi = '{}' where id = (select id from lap)$q$, 'sedang diajukan', 'Isi terkunci saat diajukan');
select pg_temp.harus_gagal($q$update public.laporan_umpan_balik_unit set ringkasan = 'ubah' where id_laporan = (select id from lap)$q$, 'tidak dapat diubah', 'Umpan balik terkunci saat diajukan');

-- Unit belum bisa membaca umpan balik sebelum disetujui
select pg_temp.sebagai('petugas');
select pg_temp.cek((select count(*) from public.laporan_umpan_balik_unit) = 0, 'Umpan balik belum terlihat sebelum disetujui');

select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$update public.laporan_periodik set status = 'disetujui' where id = (select id from lap)$q$, 'disposisi', 'Disetujui wajib disposisi');
update public.laporan_periodik set status = 'disetujui', disposisi_direktur = 'Tindak lanjuti pasien jatuh', tanggapan_direktur = '{"mutu":"Perkuat PDSA"}' where id = (select id from lap);
select pg_temp.cek((select tanggapan_direktur->>'mutu' from public.laporan_periodik_riwayat where id_laporan = (select id from lap) and status = 'disetujui') = 'Perkuat PDSA', 'Tanggapan tersalin ke riwayat');
select pg_temp.cek((select disetujui_pada is not null and tanggal_disposisi is not null from public.laporan_periodik where id = (select id from lap)), 'Waktu persetujuan tercatat');
select pg_temp.cek((select count(*) from public.laporan_periodik_riwayat where id_laporan = (select id from lap)) = 2, 'Riwayat diajukan & disetujui');
select pg_temp.harus_gagal($q$update public.laporan_periodik set narasi = '{"a":1}' where id = (select id from lap)$q$, 'terkunci', 'Laporan disetujui terkunci');
select pg_temp.harus_gagal($q$update public.laporan_periodik set tanggapan_direktur = '{"mutu":"x"}' where id = (select id from lap)$q$, 'terkunci', 'Tanggapan Direktur terkunci setelah disetujui');
select pg_temp.harus_gagal($q$delete from public.laporan_periodik where id = (select id from lap)$q$, 'draf', 'Laporan disetujui tidak bisa dihapus');
insert into public.laporan_tindak_lanjut (id_laporan, uraian, pic, tenggat) values ((select id from lap), 'Audit pasien jatuh', 'Ka Instalasi', date '2031-06-30');

-- Unit membaca umpan baliknya sendiri setelah disetujui; unit lain tidak
select pg_temp.sebagai('petugas');
select pg_temp.cek((select count(*) from public.laporan_umpan_balik_unit) = 1, 'Unit membaca umpan balik setelah disetujui');
select pg_temp.cek((select count(*) from public.laporan_umpan_balik_saya()) = 1, 'RPC umpan balik unit');
select pg_temp.cek((select count(*) from public.laporan_periodik) = 0, 'Unit tidak membaca laporan direksi');
select pg_temp.sebagai('petugas2');
select pg_temp.cek((select count(*) from public.laporan_umpan_balik_unit) = 0, 'Unit lain tidak membaca');

-- Buka kembali: isi tetap, status draf
select pg_temp.sebagai('komite');
update public.laporan_periodik set status = 'draf', narasi = '{"hilang":true}' where id = (select id from lap);
select pg_temp.cek((select status = 'draf' and narasi ? 'mutu' from public.laporan_periodik where id = (select id from lap)), 'Buka kembali tidak mengubah isi');
update public.laporan_umpan_balik_unit set ringkasan = 'Revisi' where id_laporan = (select id from lap);
update public.laporan_tindak_lanjut set status = 'selesai' where id_laporan = (select id from lap);
select pg_temp.cek((select selesai_pada is not null from public.laporan_tindak_lanjut where id_laporan = (select id from lap)), 'Tindak lanjut selesai tercatat');
