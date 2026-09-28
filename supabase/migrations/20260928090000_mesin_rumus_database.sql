-- =====================================================================
-- Migrasi: Mesin rumus capaian indikator di DATABASE
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928080000 sudah dijalankan.
--
-- Sebelumnya Laporan Mutu menarik SEMUA baris data mentah (puluhan ribu,
-- beserta isi data_input) lalu menghitung N/D/capaian di browser.
-- Sekarang database yang menghitung; browser hanya menerima hasil per
-- indikator x unit x bulan (ratusan baris kecil).
--
-- Format template (kolom master_indikator.template_numerator / _denominator,
-- JSON; SAMA dengan engine_mutu.js, template lama tetap berlaku):
--   {"tipe":"COUNTALL"}
--   {"tipe":"COUNTIF","target_kolom":3,"operator":"==","nilai_kriteria":"Ya"}
--   {"tipe":"SUM","target_kolom":5}
--   {"tipe":"SUM","target_kolom":5,"syarat_kolom":2,"syarat_operator":"==","syarat_nilai":"Ya"}   <- baru
--   operator: == | != | includes | > | >= | < | <= | kosong | tidak_kosong                        <- 6 baru
-- Satuan: mengandung "%"/"persen" -> x100; "permil"/"‰" -> x1000 (sama seperti sistem lama).
--
-- hitung_capaian_mutu() berjalan dengan hak PEMANGGIL (security invoker),
-- jadi RLS tetap berlaku: staf unit hanya mendapat hasil unitnya sendiri.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- Angka di awal teks, meniru parseFloat() JavaScript: "12.5%" -> 12.5, "abc" -> null
create or replace function public.mutu_angka(v text)
returns numeric language sql immutable parallel safe as $$
  select nullif(substring(btrim(coalesce(v, '')) from '^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?'), '')::numeric
$$;

-- Indeks kolom dari template (meniru parseInt): "3" / 3 / "3abc" -> 3; lainnya -> null
create or replace function public.mutu_indeks(v text)
returns int language sql immutable parallel safe as $$
  select nullif(substring(btrim(coalesce(v, '')) from '^\d+'), '')::int
$$;

-- Cocokkan satu nilai sel dengan kriteria (tidak peka huruf besar/kecil, spasi di ujung diabaikan).
-- Ditulis sebagai fungsi SQL murni agar di-"inline" Postgres (jauh lebih cepat dari plpgsql per baris).
create or replace function public.mutu_cocok(p_nilai text, p_operator text, p_kriteria text)
returns boolean language sql immutable parallel safe as $$
  select case coalesce(p_operator, '==')
    when '=='           then lower(btrim(coalesce(p_nilai, ''))) =  lower(btrim(coalesce(p_kriteria, '')))
    when '!='           then lower(btrim(coalesce(p_nilai, ''))) <> lower(btrim(coalesce(p_kriteria, '')))
    when 'includes'     then strpos(lower(btrim(coalesce(p_nilai, ''))), lower(btrim(coalesce(p_kriteria, '')))) > 0
    when 'kosong'       then btrim(coalesce(p_nilai, '')) = ''
    when 'tidak_kosong' then btrim(coalesce(p_nilai, '')) <> ''
    when '>'  then coalesce(public.mutu_angka(p_nilai) >  public.mutu_angka(p_kriteria), false)
    when '>=' then coalesce(public.mutu_angka(p_nilai) >= public.mutu_angka(p_kriteria), false)
    when '<'  then coalesce(public.mutu_angka(p_nilai) <  public.mutu_angka(p_kriteria), false)
    when '<=' then coalesce(public.mutu_angka(p_nilai) <= public.mutu_angka(p_kriteria), false)
    else false end
$$;

-- Template teks -> jsonb (null bila bukan JSON objek yang valid).
-- PARALLEL UNSAFE karena memakai blok exception (tidak boleh di query paralel).
create or replace function public.mutu_template(p text)
returns jsonb language plpgsql immutable parallel unsafe as $$
declare t text := btrim(coalesce(p, ''));
begin
  if left(t, 1) <> '{' or right(t, 1) <> '}' then return null; end if;
  if jsonb_typeof(t::jsonb) <> 'object' then return null; end if;
  return t::jsonb;
exception when others then return null;
end $$;

