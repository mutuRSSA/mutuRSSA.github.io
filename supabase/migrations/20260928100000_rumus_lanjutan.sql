-- =====================================================================
-- Migrasi: Mesin rumus lanjutan (setara pembangun rumus Google Sheet lama)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928090000 sudah dijalankan.
--
-- Tambahan kemampuan template rumus (format lama TETAP berlaku):
--   1. Banyak syarat sekaligus (semua harus terpenuhi / AND):
--        {"tipe":"COUNTALL","syarat":[{"kolom":3,"operator":"==","nilai":"Ya"},
--                                     {"kolom":5,"operator":"tidak_kosong"}]}
--        {"tipe":"SUM","target_kolom":4,"syarat":[...]}
--   2. Operator baru "excludes" (tidak mengandung).
--   3. Angka tetap:            {"tipe":"KONSTAN","nilai":0.01}
--   4. Gabungan +/- dan lintas formulir (unit & bulan yang sama):
--        {"tipe":"GABUNGAN","bagian":[
--           {"tanda":"+","id_form":"Kepatuhan_Penggunaan_Formularium_Nasional","rumus":{"tipe":"SUM","target_kolom":4}},
--           {"tanda":"-","rumus":{"tipe":"COUNTALL","syarat":[{"kolom":3,"operator":"tidak_kosong"}]}}]}
--      "id_form" kosong = formulir indikator itu sendiri.
--
-- Unit x bulan yang dilaporkan untuk satu indikator:
--   * semua unit x bulan yang punya data di formulir indikator itu, DITAMBAH
--   * unit x bulan dari formulir lain yang dirujuk, HANYA untuk unit yang
--     juga mengisi formulir indikator itu (tahun/periode yang sama) atau
--     unit pelaksana di Profil Indikator.
--   Contoh: Readmisi ICU (penyebut = jumlah visite) tidak muncul untuk unit
--   lain yang hanya mengisi formulir visite.
--
-- Juga:
--   * nilai_kolom_mutu()        -> isi terbanyak suatu kolom (saran nilai di pembangun rumus)
--   * ringkasan_formulir_mutu() -> jumlah baris per formulir (cek kesehatan rumus)
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Operator "excludes"
-- ---------------------------------------------------------------------
create or replace function public.mutu_cocok(p_nilai text, p_operator text, p_kriteria text)
returns boolean language sql immutable parallel safe as $$
  select case coalesce(p_operator, '==')
    when '=='           then lower(btrim(coalesce(p_nilai, ''))) =  lower(btrim(coalesce(p_kriteria, '')))
    when '!='           then lower(btrim(coalesce(p_nilai, ''))) <> lower(btrim(coalesce(p_kriteria, '')))
    when 'includes'     then strpos(lower(btrim(coalesce(p_nilai, ''))), lower(btrim(coalesce(p_kriteria, '')))) > 0
    when 'excludes'     then strpos(lower(btrim(coalesce(p_nilai, ''))), lower(btrim(coalesce(p_kriteria, '')))) = 0
    when 'kosong'       then btrim(coalesce(p_nilai, '')) = ''
    when 'tidak_kosong' then btrim(coalesce(p_nilai, '')) <> ''
    when '>'  then coalesce(public.mutu_angka(p_nilai) >  public.mutu_angka(p_kriteria), false)
    when '>=' then coalesce(public.mutu_angka(p_nilai) >= public.mutu_angka(p_kriteria), false)
    when '<'  then coalesce(public.mutu_angka(p_nilai) <  public.mutu_angka(p_kriteria), false)
    when '<=' then coalesce(public.mutu_angka(p_nilai) <= public.mutu_angka(p_kriteria), false)
    else false end
$$;

