-- Grading insiden dari matriks & alur penanganan IKP.
select pg_temp.sebagai('sistem');
insert into public.data_insiden (id_insiden, unit_pelapor, jenis_insiden, skor_dampak, skor_probabilitas, grading_risiko,
                                 status_investigasi, waktu_insiden, waktu_lapor, kronologi, nama_pelapor)
values ('c0000000-0000-4000-8000-000000000001', 'UNIT UJI A', 'Sentinel', 1, 1, 'Biru', 'Selesai', now() - interval '3 days', now(), 'Uji', 'Uji'),
       ('c0000000-0000-4000-8000-000000000002', 'UNIT UJI A', 'KNC', 1, 1, 'Merah', null, now() - interval '1 day', now(), 'Uji', 'Uji');
select pg_temp.cek((select grading_risiko from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 'Merah', 'Sentinel selalu Merah');
select pg_temp.cek((select grading_risiko from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000002') = public.mutu_grading_insiden('KNC', 1, 1), 'Grading dihitung ulang dari skor');
select pg_temp.cek((select status_investigasi from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 'Baru', 'Laporan baru selalu berstatus Baru');

-- Unit pelapor tidak dapat mengubah status
select pg_temp.sebagai('petugas');
update public.data_insiden set status_investigasi = 'Selesai' where id_insiden = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.cek((select status_investigasi from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 'Baru', 'Unit tidak bisa mengubah status');

select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$update public.data_insiden set status_investigasi = 'Investigasi', jenis_investigasi = 'sederhana' where id_insiden = 'c0000000-0000-4000-8000-000000000001'$q$,
  'wajib diinvestigasi dengan RCA', 'Sentinel wajib RCA');
update public.data_insiden set status_investigasi = 'Investigasi', jenis_investigasi = 'rca' where id_insiden = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.cek((select batas_investigasi = (waktu_insiden::date + 45) from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000001'), 'Batas RCA 45 hari');
select pg_temp.harus_gagal($q$update public.data_insiden set status_investigasi = 'Tindak Lanjut' where id_insiden = 'c0000000-0000-4000-8000-000000000001'$q$,
  'hasil investigasi', 'Tindak lanjut butuh hasil investigasi');
update public.data_insiden set status_investigasi = 'Tindak Lanjut',
       investigasi_komite = '{"masalah_cmp":"x","rekomendasi":"Rek","tindakan_dilakukan":"Revisi SPO","pj_tindakan":"Ka Unit"}'
 where id_insiden = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.cek((select count(*) from public.insiden_tindak_lanjut where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 1, 'Rekomendasi menjadi tindak lanjut');
select pg_temp.harus_gagal($q$update public.data_insiden set status_investigasi = 'Selesai' where id_insiden = 'c0000000-0000-4000-8000-000000000001'$q$,
  'belum selesai', 'Tidak bisa ditutup saat tindak lanjut terbuka');
update public.insiden_tindak_lanjut set status = 'selesai', bukti = 'SPO 1/2031' where id_insiden = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.cek((select status_investigasi from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 'Selesai', 'Kasus tertutup otomatis');

-- Unit pelapor dapat membaca tindak lanjut laporannya
select pg_temp.sebagai('petugas');
select pg_temp.cek((select count(*) from public.insiden_tindak_lanjut where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 1, 'Unit melihat tindak lanjut');
select pg_temp.sebagai('petugas2');
select pg_temp.cek((select count(*) from public.insiden_tindak_lanjut where id_insiden = 'c0000000-0000-4000-8000-000000000001') = 0, 'Unit lain tidak melihat');

-- Tolak laporan wajib alasan
select pg_temp.sebagai('komite');
select pg_temp.harus_gagal($q$update public.data_insiden set status_investigasi = 'Ditolak' where id_insiden = 'c0000000-0000-4000-8000-000000000002'$q$, 'Alasan penolakan', 'Tolak wajib alasan');