-- Kontribusi SATU baris data terhadap N atau D (fungsi SQL murni, bisa di-inline)
create or replace function public.mutu_nilai_rumus(t jsonb, d jsonb)
returns numeric language sql immutable parallel safe as $$
  select case
    when t is null then 0
    when t ->> 'tipe' = 'COUNTALL' then 1
    when t ->> 'tipe' = 'COUNTIF' then
      case when public.mutu_indeks(t ->> 'target_kolom') is not null
                and public.mutu_cocok(d ->> public.mutu_indeks(t ->> 'target_kolom'), t ->> 'operator', t ->> 'nilai_kriteria')
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

-- Pengali satuan
create or replace function public.mutu_pengali(p_satuan text)
returns numeric language sql immutable parallel safe as $$
  select case
    when lower(coalesce(p_satuan, '')) like '%permil%' or coalesce(p_satuan, '') like '%‰%' then 1000
    when coalesce(p_satuan, '') like '%\%%' or lower(coalesce(p_satuan, '')) like '%persen%' then 100
    else 1 end
$$;

-- Capaian dari N/D (dibulatkan 2 desimal); null bila D = 0
create or replace function public.mutu_capaian(n numeric, d numeric, p_satuan text)
returns numeric language sql immutable parallel safe as $$
  select case when coalesce(d, 0) > 0 then round(n / d * public.mutu_pengali(p_satuan), 2) end
$$;

-- ---------------------------------------------------------------------
-- Hitung capaian semua indikator: satu baris per indikator x unit x bulan
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
  with ind as materialized (
    select m.id_indikator, m.id_form, m.satuan,
           public.mutu_template(m.template_numerator) as tn,
           public.mutu_template(m.template_denominator) as td
      from public.master_indikator m
     where m.id_form is not null
  )
  select i.id_indikator, i.id_form, d.unit_kerja, d.bulan,
         count(*),
         sum(public.mutu_nilai_rumus(i.tn, d.data_input)),
         sum(public.mutu_nilai_rumus(i.td, d.data_input)),
         public.mutu_capaian(sum(public.mutu_nilai_rumus(i.tn, d.data_input)),
                             sum(public.mutu_nilai_rumus(i.td, d.data_input)), i.satuan)
    from ind i
    join public.data_mutu_harian d on d.id_indikator = i.id_form
   where (i.tn is not null or i.td is not null)
     and d.tahun = p_tahun
     and (p_bulan is null or d.bulan = any (p_bulan))
     and (p_unit is null or d.unit_kerja = p_unit)
   group by i.id_indikator, i.id_form, i.satuan, d.unit_kerja, d.bulan
$$;

-- Uji template yang BELUM disimpan (dipakai halaman Konversi Rumus)
create or replace function public.uji_rumus_mutu(
  p_id_form text, p_template_n text, p_template_d text, p_satuan text, p_tahun int
) returns table (unit_kerja text, bulan int, jumlah_baris bigint, numerator numeric, denominator numeric, capaian numeric)
language sql stable security invoker set search_path = public as $$
  select d.unit_kerja, d.bulan, count(*),
         sum(public.mutu_nilai_rumus(public.mutu_template(p_template_n), d.data_input)),
         sum(public.mutu_nilai_rumus(public.mutu_template(p_template_d), d.data_input)),
         public.mutu_capaian(sum(public.mutu_nilai_rumus(public.mutu_template(p_template_n), d.data_input)),
                             sum(public.mutu_nilai_rumus(public.mutu_template(p_template_d), d.data_input)), p_satuan)
    from public.data_mutu_harian d
   where d.id_indikator = p_id_form and d.tahun = p_tahun
   group by d.unit_kerja, d.bulan
$$;

grant execute on function public.mutu_angka(text), public.mutu_indeks(text), public.mutu_cocok(text, text, text),
  public.mutu_template(text), public.mutu_nilai_rumus(jsonb, jsonb), public.mutu_pengali(text),
  public.mutu_capaian(numeric, numeric, text) to authenticated;
revoke execute on function public.hitung_capaian_mutu(int, int[], text) from public, anon;
grant  execute on function public.hitung_capaian_mutu(int, int[], text) to authenticated;
revoke execute on function public.uji_rumus_mutu(text, text, text, text, int) from public, anon;
grant  execute on function public.uji_rumus_mutu(text, text, text, text, int) to authenticated;

-- Akses halaman Konversi Rumus untuk role administrator
update public.role_permissions
   set allowed_pages = concat_ws(',', nullif(allowed_pages, ''), 'konversi_rumus.html')
 where is_admin
   and coalesce(allowed_pages, '') not like '%konversi_rumus.html%';

commit;
