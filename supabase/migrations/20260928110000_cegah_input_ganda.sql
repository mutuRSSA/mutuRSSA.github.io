-- =====================================================================
-- Migrasi: Pencegahan input ganda data mutu
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928100000 sudah dijalankan.
--
-- Latar belakang: di data lama ±6% baris adalah salinan persis baris lain
-- (unit, formulir, bulan & isi sama). Sebagian mungkin sah (dua pasien
-- dengan isian identik), sebagian klik/tempel ganda. Karena itu:
--   1. Kirim ulang yang sama (klik dua kali, koneksi putus lalu diulang)
--      DITOLAK otomatis lewat "kunci kirim" (kunci_kirim + urutan_kirim unik).
--   2. Baris yang isinya sama persis dengan data yang sudah tersimpan
--      (unit + formulir + bulan + tahun sama) atau dengan baris lain dalam
--      kiriman yang sama -> pengguna DITANYA: lewati atau tetap simpan.
--   3. daftar_duplikat_mutu(): admin meninjau & membersihkan duplikat lama.
--
-- Isi dibandingkan setelah dirapikan: huruf kecil, spasi di ujung dibuang,
-- null = teks kosong, angka 5 = teks "5".
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.data_mutu_harian add column if not exists kunci_kirim uuid;
alter table public.data_mutu_harian add column if not exists urutan_kirim int;
create unique index if not exists data_mutu_harian_kunci_kirim_uidx
  on public.data_mutu_harian (kunci_kirim, urutan_kirim) where kunci_kirim is not null;

