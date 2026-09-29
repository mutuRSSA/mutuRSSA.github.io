-- Sesi validasi: Slovin, sampel tersimpan, akurasi >= 90% = VALID, sesi selesai terkunci.
select pg_temp.sebagai('komite');
insert into public.master_indikator (id_indikator, id_form, judul_indikator, satuan, target, template_numerator, template_denominator, unit_pelaksana)
values ('b0000000-0000-4000-8000-000000000001', 'UJI_VALIDASI', 'Indikator Uji Validasi', '%', '80',
        '{"tipe":"COUNTIF","target_kolom":0,"operator":"==","nilai_kriteria":"Ya"}', '{"tipe":"COUNTALL"}', 'UNIT UJI A');

select pg_temp.sebagai('sistem');
insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input)
select 'UNIT UJI A', 'UJI_VALIDASI', 3, 2031, jsonb_build_array(case when g % 5 = 0 then 'Tidak' else 'Ya' end)
  from generate_series(1, 100) g;

-- Petugas unit tidak boleh membuat sesi
select pg_temp.sebagai('petugas');
select pg_temp.harus_gagal($q$select public.buat_sesi_validasi('b0000000-0000-4000-8000-000000000001'::uuid, 'UNIT UJI A'::text, 2031, 3, 0.10)$q$,
  'Komite Mutu', 'Sesi validasi hanya untuk Komite');

select pg_temp.sebagai('komite');
create temp table sesi as select (public.buat_sesi_validasi('b0000000-0000-4000-8000-000000000001'::uuid, 'UNIT UJI A'::text, 2031, 3, 0.10) ->> 'id')::uuid as id;
-- Slovin: n = ceil(100 / (1 + 100 x 0,1^2)) = 50
select pg_temp.cek((select jumlah_sampel from public.validasi_sesi where id = (select id from sesi)) = 50, 'Besar sampel Slovin 50');
select pg_temp.cek((select count(*) from public.validasi_sampel where sesi_id = (select id from sesi)) = 50, 'Sampel tersimpan 50 baris');
select pg_temp.cek((select capaian_populasi from public.validasi_sesi where id = (select id from sesi)) = 80, 'Capaian populasi 80% dari mesin rumus');
-- Membuat ulang sesi yang sama mengembalikan sesi draft yang ada (sampel tidak diacak ulang)
select pg_temp.cek((public.buat_sesi_validasi('b0000000-0000-4000-8000-000000000001'::uuid, 'UNIT UJI A'::text, 2031, 3, 0.10) ->> 'baru')::boolean = false, 'Sesi draft dipakai ulang');

-- Belum semua diperiksa -> tidak bisa diselesaikan
select pg_temp.harus_gagal($q$select public.selesaikan_sesi_validasi((select id from sesi))$q$, 'belum diperiksa', 'Semua sampel wajib diperiksa');

-- 47 sesuai, 3 tidak sesuai -> 94% VALID
select public.simpan_sampel_validasi((select id from sesi), (
  select jsonb_agg(jsonb_build_object('id', s.id,
           'hasil', case when s.urutan <= 3 then 'tidak_sesuai' else 'sesuai' end,
           'penyebab', case when s.urutan <= 3 then 'Salah ketik' end,
           'nilai_validator', case when s.urutan <= 3 then '{"0":"Tidak"}'::jsonb end))
    from public.validasi_sampel s where s.sesi_id = (select id from sesi)));
create temp table hasil as select public.selesaikan_sesi_validasi((select id from sesi)) as h;
select pg_temp.cek((select (h ->> 'akurasi')::numeric from hasil) = 94, 'Akurasi 94%');
select pg_temp.cek((select h ->> 'status_validasi' from hasil) = 'VALID', 'Status VALID');
select pg_temp.cek(exists (select 1 from public.data_validasi where id_sesi = (select id from sesi) and status_validasi = 'VALID'), 'Ringkasan masuk data_validasi');

-- Sesi selesai tidak dapat diubah
select pg_temp.harus_gagal($q$select public.simpan_sampel_validasi((select id from sesi), '[]')$q$, 'sudah selesai', 'Sesi selesai terkunci');
select pg_temp.harus_gagal($q$update public.validasi_sampel set hasil = 'sesuai' where sesi_id = (select id from sesi) and urutan = 1$q$,
  'selesai', 'Sampel sesi selesai tidak bisa diubah langsung');

-- Validasi ulang: TIDAK VALID wajib analisis & rencana
create temp table sesi2 as select (public.buat_sesi_validasi('b0000000-0000-4000-8000-000000000001'::uuid, 'UNIT UJI A'::text, 2031, 3, 0.10, null, (select id from sesi)) ->> 'id')::uuid as id;
select public.simpan_sampel_validasi((select id from sesi2), (
  select jsonb_agg(jsonb_build_object('id', s.id, 'hasil', case when s.urutan <= 10 then 'tidak_sesuai' else 'sesuai' end,
                                      'penyebab', case when s.urutan <= 10 then 'Tidak sesuai rekam medis' end))
    from public.validasi_sampel s where s.sesi_id = (select id from sesi2)));
select pg_temp.harus_gagal($q$select public.selesaikan_sesi_validasi((select id from sesi2))$q$, 'analisis penyebab', 'TIDAK VALID wajib analisis');
select pg_temp.cek((public.selesaikan_sesi_validasi((select id from sesi2), 'Analisis', 'Rencana') ->> 'status_validasi') = 'TIDAK VALID', 'Akurasi 80% = TIDAK VALID');
