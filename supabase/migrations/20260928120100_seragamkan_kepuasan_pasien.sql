-- =====================================================================
-- Perbaikan data: format isian Kepuasan Pasien dan Keluarga -> PERSEN
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928100000 (mutu_angka, mutu_template) sudah dijalankan.
--
-- Masalah: sebagian bulan diisi pecahan (0,9181) dan sebagian persen (88,39).
-- Rumus lama (D = angka tetap 0,01, satuan "indeks") hanya benar untuk
-- pecahan, sehingga bulan yang diisi persen tampil 8.839.
--
-- Keputusan: isian SERAGAM dalam PERSEN (contoh 91,81).
--   1. Nilai 0 < x <= 1 dikalikan 100 (0,9181 -> 91,81). Nilai > 1 dan 0 tidak diubah.
--   2. Rumus: N = total kolom kepuasan, D = jumlah baris -> rata-rata persen per unit per bulan.
--      Satuan tidak diubah ("indeks" = tanpa pengali), jadi capaian tampil 91,81 seperti dulu.
-- Setiap baris yang diubah tercatat di Log Audit (isi sebelum & sesudah).
--
-- Aman dijalankan ulang (nilai yang sudah persen tidak disentuh lagi).
-- =====================================================================

begin;

do $$
declare
  r record;
  v_idx int;
  v_n int;
begin
  for r in
    select m.id_indikator, m.id_form, m.judul_indikator, m.template_numerator, m.template_denominator
      from public.master_indikator m
     where m.id_form ilike 'Kepuasan_Pasien%'
        or m.judul_indikator ilike '%kepuasan pasien%'
  loop
    -- Kolom nilai kepuasan di Form Builder (judul mengandung "kepuasan")
    select (k.i - 1)::int into v_idx
      from public.setup_formulir f
      cross join lateral jsonb_array_elements(f.kolom) with ordinality k(c, i)
     where f.id_form = r.id_form and k.c ->> 'judul' ilike '%kepuasan%'
     order by k.i limit 1;

    if v_idx is null then
      raise notice 'Lewati "%": kolom kepuasan tidak ditemukan di formulir %', r.judul_indikator, r.id_form;
      continue;
    end if;

    -- 1. Pecahan -> persen
    update public.data_mutu_harian d
       set data_input = jsonb_set(d.data_input, array[v_idx::text],
                                  to_jsonb(round(public.mutu_angka(d.data_input ->> v_idx) * 100, 2)))
     where d.id_indikator = r.id_form
       and public.mutu_angka(d.data_input ->> v_idx) > 0
       and public.mutu_angka(d.data_input ->> v_idx) <= 1;
    get diagnostics v_n = row_count;
    raise notice '"%": % baris diubah dari pecahan ke persen (kolom [%])', r.judul_indikator, v_n, v_idx;

    -- 2. Rumus: rata-rata persen
    update public.master_indikator
       set template_numerator = case
             when public.mutu_template(template_numerator) is null
               or public.mutu_template(template_numerator) ->> 'tipe' <> 'SUM'
             then jsonb_build_object('tipe', 'SUM', 'target_kolom', v_idx)::text
             else template_numerator end,
           template_denominator = '{"tipe":"COUNTALL"}'
     where id_indikator = r.id_indikator
       and (public.mutu_template(template_denominator) is null
            or public.mutu_template(template_denominator) ->> 'tipe' = 'KONSTAN');
    get diagnostics v_n = row_count;
    if v_n > 0 then raise notice '"%": rumus diubah menjadi rata-rata (N = total kolom [%], D = jumlah baris)', r.judul_indikator, v_idx; end if;
  end loop;
end $$;

commit;
