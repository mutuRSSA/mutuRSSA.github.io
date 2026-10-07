-- Verifikasi insiden: Komite menetapkan jenis insiden & grading; jenis investigasi otomatis.
select pg_temp.sebagai('sistem');
insert into public.data_insiden (id_insiden, unit_pelapor, jenis_insiden, skor_dampak, skor_probabilitas,
                                 waktu_insiden, waktu_lapor, kronologi, nama_pelapor)
values ('c0000000-0000-4000-8000-000000000091', 'UNIT UJI A', 'KNC', 2, 2, now() - interval '2 days', now(), 'Uji', 'Uji'),
       ('c0000000-0000-4000-8000-000000000092', 'UNIT UJI A', 'KPC', 4, 4, now() - interval '2 days', now(), 'Uji', 'Uji');
select pg_temp.cek((select grading_pelapor = 'Biru' and jenis_insiden_pelapor = 'KNC' and skor_dampak_pelapor = 2 and status_investigasi = 'Baru'
                      from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000091'), 'Isian pelapor tersimpan saat laporan masuk');

select pg_temp.sebagai('komite');
-- Koreksi: sebenarnya KTD dengan dampak 4 x probabilitas 3 -> Merah -> RCA otomatis
update public.data_insiden set jenis_insiden = 'KTD', skor_dampak = 4, skor_probabilitas = 3, catatan_verifikasi = 'Pasien cedera, bukan KNC',
       status_investigasi = 'Investigasi', jenis_investigasi = null
 where id_insiden = 'c0000000-0000-4000-8000-000000000091';
select pg_temp.cek((select grading_risiko = 'Merah' and jenis_investigasi = 'rca' and batas_investigasi = waktu_insiden::date + 45
                           and diverifikasi_oleh = 'Komite Uji' and grading_pelapor = 'Biru' and jenis_insiden_pelapor = 'KNC'
                      from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000091'), 'Verifikasi Merah -> RCA 45 hari, isian pelapor utuh');

-- Verifikasi ulang (sebelum hasil investigasi): turun ke Hijau -> sederhana 14 hari
update public.data_insiden set skor_dampak = 2, skor_probabilitas = 3, jenis_investigasi = null where id_insiden = 'c0000000-0000-4000-8000-000000000091';
select pg_temp.cek((select grading_risiko = 'Hijau' and jenis_investigasi = 'sederhana' and batas_investigasi = waktu_insiden::date + 14
                      from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000091'), 'Verifikasi ulang Hijau -> sederhana 14 hari');

-- Komite boleh menaikkan ke RCA; perubahan lain tidak menurunkannya
update public.data_insiden set jenis_investigasi = 'rca' where id_insiden = 'c0000000-0000-4000-8000-000000000091';
update public.data_insiden set lapor_eksternal_pada = now() where id_insiden = 'c0000000-0000-4000-8000-000000000091';
select pg_temp.cek((select jenis_investigasi = 'rca' and batas_investigasi = waktu_insiden::date + 45
                      from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000091'), 'Naik ke RCA dipertahankan');

-- Isian pelapor tidak bisa diubah
update public.data_insiden set grading_pelapor = 'Merah', skor_dampak_pelapor = 5 where id_insiden = 'c0000000-0000-4000-8000-000000000091';
select pg_temp.cek((select grading_pelapor = 'Biru' and skor_dampak_pelapor = 2 from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000091'), 'Isian pelapor terkunci');

-- KPC grading Merah tetap investigasi sederhana (boleh dinaikkan)
update public.data_insiden set status_investigasi = 'Investigasi', jenis_investigasi = null where id_insiden = 'c0000000-0000-4000-8000-000000000092';
select pg_temp.cek((select grading_risiko = 'Merah' and jenis_investigasi = 'sederhana' from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000092'), 'KPC tidak wajib RCA');

-- Dibuka kembali -> Baru: jenis investigasi dikosongkan
update public.data_insiden set status_investigasi = 'Baru' where id_insiden = 'c0000000-0000-4000-8000-000000000092';
select pg_temp.cek((select jenis_investigasi is null and diverifikasi_pada is null from public.data_insiden where id_insiden = 'c0000000-0000-4000-8000-000000000092'), 'Kembali Baru mengosongkan verifikasi');