-- ---------------------------------------------------------------------
-- 2. Daftar syarat (semua harus terpenuhi). Daftar kosong = lolos.
-- ---------------------------------------------------------------------
create or replace function public.mutu_syarat_ok(d jsonb, s jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(bool_and(
           public.mutu_indeks(x ->> 'kolom') is not null
           and public.mutu_cocok(d ->> public.mutu_indeks(x ->> 'kolom'), x ->> 'operator', x ->> 'nilai')), true)
    from jsonb_array_elements(case when jsonb_typeof(s) = 'array' then s else '[]'::jsonb end) x
$$;

-- ---------------------------------------------------------------------
-- 3. Kontribusi SATU baris (fungsi SQL murni, bisa di-inline).
--    KONSTAN & GABUNGAN dihitung di tingkat kelompok (lihat _mutu_hitung).
-- ---------------------------------------------------------------------
create or replace function public.mutu_nilai_rumus(t jsonb, d jsonb)
returns numeric language sql immutable parallel safe as $$
  select case
    when t is null then 0
    -- daftar syarat tambahan (AND); hanya diperiksa bila ada
    when (case when t ? 'syarat' then not public.mutu_syarat_ok(d, t -> 'syarat') else false end) then 0
    when t ->> 'tipe' = 'COUNTALL' then 1
    when t ->> 'tipe' = 'COUNTIF' then
      case when public.mutu_indeks(t ->> 'target_kolom') is null then
             (case when t ? 'syarat' then 1 else 0 end)
           when public.mutu_cocok(d ->> public.mutu_indeks(t ->> 'target_kolom'), t ->> 'operator', t ->> 'nilai_kriteria')
           then 1 else 0 end
    when t ->> 'tipe' = 'SUM' then
      case when public.mutu_indeks(t ->> 'target_kolom') is null then 0
           when nullif(t ->> 'syarat_kolom', '') is not null
                and not coalesce(public.mutu_cocok(d ->> public.mutu_indeks(t ->> 'syarat_kolom'),
                                                   t ->> 'syarat_operator', t ->> 'syarat_nilai')
                                 and public.mutu_indeks(t ->> 'syarat_kolom') is not null, false)
           then 0
           else coalesce(public.mutu_angka(d ->> public.mutu_indeks(t ->> 'target_kolom')), 0) end
    else 0 end
$$;

-- ---------------------------------------------------------------------
-- 4. Pecah template menjadi bagian: (id_form | null, tanda, rumus)
-- ---------------------------------------------------------------------
create or replace function public.mutu_bagian(t jsonb)
returns table (id_form text, tanda numeric, rumus jsonb)
language sql immutable parallel safe as $$
  select nullif(btrim(b ->> 'id_form'), ''),
         case when b ->> 'tanda' = '-' then -1 else 1 end::numeric,
         b -> 'rumus'
    from jsonb_array_elements(case when t ->> 'tipe' = 'GABUNGAN' and jsonb_typeof(t -> 'bagian') = 'array'
                                   then t -> 'bagian' else '[]'::jsonb end) b
   where jsonb_typeof(b -> 'rumus') = 'object'
  union all
  select null, 1, t where t is not null and t ->> 'tipe' is distinct from 'GABUNGAN'
$$;

-- ---------------------------------------------------------------------
-- 5. Inti perhitungan. p_ind = [{kunci, id_form, satuan, unit_pelaksana, tn, td}, ...]
--    SECURITY INVOKER: RLS data_mutu_harian tetap berlaku.
-- ---------------------------------------------------------------------
create or replace function public._mutu_hitung(p_ind jsonb, p_tahun int, p_bulan int[] default null, p_unit text default null)
returns table (kunci text, id_form text, unit_kerja text, bulan int,
               jumlah_baris bigint, numerator numeric, denominator numeric, capaian numeric)
language sql stable security invoker set search_path = public as $$
  with ind as materialized (
    select x ->> 'kunci' as kunci, x ->> 'id_form' as id_form, x ->> 'satuan' as satuan,
           nullif(btrim(x ->> 'unit_pelaksana'), '') as unit_pelaksana,
           public.mutu_template(x ->> 'tn') as tn, public.mutu_template(x ->> 'td') as td
      from jsonb_array_elements(p_ind) x
     where nullif(x ->> 'id_form', '') is not null
  ),
  -- Satu baris per (indikator, formulir yang dibaca). Rumus sederhana: N & D
  -- dihitung dalam SATU lintasan data formulir indikator (baris "utama").
  jenis as (
    select i.*,
           (i.tn ->> 'tipe' in ('GABUNGAN', 'KONSTAN')) as n_khusus,
           (i.td ->> 'tipe' in ('GABUNGAN', 'KONSTAN')) as d_khusus
      from ind i
  ),
  bagian as materialized (
    select j.kunci, j.id_form as form, true as utama,
           case when j.n_khusus then null else j.tn end as rn, 1::numeric as sn,
           case when j.d_khusus then null else j.td end as rd, 1::numeric as sd
      from jenis j
    union all
    select j.kunci, coalesce(b.id_form, j.id_form), false, b.rumus, b.tanda, null, 0
      from jenis j cross join lateral public.mutu_bagian(j.tn) b
     where j.tn ->> 'tipe' = 'GABUNGAN' and b.rumus ->> 'tipe' is distinct from 'KONSTAN'
    union all
    select j.kunci, coalesce(b.id_form, j.id_form), false, null, 0, b.rumus, b.tanda
      from jenis j cross join lateral public.mutu_bagian(j.td) b
     where j.td ->> 'tipe' = 'GABUNGAN' and b.rumus ->> 'tipe' is distinct from 'KONSTAN'
  ),
  nilai as (
    select b.kunci, d.unit_kerja, d.bulan,
           sum(case when b.rn is null then 0 else b.sn * public.mutu_nilai_rumus(b.rn, d.data_input) end) as vn,
           sum(case when b.rd is null then 0 else b.sd * public.mutu_nilai_rumus(b.rd, d.data_input) end) as vd,
           count(*) filter (where b.utama) as n_utama
      from bagian b
      join public.data_mutu_harian d on d.id_indikator = b.form
     where d.tahun = p_tahun
       and (p_bulan is null or d.bulan = any (p_bulan))
       and (p_unit is null or d.unit_kerja = p_unit)
     group by b.kunci, d.unit_kerja, d.bulan
  ),
  unit_sah as (
    select distinct n.kunci, n.unit_kerja from nilai n where n.n_utama > 0
    union
    select i.kunci, i.unit_pelaksana from ind i where i.unit_pelaksana is not null
  ),
  -- Angka tetap (KONSTAN), baik sebagai rumus utuh maupun bagian dari GABUNGAN
  konst as (
    select k.kunci, k.sisi, sum(k.tanda * coalesce(public.mutu_angka(k.rumus ->> 'nilai'), 0)) as v
      from (
        select j.kunci, s.sisi, b.tanda, b.rumus
          from jenis j
          cross join lateral (values ('N', j.tn), ('D', j.td)) s(sisi, t)
          cross join lateral public.mutu_bagian(s.t) b
         where s.t is not null and b.rumus ->> 'tipe' = 'KONSTAN'
      ) k
     group by k.kunci, k.sisi
  ),
  hasil as (
    select n.kunci, i.id_form, n.unit_kerja, n.bulan, n.n_utama as jumlah_baris, i.satuan,
           case when i.tn is null then 0 else n.vn + coalesce(kn.v, 0) end as n,
           case when i.td is null then 0 else n.vd + coalesce(kd.v, 0) end as d
      from nilai n
      join ind i on i.kunci = n.kunci
      left join konst kn on kn.kunci = n.kunci and kn.sisi = 'N'
      left join konst kd on kd.kunci = n.kunci and kd.sisi = 'D'
     where n.n_utama > 0
        or exists (select 1 from unit_sah s where s.kunci = n.kunci and s.unit_kerja = n.unit_kerja)
  )
  select h.kunci, h.id_form, h.unit_kerja, h.bulan, h.jumlah_baris, h.n, h.d,
         public.mutu_capaian(h.n, h.d, h.satuan)
    from hasil h
$$;

-- ---------------------------------------------------------------------
-- 6. Fungsi publik (nama & kolom hasil sama seperti migrasi 090000)
-- ---------------------------------------------------------------------
create or replace function public.hitung_capaian_mutu(
  p_tahun int,
  p_bulan int[] default null,
  p_unit text default null
) returns table (
  id_indikator uuid, id_form text, unit_kerja text, bulan int,
  jumlah_baris bigint, numerator numeric, denominator numeric, capaian numeric
)
language sql stable security invoker set search_path = public as $$
  select h.kunci::uuid, h.id_form, h.unit_kerja, h.bulan, h.jumlah_baris, h.numerator, h.denominator, h.capaian
    from public._mutu_hitung(
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'kunci', m.id_indikator, 'id_form', m.id_form, 'satuan', m.satuan,
                     'unit_pelaksana', m.unit_pelaksana,
                     'tn', m.template_numerator, 'td', m.template_denominator)), '[]'::jsonb)
              from public.master_indikator m
             where m.id_form is not null
               and (public.mutu_template(m.template_numerator) is not null
                    or public.mutu_template(m.template_denominator) is not null)),
           p_tahun, p_bulan, p_unit) h
