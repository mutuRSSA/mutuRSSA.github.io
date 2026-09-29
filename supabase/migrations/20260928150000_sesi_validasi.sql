-- =====================================================================
-- Migrasi: Validasi data indikator mutu per sesi (cara hitung sesuai pedoman)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928140000 sudah dijalankan.
--
-- Cara lama keliru: akurasi = capaian sampel (B) / capaian populasi (A).
-- Angka itu bisa berbeda walau semua data benar (karena sampel != populasi),
-- dan kesalahan yang saling menutupi (salah "Ya" + salah "Tidak") lolos.
--
-- Cara baru (keputusan 28/09/2026):
--   * Besar sampel: rumus Slovin n = N / (1 + N.e^2), e dipilih 5% atau 10%.
--   * Sampel diacak SEKALI oleh database dan DISIMPAN (sesi validasi);
--     membuka ulang sesi menampilkan sampel yang sama. Seluruh RS: sampel
--     dibagi proporsional per unit.
--   * Validator (Komite Mutu) memeriksa setiap baris sampel terhadap sumber
--     asli (mode terbuka): sesuai / tidak sesuai. Bila tidak sesuai, nilai
--     yang benar dan penyebabnya DICATAT (data asli tidak diubah).
--   * Akurasi = baris sesuai / jumlah sampel x 100%. VALID bila >= 90%.
--   * TIDAK VALID wajib diisi analisis penyebab + rencana perbaikan, lalu
--     divalidasi ulang dengan sampel baru.
--   * Ringkasan hasil tetap ditulis ke data_validasi (riwayat lama tetap
--     terbaca di Kepatuhan Pelaporan).
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.validasi_sesi (
  id                  uuid primary key default gen_random_uuid(),
  tahun               int  not null check (tahun between 2000 and 2100),
  bulan               int  not null check (bulan between 1 and 12),
  unit_kerja          text not null,                 -- 'SELURUH RUMAH SAKIT' = semua unit
  id_indikator        uuid not null,                 -- profil indikator (master_indikator)
  id_form             text not null,
  judul_indikator     text,
  satuan              text,
  margin_error        numeric not null default 0.05 check (margin_error in (0.05, 0.10)),
  kolom_cek           int[] not null default '{}',   -- indeks kolom formulir yang diperiksa
  populasi            int  not null default 0,       -- N
  jumlah_sampel       int  not null default 0,       -- n
  capaian_populasi    numeric,                       -- A (mesin rumus database)
  status              text not null default 'draft' check (status in ('draft', 'selesai')),
  jumlah_sesuai       int,
  akurasi             numeric,
  status_validasi     text check (status_validasi in ('VALID', 'TIDAK VALID')),
  capaian_sampel_petugas   numeric,                  -- capaian sampel menurut data petugas
  capaian_sampel_validator numeric,                  -- capaian sampel menurut hasil validator
  analisis_penyebab   text,
  rencana_perbaikan   text,
  ulang_dari          uuid references public.validasi_sesi(id) on delete set null,
  validator_id        uuid default auth.uid(),
  validator_nama      text,
  dibuat_pada         timestamptz not null default now(),
  selesai_pada        timestamptz,
  id_validasi         uuid                           -- baris ringkasan di data_validasi
);
-- Satu sesi draft per indikator x unit x periode: sampel tidak bisa diacak ulang diam-diam
create unique index if not exists validasi_sesi_draft_uidx
  on public.validasi_sesi (id_indikator, unit_kerja, tahun, bulan) where status = 'draft';
create index if not exists validasi_sesi_periode_idx on public.validasi_sesi (tahun, bulan, unit_kerja);

create table if not exists public.validasi_sampel (
  id              uuid primary key default gen_random_uuid(),
  sesi_id         uuid not null references public.validasi_sesi(id) on delete cascade,
  urutan          int  not null,
  id_data         uuid,                -- data_mutu_harian.id
  unit_kerja      text,
  petugas_input   text,
  data_petugas    jsonb not null,      -- salinan isian petugas saat sampel ditarik
  hasil           text check (hasil in ('sesuai', 'tidak_sesuai')),
  nilai_validator jsonb not null default '{}'::jsonb,  -- {"indeks kolom": "nilai yang benar"}
  penyebab        text,
  catatan         text,
  dicek_pada      timestamptz,
  unique (sesi_id, urutan)
);
create index if not exists validasi_sampel_sesi_idx on public.validasi_sampel (sesi_id);

