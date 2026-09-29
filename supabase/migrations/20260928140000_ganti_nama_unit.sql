-- =====================================================================
-- Migrasi: Ganti nama / gabung unit dengan aman
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928130000 sudah dijalankan.
--
-- Masalah: data mutu, insiden, risiko, PDSA, validasi, akun, dll. menyimpan
-- NAMA unit sebagai teks. Mengubah nama di master_unit saja membuat data
-- lama "terputus" dari unitnya (tidak muncul di laporan unit, staf tidak
-- bisa melihat data unitnya sendiri).
--
-- 1. ganti_nama_unit(lama, baru, gabung, uji)
--    Mengganti nama unit di SEMUA tabel sekaligus dalam satu transaksi.
--    Kolom yang diperbarui dicari otomatis: setiap kolom teks bernama
--    unit_kerja / unit_pelaksana / unit_pelapor / unit_terkait / unit_penyebab
--    di skema public (kecuali audit_log), plus master_unit.nama_unit dan
--    data_insiden.detail_spesifik->unit_penyebab.
--      uji = true    -> hanya menghitung baris yang akan berubah (pratinjau)
--      gabung = true -> bila nama baru sudah ada, kedua unit DIGABUNG
--                       (daftar formulir disatukan, unit lama dihapus)
--    Periode terkunci tetap ikut diganti namanya (bukan mengubah isi data).
--    Tercatat 1 entri ringkasan di Log Audit (aksi GANTI_NAMA_UNIT).
--    pemakaian_unit(nama): jumlah baris per tabel yang memakai nama unit
--    (dipakai sebelum menghapus unit).
--
-- 2. daftar_unit_tak_terdaftar()
--    Nama unit yang dipakai di data tetapi TIDAK ada di master_unit
--    (misal dari data lama / salah ketik), untuk digabungkan ke unit resmi.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- Aksi baru di Log Audit
alter table public.audit_log drop constraint if exists audit_log_aksi_check;
alter table public.audit_log add constraint audit_log_aksi_check
  check (aksi in ('INSERT', 'UPDATE', 'DELETE', 'TUTUP_TAHUN', 'IMPOR', 'GANTI_NAMA_UNIT'));