-- Isi baris yang dirapikan untuk perbandingan
create or replace function public.mutu_isi_normal(d jsonb)
returns text language sql immutable parallel safe as $$
  select coalesce(string_agg(lower(btrim(coalesce(e #>> '{}', ''))), chr(31) order by n), '')
    from jsonb_array_elements(case when jsonb_typeof(d) = 'array' then d else '[]'::jsonb end) with ordinality x(e, n)
$$;

-- ---------------------------------------------------------------------
-- Simpan data mutu dengan pengecekan duplikat.
--   p_rows : [{unit_kerja, id_indikator, bulan, tahun, data_input}, ...]
--   p_kunci: uuid unik per kiriman (dibuat browser; dipakai ulang bila kiriman diulang)
--   p_mode : 'tanya'  -> bila ada duplikat, TIDAK menyimpan apa pun dan mengembalikan daftarnya
--            'lewati' -> simpan hanya baris yang tidak duplikat
--            'semua'  -> simpan semua (duplikat dianggap sah)
-- SECURITY INVOKER: aturan RLS insert (admin / unit sendiri) tetap berlaku.
-- ---------------------------------------------------------------------
create or replace function public.simpan_data_mutu(p_rows jsonb, p_kunci uuid, p_mode text default 'tanya')
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_nama text;
  v_komb record;
  v_dup_db int[];
  v_dup_batch int[];
  v_masuk int := 0;
  v_sudah int := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Tidak ada data untuk disimpan.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Satu kali simpan maksimal 2.000 baris.';
  end if;
  if p_kunci is null then raise exception 'Kunci kiriman wajib diisi.'; end if;
  if coalesce(p_mode, '') not in ('tanya', 'lewati', 'semua') then raise exception 'Mode tidak dikenal.'; end if;

  select nama_lengkap into v_nama from public.profiles where id = auth.uid();

  drop table if exists _kirim;
  create temp table _kirim on commit drop as
  select (x.n - 1)::int as urutan, x.r ->> 'unit_kerja' as unit_kerja, x.r ->> 'id_indikator' as id_indikator,
         (x.r ->> 'bulan')::int as bulan, (x.r ->> 'tahun')::int as tahun, x.r -> 'data_input' as data_input,
         public.mutu_isi_normal(x.r -> 'data_input') as isi
    from jsonb_array_elements(p_rows) with ordinality x(r, n);

  if exists (select 1 from _kirim where unit_kerja is null or id_indikator is null or bulan not between 1 and 12
                                     or tahun not between 2000 and 2100 or jsonb_typeof(data_input) is distinct from 'array') then
    raise exception 'Format data tidak valid (unit, formulir, bulan, tahun, atau isi).';
  end if;

  -- Kiriman ulang dengan kunci yang sama (klik ganda / koneksi terputus): sudah tersimpan
  select count(*) into v_sudah from public.data_mutu_harian where kunci_kirim = p_kunci;
  if v_sudah > 0 then
    return jsonb_build_object('status', 'ok', 'dimasukkan', 0, 'sudah_tersimpan', v_sudah, 'dilewati', 0);
  end if;

  -- Cegah dua penyimpanan bersamaan untuk unit + formulir + bulan yang sama
  for v_komb in select distinct unit_kerja, id_indikator, tahun, bulan from _kirim order by 1, 2, 3, 4 loop
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'mutu', v_komb.unit_kerja, v_komb.id_indikator, v_komb.tahun, v_komb.bulan), 0));
  end loop;

  -- Sama dengan data yang sudah tersimpan
  select coalesce(array_agg(k.urutan order by k.urutan), '{}') into v_dup_db
    from _kirim k
   where exists (select 1 from public.data_mutu_harian d
                  where d.unit_kerja = k.unit_kerja and d.id_indikator = k.id_indikator
                    and d.tahun = k.tahun and d.bulan = k.bulan
                    and public.mutu_isi_normal(d.data_input) = k.isi);

  -- Sama dengan baris sebelumnya dalam kiriman ini
  select coalesce(array_agg(k.urutan order by k.urutan), '{}') into v_dup_batch
    from _kirim k
   where not (k.urutan = any (v_dup_db))
     and exists (select 1 from _kirim k2
                  where k2.urutan < k.urutan and k2.unit_kerja = k.unit_kerja and k2.id_indikator = k.id_indikator
                    and k2.tahun = k.tahun and k2.bulan = k.bulan and k2.isi = k.isi);

  if p_mode = 'tanya' and (cardinality(v_dup_db) > 0 or cardinality(v_dup_batch) > 0) then
    return jsonb_build_object('status', 'konfirmasi', 'total', jsonb_array_length(p_rows),
                              'sama_dengan_tersimpan', to_jsonb(v_dup_db),
                              'sama_dalam_kiriman', to_jsonb(v_dup_batch));
  end if;

  insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, petugas_input, data_input, kunci_kirim, urutan_kirim)
  select k.unit_kerja, k.id_indikator, k.bulan, k.tahun, coalesce(v_nama, 'Petugas'), k.data_input, p_kunci, k.urutan
    from _kirim k
   where p_mode = 'semua' or not (k.urutan = any (v_dup_db || v_dup_batch))
  on conflict (kunci_kirim, urutan_kirim) where kunci_kirim is not null do nothing;
  get diagnostics v_masuk = row_count;

  return jsonb_build_object('status', 'ok', 'dimasukkan', v_masuk, 'sudah_tersimpan', 0,
                            'dilewati', jsonb_array_length(p_rows) - v_masuk);
end $$;

revoke execute on function public.simpan_data_mutu(jsonb, uuid, text) from public, anon;
grant  execute on function public.simpan_data_mutu(jsonb, uuid, text) to authenticated;
grant  execute on function public.mutu_isi_normal(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Daftar kelompok duplikat (untuk ditinjau admin di Database Admin)
-- Satu baris per kelompok isi identik; id_hapus = semua kecuali yang paling awal.
-- ---------------------------------------------------------------------
create or replace function public.daftar_duplikat_mutu(p_tahun int, p_id_form text default null)
returns table (unit_kerja text, id_form text, tahun int, bulan int, jumlah bigint,
               id_simpan uuid, id_hapus uuid[], contoh_isi jsonb, pertama timestamptz, terakhir timestamptz)
language sql stable security invoker set search_path = public as $$
  with g as (
    select d.id, d.unit_kerja, d.id_indikator, d.tahun, d.bulan, d.data_input, d.created_at,
           public.mutu_isi_normal(d.data_input) as isi
      from public.data_mutu_harian d
     where d.tahun = p_tahun and (p_id_form is null or d.id_indikator = p_id_form)
  )
  select g.unit_kerja, g.id_indikator, g.tahun, g.bulan, count(*),
         (array_agg(g.id order by g.created_at, g.id))[1],
         (array_agg(g.id order by g.created_at, g.id))[2:],
         (array_agg(g.data_input order by g.created_at, g.id))[1],
         min(g.created_at), max(g.created_at)
    from g
   group by g.unit_kerja, g.id_indikator, g.tahun, g.bulan, g.isi
  having count(*) > 1
   order by count(*) desc, g.id_indikator, g.unit_kerja, g.bulan
$$;

revoke execute on function public.daftar_duplikat_mutu(int, text) from public, anon;
grant  execute on function public.daftar_duplikat_mutu(int, text) to authenticated;

commit;