-- Tautan ringkasan lama -> sesi
alter table public.data_validasi add column if not exists id_sesi uuid;

-- ---------------------------------------------------------------------
-- 2. RLS: tulis hanya admin (Komite Mutu); baca admin atau unit sendiri
-- ---------------------------------------------------------------------
alter table public.validasi_sesi   enable row level security;
alter table public.validasi_sampel enable row level security;
grant select, insert, update, delete on public.validasi_sesi, public.validasi_sampel to authenticated;
revoke all on public.validasi_sesi, public.validasi_sampel from anon;

drop policy if exists validasi_sesi_baca on public.validasi_sesi;
create policy validasi_sesi_baca on public.validasi_sesi for select to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
drop policy if exists validasi_sesi_tulis on public.validasi_sesi;
create policy validasi_sesi_tulis on public.validasi_sesi for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop policy if exists validasi_sampel_baca on public.validasi_sampel;
create policy validasi_sampel_baca on public.validasi_sampel for select to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
drop policy if exists validasi_sampel_tulis on public.validasi_sampel;
create policy validasi_sampel_tulis on public.validasi_sampel for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

-- Buat, selesai, dan batal sesi tercatat di Log Audit (per sampel tidak, agar tidak ramai)
drop trigger if exists audit_validasi_sesi on public.validasi_sesi;
create trigger audit_validasi_sesi after insert or update or delete on public.validasi_sesi
  for each row execute function public.audit_catat('id');

-- Sesi yang sudah selesai (berita acara) tidak bisa diubah atau dihapus
create or replace function public.jaga_validasi_selesai()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  if tg_table_name = 'validasi_sesi' then
    if old.status = 'selesai' then
      raise exception 'Sesi validasi yang sudah selesai tidak dapat diubah atau dihapus.';
    end if;
  else
    select status into v_status from public.validasi_sesi
     where id = case when tg_op = 'DELETE' then old.sesi_id else new.sesi_id end;
    if v_status = 'selesai' then
      raise exception 'Sampel dari sesi validasi yang sudah selesai tidak dapat diubah.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists jaga_validasi_selesai on public.validasi_sesi;
create trigger jaga_validasi_selesai before update or delete on public.validasi_sesi
  for each row execute function public.jaga_validasi_selesai();
drop trigger if exists jaga_validasi_selesai on public.validasi_sampel;
create trigger jaga_validasi_selesai before insert or update or delete on public.validasi_sampel
  for each row execute function public.jaga_validasi_selesai();

-- ---------------------------------------------------------------------
-- 3. Kolom formulir yang dipakai rumus N & D (default kolom yang diperiksa)
-- ---------------------------------------------------------------------
create or replace function public.kolom_rumus_indikator(p_id_indikator uuid)
returns int[]
language sql stable security invoker set search_path = public as $$
  with ind as (
    select m.id_form, public.mutu_template(m.template_numerator) as tn,
           public.mutu_template(m.template_denominator) as td
      from public.master_indikator m where m.id_indikator = p_id_indikator
  ),
  rumus as (   -- rumus yang membaca formulir indikator itu sendiri
    select b.rumus as r
      from ind i
      cross join lateral (values (i.tn), (i.td)) s(t)
      cross join lateral public.mutu_bagian(s.t) b
     where s.t is not null and coalesce(b.id_form, i.id_form) = i.id_form
  ),
  idx as (
    select public.mutu_indeks(r ->> 'target_kolom') as k from rumus
    union select public.mutu_indeks(r ->> 'syarat_kolom') from rumus
    union select public.mutu_indeks(s ->> 'kolom')
            from rumus cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(r -> 'syarat') = 'array' then r -> 'syarat' else '[]'::jsonb end) s
  )
  select coalesce(array_agg(k order by k), '{}') from idx where k is not null
$$;
grant execute on function public.kolom_rumus_indikator(uuid) to authenticated;

-- Isian menurut validator: isian petugas, ditimpa nilai yang dikoreksi
create or replace function public.validasi_isi_benar(p_data jsonb, p_koreksi jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(case when p_koreksi ? (x.n - 1)::text then p_koreksi -> ((x.n - 1)::text) else x.e end order by x.n), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_data) = 'array' then p_data else '[]'::jsonb end) with ordinality x(e, n)
$$;