-- ---------------------------------------------------------------------
-- Kolom yang menyimpan nama unit (dicari dari katalog, jadi tabel baru
-- yang memakai nama kolom yang sama otomatis ikut)
-- ---------------------------------------------------------------------
create or replace function public._mutu_kolom_unit()
returns table (tabel text, kolom text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select c.relname::text, a.attname::text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p')
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where a.attnum > 0 and not a.attisdropped
     and a.atttypid in ('text'::regtype, 'varchar'::regtype)
     and a.attname in ('unit_kerja', 'unit_pelaksana', 'unit_pelapor', 'unit_terkait', 'unit_penyebab')
     and c.relname not in ('audit_log')
   order by 1, 2
$$;
revoke execute on function public._mutu_kolom_unit() from public, anon, authenticated;

-- Berapa baris di setiap tabel yang memakai nama unit ini
create or replace function public.pemakaian_unit(p_nama text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_n bigint;
  v_jumlah jsonb := '{}'::jsonb;
  v_total bigint := 0;
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya administrator yang boleh melihat pemakaian unit.';
  end if;
  for r in select * from public._mutu_kolom_unit() loop
    execute format('select count(*) from public.%I where %I = $1', r.tabel, r.kolom) into v_n using p_nama;
    if v_n > 0 then
      v_jumlah := v_jumlah || jsonb_build_object(r.tabel || '.' || r.kolom, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.data_insiden') and attname = 'detail_spesifik'
                and atttypid = 'jsonb'::regtype and not attisdropped) then
    execute $q$select count(*) from public.data_insiden where detail_spesifik ->> 'unit_penyebab' = $1$q$ into v_n using p_nama;
    if v_n > 0 then
      v_jumlah := v_jumlah || jsonb_build_object('data_insiden.detail_spesifik.unit_penyebab', v_n);
      v_total := v_total + v_n;
    end if;
  end if;
  return jsonb_build_object('jumlah', v_jumlah, 'total', v_total);
end $$;
revoke execute on function public.pemakaian_unit(text) from public, anon;
grant  execute on function public.pemakaian_unit(text) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Ganti nama / gabung unit
-- ---------------------------------------------------------------------
create or replace function public.ganti_nama_unit(p_lama text, p_baru text,
                                                  p_gabung boolean default false,
                                                  p_uji boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_baru      text := btrim(coalesce(p_baru, ''));
  v_id_lama   uuid;
  v_id_target uuid;
  v_nama_ada  text;
  v_gabung    boolean := false;
  v_jumlah    jsonb := '{}'::jsonb;
  v_total     bigint := 0;
  v_n         bigint;
  r           record;
  v_ada_detail boolean;
  v_form_lama text;
  v_form_target text;
  v_hasil     jsonb;
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya administrator yang boleh mengganti nama unit.';
  end if;
  if coalesce(p_lama, '') = '' then raise exception 'Nama unit lama wajib diisi.'; end if;
  if v_baru = '' then raise exception 'Nama unit baru wajib diisi.'; end if;
  if v_baru = p_lama then
    return jsonb_build_object('status', 'sama', 'jumlah', '{}'::jsonb, 'total', 0);
  end if;

  -- Satu proses ganti nama pada satu waktu
  perform pg_advisory_xact_lock(hashtextextended('mutu|ganti_nama_unit', 0));

  select id into v_id_lama from public.master_unit where nama_unit = p_lama limit 1;

  -- Nama baru sudah dipakai unit LAIN? (tanpa beda huruf besar/kecil)
  select id, nama_unit into v_id_target, v_nama_ada
    from public.master_unit
   where lower(btrim(nama_unit)) = lower(v_baru)
     and id is distinct from v_id_lama
   limit 1;

  if v_id_target is not null then
    if not p_gabung then
      return jsonb_build_object('status', 'sudah_ada', 'nama_ada', v_nama_ada);
    end if;
    v_gabung := true;
    v_baru := v_nama_ada;   -- ikuti ejaan unit yang sudah ada
  end if;

  if p_uji then
    return jsonb_build_object('status', 'uji', 'lama', p_lama, 'baru', v_baru, 'gabung', v_gabung,
                              'unit_terdaftar', v_id_lama is not null)
           || public.pemakaian_unit(p_lama);
  end if;

  -- Lewati penjaga kunci periode & audit per baris (diganti 1 entri ringkasan)
  perform set_config('mutu.lewati_audit', 'on', true);

  -- Kunci periode: bila digabung, kunci unit lama yang bentrok dengan unit tujuan dibuang
  if to_regclass('public.kunci_periode_mutu') is not null then
    delete from public.kunci_periode_mutu k
     where k.unit_kerja = p_lama
       and exists (select 1 from public.kunci_periode_mutu k2
                    where k2.unit_kerja = v_baru and k2.tahun = k.tahun and k2.bulan = k.bulan);
  end if;

  for r in select * from public._mutu_kolom_unit() loop
    execute format('update public.%I set %I = $2 where %I = $1', r.tabel, r.kolom, r.kolom) using p_lama, v_baru;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_jumlah := v_jumlah || jsonb_build_object(r.tabel || '.' || r.kolom, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  -- Unit penyebab di detail laporan insiden (JSON)
  select exists (select 1 from pg_attribute
                  where attrelid = to_regclass('public.data_insiden') and attname = 'detail_spesifik'
                    and atttypid = 'jsonb'::regtype and not attisdropped)
    into v_ada_detail;
  if v_ada_detail then
    execute $q$update public.data_insiden
                  set detail_spesifik = jsonb_set(detail_spesifik, '{unit_penyebab}', to_jsonb($2::text))
                where detail_spesifik ->> 'unit_penyebab' = $1$q$ using p_lama, v_baru;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_jumlah := v_jumlah || jsonb_build_object('data_insiden.detail_spesifik.unit_penyebab', v_n);
      v_total := v_total + v_n;
    end if;
  end if;

  -- Master unit
  if v_id_lama is not null then
    if v_gabung then
      -- Satukan daftar formulir (urutan: milik unit tujuan dulu), lalu hapus unit lama
      select daftar_form into v_form_target from public.master_unit where id = v_id_target;
      select daftar_form into v_form_lama   from public.master_unit where id = v_id_lama;
      update public.master_unit
         set daftar_form = (
               select string_agg(f, ',' order by urut)
                 from (select f, min(urut) as urut
                         from (select btrim(x) as f, o as urut
                                 from unnest(string_to_array(coalesce(v_form_target, ''), ',')) with ordinality u(x, o)
                               union all
                               select btrim(x), 100000 + o
                                 from unnest(string_to_array(coalesce(v_form_lama, ''), ',')) with ordinality u(x, o)) s
                        where f <> ''
                        group by f) g)
       where id = v_id_target;
      delete from public.master_unit where id = v_id_lama;
    else
      update public.master_unit set nama_unit = v_baru where id = v_id_lama;
    end if;
  end if;

  v_hasil := jsonb_build_object(
    'status', 'ok',
    'lama', p_lama, 'baru', v_baru,
    'gabung', v_gabung,
    'unit_terdaftar', v_id_lama is not null,
    'jumlah', v_jumlah, 'total', v_total);

  perform set_config('mutu.lewati_audit', 'off', true);
  insert into public.audit_log (user_id, user_email, user_nama, user_role, tabel, aksi, id_baris, data_lama, data_baru)
  select auth.uid(), u.email, p.nama_lengkap, p.role, 'master_unit', 'GANTI_NAMA_UNIT', p_lama,
         jsonb_build_object('nama_unit', p_lama), v_hasil
    from (select 1) x
    left join public.profiles p on p.id = auth.uid()
    left join auth.users u on u.id = auth.uid();

  return v_hasil;
end $$;

revoke execute on function public.ganti_nama_unit(text, text, boolean, boolean) from public, anon;
grant  execute on function public.ganti_nama_unit(text, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nama unit di data yang tidak terdaftar di master_unit
-- ---------------------------------------------------------------------
create or replace function public.daftar_unit_tak_terdaftar()
returns table (nama text, total bigint, rincian jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_sql text := '';
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya administrator yang boleh melihat daftar ini.';
  end if;

  for r in select * from public._mutu_kolom_unit() loop
    v_sql := v_sql || case when v_sql = '' then '' else ' union all ' end
          || format('select %I::text as nama, %L as asal, count(*) as n from public.%I where %I is not null group by 1',
                    r.kolom, r.tabel || '.' || r.kolom, r.tabel, r.kolom);
  end loop;
  if v_sql = '' then return; end if;

  return query execute
    'select s.nama, sum(s.n)::bigint, jsonb_object_agg(s.asal, s.n)
       from (' || v_sql || ') s
      where btrim(s.nama) <> ''''
        and lower(btrim(s.nama)) not in (''non-unit'', ''-'', ''semua'', ''semua unit'', ''rs_all'')
        and lower(btrim(s.nama)) not like ''semua unit%''
        and not exists (select 1 from public.master_unit m where m.nama_unit = s.nama)
      group by s.nama
      order by 2 desc, 1';
end $$;

revoke execute on function public.daftar_unit_tak_terdaftar() from public, anon;
grant  execute on function public.daftar_unit_tak_terdaftar() to authenticated;

commit;

-- Cek (pratinjau, tidak mengubah apa pun):
-- select public.ganti_nama_unit('ICU', 'Intensive Care Unit', false, true);
