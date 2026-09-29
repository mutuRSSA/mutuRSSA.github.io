-- =====================================================================
-- Migrasi: Alur penanganan insiden (IKP/KPC) & tindak lanjut rekomendasi
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929110000 sudah dijalankan
--           (memakai grading database dari migrasi 18).
--
-- Status   : Baru -> Investigasi -> Tindak Lanjut -> Selesai   (atau Ditolak)
--   * Baru          : laporan masuk, belum diverifikasi Komite.
--   * Investigasi   : Komite memverifikasi & menetapkan jenis investigasi.
--                     Kuning/Merah (kecuali KPC) & Sentinel WAJIB RCA. Batas waktu dihitung
--                     dari tanggal insiden: RCA 45 hari, Hijau 14 hari, Biru 7 hari.
--   * Tindak Lanjut : hasil investigasi tersimpan; rekomendasi pertama otomatis
--                     menjadi baris tindak lanjut (tindakan, PIC, tenggat,
--                     status, bukti); Komite dapat menambah baris lain.
--   * Selesai       : semua tindak lanjut selesai/batal (ditutup otomatis),
--                     atau ditutup Komite bila tidak ada tindak lanjut.
--   * Ditolak       : bukan insiden / laporan ganda (alasan wajib).
-- Pelaporan eksternal (e-reporting KNKP/SIKP): tanggal & nomor laporan.
-- Kejadian Sentinel wajib dilaporkan dalam 2x24 jam (ditandai di daftar).
-- Keterlambatan lapor internal (> 2x24 jam dari waktu insiden) ditandai di daftar.
--
-- Data lama: status kosong -> Baru; "Selesai" tetap Selesai.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.data_insiden add column if not exists jenis_investigasi    text;
alter table public.data_insiden add column if not exists batas_investigasi    date;
alter table public.data_insiden add column if not exists diverifikasi_oleh    text;
alter table public.data_insiden add column if not exists diverifikasi_pada    timestamptz;
alter table public.data_insiden add column if not exists alasan_ditolak       text;
alter table public.data_insiden add column if not exists lapor_eksternal_pada date;
alter table public.data_insiden add column if not exists lapor_eksternal_nomor text;
alter table public.data_insiden add column if not exists selesai_pada         timestamptz;

-- Status lama -> status baru
do $$
begin
  perform set_config('mutu.lewati_audit', 'on', true);
  update public.data_insiden
     set status_investigasi = case when status_investigasi ilike '%selesai%' then 'Selesai'
                                   when status_investigasi ilike '%tolak%' then 'Ditolak'
                                   else 'Baru' end
   where status_investigasi is null
      or status_investigasi not in ('Baru', 'Investigasi', 'Tindak Lanjut', 'Selesai', 'Ditolak');
  -- Jenis investigasi dari hasil investigasi lama (RCA punya isian masalah CMP/SDP)
  update public.data_insiden
     set jenis_investigasi = case when investigasi_komite ? 'masalah_cmp' then 'rca' else 'sederhana' end
   where jenis_investigasi is null and investigasi_komite is not null;
  perform set_config('mutu.lewati_audit', 'off', true);
end $$;

alter table public.data_insiden alter column status_investigasi set default 'Baru';
alter table public.data_insiden drop constraint if exists data_insiden_status_alur_check;
alter table public.data_insiden add constraint data_insiden_status_alur_check
  check (status_investigasi in ('Baru', 'Investigasi', 'Tindak Lanjut', 'Selesai', 'Ditolak'));
alter table public.data_insiden drop constraint if exists data_insiden_jenis_investigasi_check;
alter table public.data_insiden add constraint data_insiden_jenis_investigasi_check
  check (jenis_investigasi is null or jenis_investigasi in ('sederhana', 'rca'));

