-- Riwayat versi: perubahan target yang berlaku mulai bulan tertentu tidak mengubah bulan sebelumnya.
select pg_temp.sebagai('komite');
insert into public.master_indikator (id_indikator, id_form, judul_indikator, satuan, target, arah_target, template_numerator, template_denominator)
values ('b0000000-0000-4000-8000-000000000002', 'UJI_VERSI', 'Indikator Uji Versi', '%', '80', '>=',
        '{"tipe":"COUNTIF","target_kolom":0,"operator":"==","nilai_kriteria":"Ya"}', '{"tipe":"COUNTALL"}');
select pg_temp.sebagai('sistem');
insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, data_input)
select 'UNIT UJI A', 'UJI_VERSI', b, 2031, jsonb_build_array(case when g <= 3 then 'Ya' else 'Tidak' end)
  from generate_series(1, 4) g, generate_series(1, 6) b;

select pg_temp.sebagai('komite');
-- Mulai April: target 90 dan rumus baru (hitung "Tidak")
update public.master_indikator
   set target = '90', berlaku_mulai = date '2031-04-01', catatan_perubahan = 'Uji',
       template_numerator = '{"tipe":"COUNTIF","target_kolom":0,"operator":"==","nilai_kriteria":"Tidak"}'
 where id_indikator = 'b0000000-0000-4000-8000-000000000002';
select pg_temp.cek((select berlaku_mulai from public.master_indikator where id_indikator = 'b0000000-0000-4000-8000-000000000002') is null, 'Kolom sementara dikosongkan');
select pg_temp.cek((select count(*) from public.master_indikator_versi where id_indikator = 'b0000000-0000-4000-8000-000000000002') = 2, 'Dua versi tersimpan');

create temp table h as select * from public.hitung_capaian_mutu(2031, null, 'UNIT UJI A') where id_indikator = 'b0000000-0000-4000-8000-000000000002';
grant select on h to authenticated;
select pg_temp.cek((select capaian from h where bulan = 3) = 75 and (select target from h where bulan = 3) = '80', 'Maret memakai versi lama (75%, target 80)');
select pg_temp.cek((select capaian from h where bulan = 4) = 25 and (select target from h where bulan = 4) = '90', 'April memakai versi baru (25%, target 90)');

-- Koreksi (tanpa berlaku_mulai) berlaku untuk seluruh periode
update public.master_indikator set target = '85' where id_indikator = 'b0000000-0000-4000-8000-000000000002';
select pg_temp.cek((select count(*) from public.master_indikator_versi where id_indikator = 'b0000000-0000-4000-8000-000000000002') = 1, 'Koreksi menggantikan semua versi');
select pg_temp.cek((select bool_and(target = '85') from public.hitung_capaian_mutu(2031, null, 'UNIT UJI A') where id_indikator = 'b0000000-0000-4000-8000-000000000002'), 'Koreksi berlaku di semua bulan');