$$;

-- Uji template yang BELUM disimpan (Konversi Rumus & Profil Indikator)
drop function if exists public.uji_rumus_mutu(text, text, text, text, int);
create or replace function public.uji_rumus_mutu(
  p_id_form text, p_template_n text, p_template_d text, p_satuan text, p_tahun int,
  p_unit_pelaksana text default null
) returns table (unit_kerja text, bulan int, jumlah_baris bigint, numerator numeric, denominator numeric, capaian numeric)
language sql stable security invoker set search_path = public as $$
  select h.unit_kerja, h.bulan, h.jumlah_baris, h.numerator, h.denominator, h.capaian
    from public._mutu_hitung(
           jsonb_build_array(jsonb_build_object('kunci', 'uji', 'id_form', p_id_form, 'satuan', p_satuan,
                                                'unit_pelaksana', p_unit_pelaksana,
                                                'tn', p_template_n, 'td', p_template_d)),
           p_tahun) h
   order by h.unit_kerja, h.bulan
$$;

-- ---------------------------------------------------------------------
-- 7. Bantuan pembangun rumus & cek kesehatan rumus
-- ---------------------------------------------------------------------
-- Isi terbanyak suatu kolom formulir (untuk saran "nilai kriteria")
create or replace function public.nilai_kolom_mutu(p_id_form text, p_kolom int, p_tahun int default null, p_batas int default 20)
returns table (nilai text, jumlah bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(d.data_input ->> p_kolom, '') as nilai, count(*)
    from public.data_mutu_harian d
   where d.id_indikator = p_id_form
     and (p_tahun is null or d.tahun = p_tahun)
   group by 1
   order by 2 desc, 1
   limit least(greatest(coalesce(p_batas, 20), 1), 50)
$$;

-- Jumlah baris & bulan terisi per formulir
create or replace function public.ringkasan_formulir_mutu(p_tahun int)
returns table (id_form text, jumlah_baris bigint, bulan int[], jumlah_unit bigint)
language sql stable security invoker set search_path = public as $$
  select d.id_indikator, count(*), array_agg(distinct d.bulan order by d.bulan), count(distinct d.unit_kerja)
    from public.data_mutu_harian d
   where d.tahun = p_tahun
   group by d.id_indikator
$$;

revoke execute on function public._mutu_hitung(jsonb, int, int[], text) from public, anon;
grant  execute on function public._mutu_hitung(jsonb, int, int[], text) to authenticated;
grant  execute on function public.mutu_syarat_ok(jsonb, jsonb), public.mutu_bagian(jsonb) to authenticated;
revoke execute on function public.hitung_capaian_mutu(int, int[], text) from public, anon;
grant  execute on function public.hitung_capaian_mutu(int, int[], text) to authenticated;
revoke execute on function public.uji_rumus_mutu(text, text, text, text, int, text) from public, anon;
grant  execute on function public.uji_rumus_mutu(text, text, text, text, int, text) to authenticated;
revoke execute on function public.nilai_kolom_mutu(text, int, int, int) from public, anon;
grant  execute on function public.nilai_kolom_mutu(text, int, int, int) to authenticated;
revoke execute on function public.ringkasan_formulir_mutu(int) from public, anon;
grant  execute on function public.ringkasan_formulir_mutu(int) to authenticated;

commit;
