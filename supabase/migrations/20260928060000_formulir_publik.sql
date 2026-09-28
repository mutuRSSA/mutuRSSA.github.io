-- =====================================================================
-- Migrasi: Formulir IKP, KPC & Survei Budaya tanpa login
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928050000 sudah dijalankan.
--
-- Prinsip:
--   * Pengunjung tanpa login hanya bisa MENGIRIM, tidak bisa MEMBACA
--     laporan apa pun.
--   * Pengiriman lewat fungsi database (bukan insert langsung) yang:
--       - memvalidasi isi & panjang teks,
--       - hanya menerima kolom yang boleh diisi pelapor
--         (status & hasil investigasi tidak bisa diisi dari luar),
--       - membatasi jumlah kiriman per alamat IP (anti-spam).
--   * Pengguna yang login: unit & nama pelapor diambil dari profilnya
--     (tidak bisa dipalsukan), kecuali memilih anonim.
--   * Daftar unit untuk dropdown hanya mengembalikan nama unit.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- 1. Pembatas kiriman (anti-spam). IP disimpan sebagai hash, dihapus setelah 1 hari.
create table if not exists public.batas_kiriman (
  kunci  text        not null,
  waktu  timestamptz not null default now()
);
create index if not exists batas_kiriman_idx on public.batas_kiriman (kunci, waktu);
alter table public.batas_kiriman enable row level security;
revoke all on public.batas_kiriman from anon, authenticated;