-- ---------------------------------------------------------------------
-- Tindak lanjut rekomendasi
-- ---------------------------------------------------------------------
create table if not exists public.insiden_tindak_lanjut (
  id           uuid primary key default gen_random_uuid(),
  id_insiden   uuid not null references public.data_insiden(id_insiden) on delete cascade,
  rekomendasi  text,
  tindakan     text not null,
  pic          text,
  tenggat      date,
  status       text not null default 'rencana' check (status in ('rencana', 'berjalan', 'selesai', 'batal')),
  bukti        text,
  dibuat_pada  timestamptz not null default now(),
  selesai_pada timestamptz
);
create index if not exists insiden_tindak_lanjut_idx on public.insiden_tindak_lanjut (id_insiden);

alter table public.insiden_tindak_lanjut enable row level security;
grant select, insert, update, delete on public.insiden_tindak_lanjut to authenticated;
revoke all on public.insiden_tindak_lanjut from anon;
drop policy if exists tl_baca on public.insiden_tindak_lanjut;
create policy tl_baca on public.insiden_tindak_lanjut for select to authenticated
  using ((select public.mutu_is_admin())
         or exists (select 1 from public.data_insiden i where i.id_insiden = insiden_tindak_lanjut.id_insiden
                     and i.unit_pelapor = (select public.mutu_unit())));
drop policy if exists tl_tulis on public.insiden_tindak_lanjut;
create policy tl_tulis on public.insiden_tindak_lanjut for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop trigger if exists audit_insiden_tindak_lanjut on public.insiden_tindak_lanjut;
create trigger audit_insiden_tindak_lanjut after insert or update or delete on public.insiden_tindak_lanjut
  for each row execute function public.audit_catat('id');

-- ---------------------------------------------------------------------
-- Penjaga alur status
-- ---------------------------------------------------------------------
create or replace function public.jaga_alur_insiden()
returns trigger language plpgsql set search_path = public as $$
declare
  v_nama text;
  v_hari int;
  v_terbuka int;
begin
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then return new; end if;

  -- Laporan baru selalu masuk sebagai "Baru" (belum diverifikasi)
  if tg_op = 'INSERT' then
    new.status_investigasi := 'Baru';
    new.jenis_investigasi := null; new.batas_investigasi := null;
    new.diverifikasi_oleh := null; new.diverifikasi_pada := null; new.selesai_pada := null;
    return new;
  end if;

  select nama_lengkap into v_nama from public.profiles where id = auth.uid();

  if new.status_investigasi in ('Investigasi', 'Tindak Lanjut') then
    if new.jenis_investigasi is null then raise exception 'Pilih jenis investigasi (sederhana atau RCA).'; end if;
    if new.jenis_investigasi = 'sederhana'
       and (new.jenis_insiden = 'Sentinel' or (coalesce(new.jenis_insiden, '') <> 'KPC' and new.grading_risiko in ('Kuning', 'Merah'))) then
      raise exception 'Insiden % dengan grading % wajib diinvestigasi dengan RCA.', new.jenis_insiden, new.grading_risiko;
    end if;
    -- Batas waktu investigasi (dari tanggal insiden): RCA 45 hari, Hijau 14 hari, Biru 7 hari
    if new.batas_investigasi is null or new.jenis_investigasi is distinct from old.jenis_investigasi
       or new.grading_risiko is distinct from old.grading_risiko then
      v_hari := case when new.jenis_investigasi = 'rca' then 45 when new.grading_risiko = 'Hijau' then 14 else 7 end;
      new.batas_investigasi := coalesce(new.waktu_insiden::date, new.waktu_lapor::date, current_date) + v_hari;
    end if;
    if new.diverifikasi_pada is null then
      new.diverifikasi_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diverifikasi_pada := now();
    end if;
    if new.status_investigasi = 'Tindak Lanjut' and new.investigasi_komite is null then
      raise exception 'Simpan hasil investigasi terlebih dahulu.';
    end if;
    new.alasan_ditolak := null;
    new.selesai_pada := null;
  elsif new.status_investigasi = 'Ditolak' then
    if coalesce(btrim(new.alasan_ditolak), '') = '' then raise exception 'Alasan penolakan wajib diisi.'; end if;
    if old.status_investigasi is distinct from 'Ditolak' then
      new.diverifikasi_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diverifikasi_pada := now();
    end if;
  elsif new.status_investigasi = 'Selesai' then
    if new.investigasi_komite is null then raise exception 'Kasus belum diinvestigasi.'; end if;
    select count(*) into v_terbuka from public.insiden_tindak_lanjut
     where id_insiden = new.id_insiden and status in ('rencana', 'berjalan');
    if v_terbuka > 0 then raise exception 'Masih ada % tindak lanjut yang belum selesai.', v_terbuka; end if;
    if old.status_investigasi is distinct from 'Selesai' then new.selesai_pada := now(); end if;
  elsif new.status_investigasi = 'Baru' then
    new.batas_investigasi := null; new.diverifikasi_oleh := null; new.diverifikasi_pada := null; new.selesai_pada := null;
  end if;
  return new;
