-- =====================================================================
-- Migrasi: Jejak Audit (audit trail)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928030000 sudah dijalankan.
--
-- Setiap INSERT / UPDATE / DELETE pada tabel data & master dicatat
-- OTOMATIS oleh trigger database: siapa (akun, nama, role), kapan, tabel,
-- baris mana, nilai lama & baru, serta kolom yang berubah.
--
--   * Tidak bisa dilewati dari browser (trigger berjalan di database).
--   * Tidak bisa diubah/dihapus lewat aplikasi — termasuk oleh admin.
--   * Hanya role administrator yang bisa membaca (log berisi data pasien).
--   * Survei budaya TIDAK diaudit, untuk menjaga anonimitas responden.
--   * Tutup Tahun dicatat sebagai 1 entri ringkasan (bukan ribuan baris),
--     karena data mentahnya sudah tersimpan utuh di data_mutu_harian_arsip.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- 1. Tabel log
create table if not exists public.audit_log (
  id              bigserial primary key,
  waktu           timestamptz not null default now(),
  user_id         uuid,
  user_email      text,
  user_nama       text,
  user_role       text,
  tabel           text not null,
  aksi            text not null check (aksi in ('INSERT', 'UPDATE', 'DELETE', 'TUTUP_TAHUN')),
  id_baris        text,
  kolom_berubah   text[],
  data_lama       jsonb,
  data_baru       jsonb
);

create index if not exists audit_log_waktu_idx  on public.audit_log (waktu desc);
create index if not exists audit_log_tabel_idx  on public.audit_log (tabel, waktu desc);
create index if not exists audit_log_user_idx   on public.audit_log (user_id, waktu desc);
create index if not exists audit_log_baris_idx  on public.audit_log (tabel, id_baris);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated using (public.mutu_is_admin());
-- Sengaja TANPA policy insert/update/delete: hanya trigger (security definer) yang menulis.

-- 2. Fungsi trigger
create or replace function public.audit_catat()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kolom_id text := tg_argv[0];
  v_lama     jsonb;
  v_baru     jsonb;
  v_berubah  text[];
  v_uid      uuid := auth.uid();   -- NULL jika dari SQL Editor / service role
  v_nama     text;
  v_role     text;
  v_email    text;
begin
  -- Dilewati saat Tutup Tahun (dicatat terpisah sebagai 1 entri ringkasan)
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then v_lama := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_baru := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_berubah
      from jsonb_object_keys(v_baru) k
     where v_baru -> k is distinct from v_lama -> k;
    if v_berubah is null then
      return null;  -- tidak ada yang benar-benar berubah
    end if;
  end if;

  if v_uid is not null then
    select nama_lengkap, role into v_nama, v_role from public.profiles where id = v_uid;
    select email into v_email from auth.users where id = v_uid;
  end if;

  insert into public.audit_log
    (user_id, user_email, user_nama, user_role, tabel, aksi, id_baris, kolom_berubah, data_lama, data_baru)
  values (
    v_uid,
    coalesce(v_email, case when v_uid is null then 'sistem (SQL Editor / Edge Function)' end),
    v_nama,
    v_role,
    tg_table_name,
    tg_op,
    coalesce(v_baru ->> v_kolom_id, v_lama ->> v_kolom_id),
    v_berubah,
    v_lama,
    v_baru
  );
  return null;
end $$;

revoke execute on function public.audit_catat() from public, anon, authenticated;

-- 3. Pasang trigger (nama kolom kunci dikirim sebagai argumen)
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('data_mutu_harian',   'id'),
      ('data_insiden',       'id_insiden'),
      ('data_risiko',        'id_risiko'),
      ('data_pdsa',          'id_pdsa'),
      ('data_fmea',          'id_proyek'),
      ('data_validasi',      'id_validasi'),
      ('arsip_capaian_mutu', 'id'),
      ('master_indikator',   'id_indikator'),
      ('master_unit',        'id'),
      ('setup_formulir',     'id_form'),
      ('role_permissions',   'role'),
      ('profiles',           'id')
    ) as x(tabel, kolom_id)
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t.tabel);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.audit_catat(%2$L)', t.tabel, t.kolom_id);
  end loop;