create or replace function public._cek_batas_kiriman(p_jenis text, p_maks int, p_menit int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ip    text;
  v_kunci text;
  v_hitung int;
begin
  v_ip := split_part(coalesce(
            current_setting('request.headers', true)::json ->> 'x-forwarded-for',
            current_setting('request.headers', true)::json ->> 'x-real-ip', ''), ',', 1);
  v_ip := trim(v_ip);
  if v_ip = '' then return; end if;   -- tidak lewat API (mis. SQL Editor)

  v_kunci := p_jenis || ':' || md5(v_ip || ':pmkp');

  delete from public.batas_kiriman where waktu < now() - interval '1 day';

  select count(*) into v_hitung
    from public.batas_kiriman
   where kunci = v_kunci and waktu > now() - make_interval(mins => p_menit);

  if v_hitung >= p_maks then
    raise exception 'Terlalu banyak kiriman dari jaringan ini. Silakan coba lagi dalam % menit.', p_menit
      using errcode = 'P0001';
  end if;

  insert into public.batas_kiriman (kunci) values (v_kunci);
end $$;
revoke execute on function public._cek_batas_kiriman(text, int, int) from public, anon, authenticated;

-- 2. Daftar nama unit (untuk dropdown formulir publik)
create or replace function public.daftar_unit_publik()
returns table (nama_unit text)
language sql stable security definer set search_path = public as $$
  select nama_unit from public.master_unit
   where coalesce(trim(nama_unit), '') <> ''
   order by nama_unit
$$;
revoke execute on function public.daftar_unit_publik() from public;
grant execute on function public.daftar_unit_publik() to anon, authenticated;

-- 3. Kirim laporan insiden (IKP / KPC)
create or replace function public.lapor_insiden(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_p_nama  text;   -- nama & unit dari profil (hanya jika login)
  v_p_unit  text;
  v_anonim  boolean := coalesce((p ->> 'anonim')::boolean, false);
  v_unit    text;
  v_nama    text;
  v_waktu   timestamp;
  v_detail  jsonb := coalesce(p -> 'detail_spesifik', '{}'::jsonb);
  v_id      uuid;
  v_jenis   text := trim(coalesce(p ->> 'jenis_insiden', ''));
  v_grading text := trim(coalesce(p ->> 'grading_risiko', ''));
begin
  -- Anti-spam: maks. 30 laporan / 60 menit per IP.
  -- (Longgar karena seluruh jaringan RS biasanya keluar lewat 1 IP publik.)
  perform public._cek_batas_kiriman('insiden', 30, 60);

  if v_jenis not in ('KNC', 'KTC', 'KTD', 'Sentinel', 'KPC') then
    raise exception 'Jenis insiden tidak valid.';
  end if;
  if v_grading not in ('Biru', 'Hijau', 'Kuning', 'Merah') then
    raise exception 'Grading risiko tidak valid.';
  end if;
  if length(coalesce(p ->> 'kronologi', '')) < 10 then
    raise exception 'Kronologi wajib diisi (minimal 10 karakter).';
  end if;
  if length(coalesce(p ->> 'kronologi', '')) > 10000
     or length(coalesce(p ->> 'tindakan_segera', '')) > 5000
     or length(coalesce(p ->> 'nama_pasien', '')) > 200
     or length(coalesce(p ->> 'no_rm', '')) > 50
     or length(coalesce(p ->> 'nama_pelapor', '')) > 150
     or length(coalesce(p ->> 'pelaksana_tindakan', '')) > 300
     or length(coalesce(p ->> 'lokasi_kejadian', '')) > 200
     or jsonb_typeof(v_detail) <> 'object'
     or length(v_detail::text) > 20000 then
    raise exception 'Isian terlalu panjang atau format tidak valid.';
  end if;

  begin
    v_waktu := (p ->> 'waktu_insiden')::timestamp;
  exception when others then
    raise exception 'Waktu insiden tidak valid.';
  end;
  if v_waktu is null or v_waktu > (now() at time zone 'Asia/Jakarta') + interval '1 hour' then
    raise exception 'Waktu insiden tidak boleh di masa depan.';
  end if;

  -- Unit & nama pelapor
  if v_uid is not null then
    select nama_lengkap, unit_kerja into v_p_nama, v_p_unit
      from public.profiles where id = v_uid and status = 'Aktif';
  end if;

  if v_p_unit is not null and v_p_unit <> 'Non-Unit' then
    v_unit := v_p_unit;                         -- login: pakai unit dari profil
  else
    v_unit := trim(coalesce(p ->> 'unit_pelapor', ''));    -- tanpa login / Non-Unit: dari formulir
    if not exists (select 1 from public.master_unit where nama_unit = v_unit) then
      raise exception 'Unit pelapor wajib dipilih dari daftar.';
    end if;
  end if;

  if v_anonim then
    v_nama := 'Anonim';
  elsif v_p_nama is not null then
    v_nama := v_p_nama;
  else
    v_nama := coalesce(nullif(trim(p ->> 'nama_pelapor'), ''), 'Anonim');
  end if;

  -- Tandai laporan yang dikirim tanpa login (untuk verifikasi Komite)
  v_detail := v_detail || jsonb_build_object('dilaporkan_tanpa_login', v_uid is null);

  insert into public.data_insiden
    (jenis_insiden, waktu_insiden, unit_pelapor, lokasi_kejadian, nama_pasien, no_rm,
     kronologi, tindakan_segera, pelaksana_tindakan, skor_dampak, skor_probabilitas,
     grading_risiko, nama_pelapor, detail_spesifik)
  values
    (v_jenis, v_waktu, v_unit, nullif(trim(p ->> 'lokasi_kejadian'), ''),
     coalesce(nullif(trim(p ->> 'nama_pasien'), ''), '-'),
     coalesce(nullif(trim(p ->> 'no_rm'), ''), '-'),
     trim(p ->> 'kronologi'), trim(coalesce(p ->> 'tindakan_segera', '')),
     trim(coalesce(p ->> 'pelaksana_tindakan', '')),
     least(greatest(coalesce((p ->> 'skor_dampak')::int, 0), 0), 5),
     least(greatest(coalesce((p ->> 'skor_probabilitas')::int, 0), 0), 5),
     v_grading, v_nama, v_detail)
  returning id_insiden into v_id;

  return v_id;
end $$;
revoke execute on function public.lapor_insiden(jsonb) from public;
grant execute on function public.lapor_insiden(jsonb) to anon, authenticated;

-- 4. Kirim survei budaya keselamatan (anonim)
create or replace function public.kirim_survei_budaya(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Anti-spam: maks. 300 / 60 menit per IP (survei massal dari jaringan RS).
  perform public._cek_batas_kiriman('survei', 300, 60);

  if not exists (select 1 from public.master_unit where nama_unit = trim(coalesce(p ->> 'unit_kerja', ''))) then
    raise exception 'Unit kerja wajib dipilih dari daftar.';
  end if;
  if length(coalesce(p ->> 'profesi', '')) = 0 or length(p ->> 'profesi') > 100 then
    raise exception 'Profesi wajib diisi.';
  end if;
  if jsonb_typeof(p -> 'jawaban_survey') <> 'object' or length((p -> 'jawaban_survey')::text) > 30000 then
    raise exception 'Format jawaban survei tidak valid.';
  end if;

  insert into public.data_survey_budaya (unit_kerja, profesi, jawaban_survey)
  values (trim(p ->> 'unit_kerja'), trim(p ->> 'profesi'), p -> 'jawaban_survey');
end $$;
revoke execute on function public.kirim_survei_budaya(jsonb) from public;
grant execute on function public.kirim_survei_budaya(jsonb) to anon, authenticated;

-- 5. Insert langsung ke tabel tidak lagi diperlukan: semua lewat fungsi di atas
drop policy if exists insiden_insert on public.data_insiden;
drop policy if exists survey_insert  on public.data_survey_budaya;

-- 6. Log audit: bedakan kiriman publik (tanpa login) dari perubahan sistem
create or replace function public.audit_catat()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kolom_id text := tg_argv[0];
  v_lama     jsonb;
  v_baru     jsonb;
  v_berubah  text[];
  v_uid      uuid := auth.uid();   -- NULL jika tanpa login / SQL Editor / service role
  v_nama     text;
  v_role     text;
  v_email    text;
  v_jwt_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
begin
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
      return null;
    end if;
  end if;

  if v_uid is not null then
    select nama_lengkap, role into v_nama, v_role from public.profiles where id = v_uid;
    select email into v_email from auth.users where id = v_uid;
  elsif v_jwt_role = 'anon' then
    v_email := 'publik (tanpa login)';
  else
    v_email := 'sistem (SQL Editor / Edge Function)';
  end if;

  insert into public.audit_log
    (user_id, user_email, user_nama, user_role, tabel, aksi, id_baris, kolom_berubah, data_lama, data_baru)
  values (v_uid, v_email, v_nama, v_role, tg_table_name, tg_op,
          coalesce(v_baru ->> v_kolom_id, v_lama ->> v_kolom_id),
          v_berubah, v_lama, v_baru);
  return null;
end $$;
revoke execute on function public.audit_catat() from public, anon, authenticated;

commit;