end $$;
drop trigger if exists jaga_alur_insiden on public.data_insiden;
create trigger jaga_alur_insiden before insert or update on public.data_insiden
  for each row execute function public.jaga_alur_insiden();

-- Hasil investigasi disimpan -> rekomendasi pertama otomatis menjadi baris tindak lanjut
create or replace function public.buat_tindak_lanjut_insiden()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then return null; end if;
  if new.status_investigasi = 'Tindak Lanjut' and old.status_investigasi is distinct from 'Tindak Lanjut'
     and coalesce(btrim(new.investigasi_komite->>'tindakan_dilakukan'), btrim(new.investigasi_komite->>'rekomendasi'), '') <> ''
     and not exists (select 1 from public.insiden_tindak_lanjut t where t.id_insiden = new.id_insiden) then
    insert into public.insiden_tindak_lanjut (id_insiden, rekomendasi, tindakan, pic, tenggat)
    values (new.id_insiden,
            nullif(btrim(new.investigasi_komite->>'rekomendasi'), ''),
            coalesce(nullif(btrim(new.investigasi_komite->>'tindakan_dilakukan'), ''), btrim(new.investigasi_komite->>'rekomendasi')),
            nullif(btrim(new.investigasi_komite->>'pj_tindakan'), ''),
            nullif(new.investigasi_komite->>'tenggat_tindakan', '')::date);
  end if;
  return null;
end $$;
drop trigger if exists buat_tindak_lanjut_insiden on public.data_insiden;
create trigger buat_tindak_lanjut_insiden after update on public.data_insiden
  for each row execute function public.buat_tindak_lanjut_insiden();

-- Tindak lanjut: catat waktu selesai; kasus ditutup otomatis bila semua tindak lanjut tuntas
create or replace function public.jaga_tindak_lanjut_insiden()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'selesai' and (tg_op = 'INSERT' or old.status is distinct from 'selesai') then new.selesai_pada := now(); end if;
  if new.status <> 'selesai' then new.selesai_pada := null; end if;
  return new;
end $$;
drop trigger if exists jaga_tindak_lanjut_insiden on public.insiden_tindak_lanjut;
create trigger jaga_tindak_lanjut_insiden before insert or update on public.insiden_tindak_lanjut
  for each row execute function public.jaga_tindak_lanjut_insiden();

create or replace function public.tutup_insiden_otomatis()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.data_insiden i
     set status_investigasi = 'Selesai'
   where i.id_insiden = new.id_insiden
     and i.status_investigasi = 'Tindak Lanjut'
     and not exists (select 1 from public.insiden_tindak_lanjut t
                      where t.id_insiden = i.id_insiden and t.status in ('rencana', 'berjalan'))
     and exists (select 1 from public.insiden_tindak_lanjut t where t.id_insiden = i.id_insiden and t.status = 'selesai');
  return null;
end $$;
drop trigger if exists tutup_insiden_otomatis on public.insiden_tindak_lanjut;
create trigger tutup_insiden_otomatis after insert or update on public.insiden_tindak_lanjut
  for each row execute function public.tutup_insiden_otomatis();

commit;