end $$;

-- 4. Tutup Tahun: lewati audit per baris, catat 1 entri ringkasan
--    (fungsi sama seperti migrasi 20260928030000, ditambah 2 baris audit)
create or replace function public.tutup_tahun_mutu(
  p_tahun int,
  p_jumlah_baris int,
  p_ringkasan jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_jumlah_db   int;
  v_arsip_masuk int;
  v_dipindah    int;
  v_hasil       jsonb;
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya role administrator yang dapat menjalankan Tutup Tahun.';
  end if;

  if p_tahun is null or p_tahun >= extract(year from now() at time zone 'Asia/Jakarta')::int then
    raise exception 'Tutup Tahun hanya untuk tahun yang sudah berakhir.';
  end if;

  if jsonb_typeof(p_ringkasan) is distinct from 'array' then
    raise exception 'Format ringkasan tidak valid.';
  end if;

  lock table public.data_mutu_harian in share row exclusive mode;

  select count(*) into v_jumlah_db from public.data_mutu_harian where tahun = p_tahun;

  if v_jumlah_db = 0 then
    raise exception 'Tidak ada data mentah untuk tahun %.', p_tahun;
  end if;

  if v_jumlah_db <> p_jumlah_baris then
    raise exception 'Jumlah data tidak cocok: aplikasi menghitung % baris, database berisi % baris. Proses dibatalkan, tidak ada data yang berubah. Muat ulang halaman lalu coba lagi.',
      p_jumlah_baris, v_jumlah_db;
  end if;

  if exists (select 1 from public.arsip_capaian_mutu where tahun = p_tahun) then
    raise exception 'Tahun % sudah pernah ditutup (arsip capaian sudah ada).', p_tahun;
  end if;

  -- Audit per baris dimatikan hanya di dalam transaksi ini
  perform set_config('mutu.lewati_audit', 'on', true);

  insert into public.arsip_capaian_mutu
    (tahun, bulan, id_indikator, judul_indikator, kategori_indikator, unit_pelaksana,
     numerator, denominator, capaian, target, satuan, is_tercapai)
  select tahun, bulan, id_indikator, judul_indikator, kategori_indikator, unit_pelaksana,
         numerator, denominator, capaian, target, satuan, is_tercapai
    from jsonb_populate_recordset(null::public.arsip_capaian_mutu, p_ringkasan);
  get diagnostics v_arsip_masuk = row_count;

  insert into public.data_mutu_harian_arsip
  select d.*, now(), auth.uid()
    from public.data_mutu_harian d
   where d.tahun = p_tahun;
  get diagnostics v_dipindah = row_count;

  delete from public.data_mutu_harian where tahun = p_tahun;

  perform set_config('mutu.lewati_audit', 'off', true);

  v_hasil := jsonb_build_object(
    'tahun', p_tahun,
    'ringkasan_disimpan', v_arsip_masuk,
    'data_mentah_dipindah', v_dipindah
  );

  insert into public.audit_log (user_id, user_email, user_nama, user_role, tabel, aksi, id_baris, data_baru)
  select auth.uid(), u.email, p.nama_lengkap, p.role, 'data_mutu_harian', 'TUTUP_TAHUN', p_tahun::text, v_hasil
    from (select 1) x
    left join public.profiles p on p.id = auth.uid()
    left join auth.users u on u.id = auth.uid();

  return v_hasil;
end $$;

revoke execute on function public.tutup_tahun_mutu(int, int, jsonb) from public, anon;
grant  execute on function public.tutup_tahun_mutu(int, int, jsonb) to authenticated;

commit;

-- Cek:
-- select waktu, user_email, tabel, aksi, id_baris, kolom_berubah
--   from public.audit_log order by waktu desc limit 20;