-- Capaian sekumpulan baris (rumus yang hanya membaca formulirnya sendiri).
-- NULL bila rumus membaca formulir lain (tidak bisa dihitung dari sampel).
create or replace function public.validasi_capaian_sampel(p_sesi uuid, p_versi text)
returns numeric
language sql stable security invoker set search_path = public as $$
  with s as (
    select v.id_form, v.satuan, public.mutu_template(m.template_numerator) as tn,
           public.mutu_template(m.template_denominator) as td
      from public.validasi_sesi v join public.master_indikator m on m.id_indikator = v.id_indikator
     where v.id = p_sesi
  ),
  bagian as (
    select sisi, b.id_form as bf, b.tanda, b.rumus, s.id_form
      from s cross join lateral (values ('N', s.tn), ('D', s.td)) x(sisi, t)
      cross join lateral public.mutu_bagian(x.t) b
     where x.t is not null
  ),
  isi as (
    select case when p_versi = 'validator' then public.validasi_isi_benar(p.data_petugas, p.nilai_validator)
                else p.data_petugas end as d
      from public.validasi_sampel p where p.sesi_id = p_sesi
  ),
  total as (
    select b.sisi,
           case when b.rumus ->> 'tipe' = 'KONSTAN' then b.tanda * coalesce(public.mutu_angka(b.rumus ->> 'nilai'), 0)
                else (select coalesce(sum(b.tanda * public.mutu_nilai_rumus(b.rumus, i.d)), 0) from isi i) end as v
      from bagian b
  )
  select case when exists (select 1 from bagian where bf is not null and bf <> id_form) then null
              else public.mutu_capaian((select coalesce(sum(v), 0) from total where sisi = 'N'),
                                       (select coalesce(sum(v), 0) from total where sisi = 'D'),
                                       (select satuan from s)) end
$$;
grant execute on function public.validasi_capaian_sampel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Mulai sesi: hitung N, n (Slovin), A, lalu tarik & simpan sampel acak.
--    Bila sudah ada sesi draft untuk indikator x unit x periode yang sama,
--    sesi itu yang dikembalikan (sampel tidak diacak ulang).
--    p_unit = 'RS_ALL' / 'SELURUH RUMAH SAKIT' untuk seluruh rumah sakit.
-- ---------------------------------------------------------------------
create or replace function public.buat_sesi_validasi(
  p_id_indikator uuid, p_unit text, p_tahun int, p_bulan int,
  p_margin numeric default 0.05, p_kolom int[] default null, p_ulang_dari uuid default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ind   record;
  v_rs    boolean := p_unit in ('RS_ALL', 'SELURUH RUMAH SAKIT');
  v_unit  text := case when p_unit in ('RS_ALL', 'SELURUH RUMAH SAKIT') then 'SELURUH RUMAH SAKIT' else p_unit end;
  v_ada   uuid;
  v_pop     int;
  v_jml     int;
  v_A     numeric;
  v_sesi  uuid;
  v_nama  text;
  v_kolom int[];
begin
  if not public.mutu_is_admin() then raise exception 'Validasi hanya dapat dilakukan oleh Komite Mutu (administrator).'; end if;
  if p_margin not in (0.05, 0.10) then raise exception 'Margin error hanya 5%% atau 10%%.'; end if;
  if coalesce(p_unit, '') = '' then raise exception 'Unit wajib dipilih.'; end if;

  select m.id_indikator, m.id_form, m.judul_indikator, m.satuan into v_ind
    from public.master_indikator m where m.id_indikator = p_id_indikator;
  if v_ind.id_indikator is null or coalesce(v_ind.id_form, '') = '' then raise exception 'Indikator tidak ditemukan.'; end if;

  -- Sesi draft yang sudah ada: lanjutkan
  select id into v_ada from public.validasi_sesi
   where id_indikator = p_id_indikator and unit_kerja = v_unit and tahun = p_tahun and bulan = p_bulan and status = 'draft';
  if v_ada is not null then
    return jsonb_build_object('id', v_ada, 'baru', false);
  end if;

  -- Populasi
  select count(*) into v_pop from public.data_mutu_harian d
   where d.id_indikator = v_ind.id_form and d.tahun = p_tahun and d.bulan = p_bulan
     and (v_rs or d.unit_kerja = v_unit);
  if v_pop = 0 then raise exception 'Tidak ada data % untuk % bulan %/%.', v_ind.judul_indikator, v_unit, p_bulan, p_tahun; end if;

  -- Slovin
  v_jml := least(v_pop, ceil(v_pop / (1 + v_pop * p_margin * p_margin))::int);

  -- Capaian populasi (A) dari mesin rumus database
  if v_rs then
    select case when v_ind.judul_indikator ilike '%kepuasan%'
                then round(avg(h.capaian), 2)
                else public.mutu_capaian(sum(h.numerator), sum(h.denominator), v_ind.satuan) end
      into v_A
      from public.hitung_capaian_mutu(p_tahun, array[p_bulan]) h
     where h.id_indikator = p_id_indikator;
  else
    select h.capaian into v_A
      from public.hitung_capaian_mutu(p_tahun, array[p_bulan], v_unit) h
     where h.id_indikator = p_id_indikator and h.unit_kerja = v_unit;
  end if;

  v_kolom := coalesce(p_kolom, public.kolom_rumus_indikator(p_id_indikator), '{}');
  select nama_lengkap into v_nama from public.profiles where id = auth.uid();

  insert into public.validasi_sesi (tahun, bulan, unit_kerja, id_indikator, id_form, judul_indikator, satuan,
                                    margin_error, kolom_cek, populasi, jumlah_sampel, capaian_populasi,
                                    ulang_dari, validator_nama)
  values (p_tahun, p_bulan, v_unit, p_id_indikator, v_ind.id_form, v_ind.judul_indikator, v_ind.satuan,
          p_margin, v_kolom, v_pop, v_jml, v_A, p_ulang_dari, v_nama)
  returning id into v_sesi;

  -- Sampel acak. Seluruh RS: urutan "jatah adil" rn/jumlah_unit membagi sampel
  -- proporsional per unit. Validasi ulang: baris yang pernah jadi sampel sesi
  -- sebelumnya diletakkan paling belakang (dipakai hanya bila populasi kurang).
  insert into public.validasi_sampel (sesi_id, urutan, id_data, unit_kerja, petugas_input, data_petugas)
  select v_sesi, row_number() over (order by x.pernah, x.jatah, x.acak), x.id, x.unit_kerja, x.petugas_input, x.data_input
    from (
      select y.*,
             (row_number() over (partition by y.unit_kerja order by y.acak))::numeric
               / count(*) over (partition by y.unit_kerja) as jatah
        from (
          select d.id, d.unit_kerja, d.petugas_input, d.data_input, random() as acak,
                 (p_ulang_dari is not null and exists (
                    select 1 from public.validasi_sampel s join public.validasi_sesi v on v.id = s.sesi_id
                     where s.id_data = d.id and v.id_indikator = p_id_indikator
                       and v.tahun = p_tahun and v.bulan = p_bulan and v.unit_kerja = v_unit)) as pernah
            from public.data_mutu_harian d
           where d.id_indikator = v_ind.id_form and d.tahun = p_tahun and d.bulan = p_bulan
             and (v_rs or d.unit_kerja = v_unit)
        ) y
    ) x
   order by x.pernah, x.jatah, x.acak
   limit v_jml;

  return jsonb_build_object('id', v_sesi, 'baru', true);
end $$;
revoke execute on function public.buat_sesi_validasi(uuid, text, int, int, numeric, int[], uuid) from public, anon;
grant  execute on function public.buat_sesi_validasi(uuid, text, int, int, numeric, int[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Simpan hasil pemeriksaan (bisa sebagian; sesi harus masih draft)
--    p_rows: [{id, hasil: 'sesuai'|'tidak_sesuai'|null, nilai_validator: {...}, penyebab, catatan}]
-- ---------------------------------------------------------------------
create or replace function public.simpan_sampel_validasi(p_sesi uuid, p_rows jsonb)
returns int
language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if not public.mutu_is_admin() then raise exception 'Validasi hanya dapat dilakukan oleh Komite Mutu (administrator).'; end if;
  if not exists (select 1 from public.validasi_sesi where id = p_sesi and status = 'draft') then
    raise exception 'Sesi validasi sudah selesai atau tidak ditemukan.';
  end if;
  update public.validasi_sampel s
     set hasil = nullif(r.hasil, ''),
         nilai_validator = case when r.hasil = 'tidak_sesuai' then coalesce(r.nilai_validator, '{}'::jsonb) else '{}'::jsonb end,
         penyebab = case when r.hasil = 'tidak_sesuai' then nullif(btrim(r.penyebab), '') end,
         catatan = nullif(btrim(r.catatan), ''),
         dicek_pada = case when nullif(r.hasil, '') is null then null else now() end
    from jsonb_to_recordset(p_rows) as r(id uuid, hasil text, nilai_validator jsonb, penyebab text, catatan text)
   where s.id = r.id and s.sesi_id = p_sesi
     and coalesce(nullif(r.hasil, ''), 'sesuai') in ('sesuai', 'tidak_sesuai');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.simpan_sampel_validasi(uuid, jsonb) from public, anon;
grant  execute on function public.simpan_sampel_validasi(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Selesaikan sesi: akurasi = baris sesuai / jumlah sampel x 100%
-- ---------------------------------------------------------------------
create or replace function public.selesaikan_sesi_validasi(p_sesi uuid, p_analisis text default null, p_rencana text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v       record;
  v_total int;
  v_sesuai int;
  v_belum int;
  v_akurasi numeric;
  v_status text;
  v_cp numeric;
  v_cv numeric;
  v_id_val uuid;
  v_bulan text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
begin
  if not public.mutu_is_admin() then raise exception 'Validasi hanya dapat dilakukan oleh Komite Mutu (administrator).'; end if;
  select * into v from public.validasi_sesi where id = p_sesi for update;
  if v.id is null then raise exception 'Sesi validasi tidak ditemukan.'; end if;
  if v.status <> 'draft' then raise exception 'Sesi validasi sudah selesai.'; end if;

  select count(*), count(*) filter (where hasil = 'sesuai'), count(*) filter (where hasil is null)
    into v_total, v_sesuai, v_belum
    from public.validasi_sampel where sesi_id = p_sesi;
  if v_total = 0 then raise exception 'Sesi tidak memiliki sampel.'; end if;
  if v_belum > 0 then raise exception 'Masih ada % sampel yang belum diperiksa.', v_belum; end if;
  if exists (select 1 from public.validasi_sampel where sesi_id = p_sesi and hasil = 'tidak_sesuai' and coalesce(penyebab, '') = '') then
    raise exception 'Setiap sampel yang tidak sesuai wajib diberi penyebab.';
  end if;

  v_akurasi := round(v_sesuai::numeric / v_total * 100, 2);
  v_status := case when v_akurasi >= 90 then 'VALID' else 'TIDAK VALID' end;
  if v_status = 'TIDAK VALID' and (coalesce(btrim(p_analisis), '') = '' or coalesce(btrim(p_rencana), '') = '') then
    raise exception 'Hasil TIDAK VALID: analisis penyebab dan rencana perbaikan wajib diisi.';
  end if;

  v_cp := public.validasi_capaian_sampel(p_sesi, 'petugas');
  v_cv := public.validasi_capaian_sampel(p_sesi, 'validator');

  -- Ringkasan untuk riwayat & Kepatuhan Pelaporan
  insert into public.data_validasi (unit_kerja, id_indikator, judul_indikator, bulan, tahun, tanggal_validasi,
                                    populasi_n_besar, sampel_n_kecil, capaian_a, capaian_b, akurasi,
                                    status_validasi, nama_validator, id_sesi)
  values (v.unit_kerja, v.id_form, v.judul_indikator, v_bulan[v.bulan], v.tahun, now(),
          v.populasi, v_total, v.capaian_populasi, v_cv, v_akurasi,
          v_status, coalesce(v.validator_nama, 'Komite Mutu'), v.id)
  returning id_validasi into v_id_val;

  update public.validasi_sesi
     set status = 'selesai', selesai_pada = now(), jumlah_sesuai = v_sesuai, akurasi = v_akurasi,
         status_validasi = v_status, capaian_sampel_petugas = v_cp, capaian_sampel_validator = v_cv,
         analisis_penyebab = nullif(btrim(p_analisis), ''), rencana_perbaikan = nullif(btrim(p_rencana), ''),
         id_validasi = v_id_val
   where id = p_sesi;

  return jsonb_build_object('akurasi', v_akurasi, 'status_validasi', v_status, 'jumlah_sampel', v_total,
                            'jumlah_sesuai', v_sesuai, 'capaian_sampel_petugas', v_cp, 'capaian_sampel_validator', v_cv);
end $$;
revoke execute on function public.selesaikan_sesi_validasi(uuid, text, text) from public, anon;
grant  execute on function public.selesaikan_sesi_validasi(uuid, text, text) to authenticated;

commit;
