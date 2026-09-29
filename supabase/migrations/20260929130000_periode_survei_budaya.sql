-- =====================================================================
-- Migrasi: Periode survei budaya keselamatan & tingkat respons
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929120000 sudah dijalankan.
--
-- Dulu survei dikelompokkan per tahun kalender dari waktu kirim, tanpa
-- penanda periode, tanpa jumlah staf, sehingga tingkat respons (response
-- rate) tidak bisa dihitung dan dua survei dalam setahun tercampur.
--   * survei_budaya_periode : nama, tanggal buka-tutup, status dibuka/ditutup,
--                             target tingkat respons (%). Hanya satu periode
--                             yang boleh dibuka pada satu waktu.
--   * survei_budaya_staf    : jumlah staf per unit untuk tiap periode
--                             (penyebut tingkat respons).
--   * data_survey_budaya.id_periode : jawaban masuk ke periode yang dibuka.
--   * kirim_survei_budaya() menolak kiriman bila tidak ada periode dibuka.
--   * survei_budaya_periode_publik() : periode yang sedang dibuka (tanpa login).
-- Data lama: jawaban dikelompokkan per tahun kiriman menjadi periode
-- "Survei Budaya Keselamatan <tahun>" (ditutup). Periode tahun berjalan
-- dibiarkan DIBUKA sampai 31 Desember agar formulir tetap berjalan; ubah
-- tanggal/status di Dasbor Budaya > Kelola Periode.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create table if not exists public.survei_budaya_periode (
  id               uuid primary key default gen_random_uuid(),
  nama             text not null,
  tanggal_mulai    date not null,
  tanggal_selesai  date not null,
  status           text not null default 'dibuka' check (status in ('dibuka', 'ditutup')),
  target_respons   numeric(5,2) default 60 check (target_respons is null or target_respons between 0 and 100),
  catatan          text,
  dibuat_oleh      text,
  dibuat_pada      timestamptz not null default now(),
  check (tanggal_selesai >= tanggal_mulai)
);
create unique index if not exists survei_budaya_periode_satu_dibuka on public.survei_budaya_periode ((true)) where status = 'dibuka';

create table if not exists public.survei_budaya_staf (
  id_periode   uuid not null references public.survei_budaya_periode(id) on delete cascade,
  unit_kerja   text not null,
  jumlah_staf  int not null check (jumlah_staf > 0),
  primary key (id_periode, unit_kerja)
);

alter table public.data_survey_budaya add column if not exists id_periode uuid references public.survei_budaya_periode(id) on delete restrict;
create index if not exists data_survey_budaya_periode_idx on public.data_survey_budaya (id_periode);

-- RLS
alter table public.survei_budaya_periode enable row level security;
alter table public.survei_budaya_staf enable row level security;
grant select, insert, update, delete on public.survei_budaya_periode, public.survei_budaya_staf to authenticated;
revoke all on public.survei_budaya_periode, public.survei_budaya_staf from anon;

drop policy if exists periode_survei_baca on public.survei_budaya_periode;
create policy periode_survei_baca on public.survei_budaya_periode for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists periode_survei_tulis on public.survei_budaya_periode;
create policy periode_survei_tulis on public.survei_budaya_periode for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));
drop policy if exists staf_survei_baca on public.survei_budaya_staf;
create policy staf_survei_baca on public.survei_budaya_staf for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists staf_survei_tulis on public.survei_budaya_staf;
create policy staf_survei_tulis on public.survei_budaya_staf for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

drop trigger if exists audit_survei_budaya_periode on public.survei_budaya_periode;
create trigger audit_survei_budaya_periode after insert or update or delete on public.survei_budaya_periode
  for each row execute function public.audit_catat('id');

create or replace function public.isi_pembuat_periode_survei()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.dibuat_oleh := coalesce((select nama_lengkap from public.profiles where id = auth.uid()), new.dibuat_oleh, 'sistem');
  end if;
  return new;
end $$;
drop trigger if exists isi_pembuat_periode_survei on public.survei_budaya_periode;
create trigger isi_pembuat_periode_survei before insert on public.survei_budaya_periode
  for each row execute function public.isi_pembuat_periode_survei();

-- Konversi data lama: satu periode per tahun kiriman
do $$
declare
  r record;
  v_id uuid;
  v_thn_ini int := extract(year from current_date)::int;
begin
  perform set_config('mutu.lewati_audit', 'on', true);
  for r in select distinct extract(year from "timestamp")::int as thn
             from public.data_survey_budaya where id_periode is null and "timestamp" is not null order by 1 loop
    select id into v_id from public.survei_budaya_periode
     where tanggal_mulai = make_date(r.thn, 1, 1) and tanggal_selesai = make_date(r.thn, 12, 31) limit 1;
    if v_id is null then
      insert into public.survei_budaya_periode (nama, tanggal_mulai, tanggal_selesai, status, catatan, dibuat_oleh)
      values ('Survei Budaya Keselamatan ' || r.thn, make_date(r.thn, 1, 1), make_date(r.thn, 12, 31),
              case when r.thn = v_thn_ini and not exists (select 1 from public.survei_budaya_periode where status = 'dibuka')
                   then 'dibuka' else 'ditutup' end,
              'Dibuat otomatis dari data survei tahun ' || r.thn, 'sistem')
      returning id into v_id;
    end if;
    update public.data_survey_budaya set id_periode = v_id
     where id_periode is null and extract(year from "timestamp")::int = r.thn;
  end loop;
  -- Tidak ada periode dibuka sama sekali -> buka periode tahun berjalan agar formulir tetap berfungsi
  if not exists (select 1 from public.survei_budaya_periode where status = 'dibuka')
     and not exists (select 1 from public.survei_budaya_periode where tanggal_mulai = make_date(v_thn_ini, 1, 1) and tanggal_selesai = make_date(v_thn_ini, 12, 31)) then
    insert into public.survei_budaya_periode (nama, tanggal_mulai, tanggal_selesai, status, catatan, dibuat_oleh)
    values ('Survei Budaya Keselamatan ' || v_thn_ini, make_date(v_thn_ini, 1, 1), make_date(v_thn_ini, 12, 31), 'dibuka',
            'Dibuat otomatis saat migrasi periode survei', 'sistem');
  end if;
  perform set_config('mutu.lewati_audit', 'off', true);
end $$;

-- Periode yang sedang dibuka (untuk formulir tanpa login)
create or replace function public.survei_budaya_periode_publik()
returns table (id uuid, nama text, tanggal_mulai date, tanggal_selesai date)
language sql stable security definer set search_path = public as $$
  select id, nama, tanggal_mulai, tanggal_selesai from public.survei_budaya_periode
   where status = 'dibuka' and current_date between tanggal_mulai and tanggal_selesai
   limit 1
$$;
revoke execute on function public.survei_budaya_periode_publik() from public;
grant execute on function public.survei_budaya_periode_publik() to anon, authenticated;

-- Kirim survei: hanya saat periode dibuka
create or replace function public.kirim_survei_budaya(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_periode uuid;
begin
  -- Anti-spam: maks. 300 / 60 menit per IP (survei massal dari jaringan RS).
  perform public._cek_batas_kiriman('survei', 300, 60);

  select id into v_periode from public.survei_budaya_periode_publik();
  if v_periode is null then
    raise exception 'Survei budaya keselamatan sedang tidak dibuka.';
  end if;
  if not exists (select 1 from public.master_unit where nama_unit = trim(coalesce(p ->> 'unit_kerja', ''))) then
    raise exception 'Unit kerja wajib dipilih dari daftar.';
  end if;
  if length(coalesce(p ->> 'profesi', '')) = 0 or length(p ->> 'profesi') > 100 then
    raise exception 'Profesi wajib diisi.';
  end if;
  if jsonb_typeof(p -> 'jawaban_survey') <> 'object' or length((p -> 'jawaban_survey')::text) > 30000 then
    raise exception 'Format jawaban survei tidak valid.';
  end if;

  insert into public.data_survey_budaya (unit_kerja, profesi, jawaban_survey, id_periode)
  values (trim(p ->> 'unit_kerja'), trim(p ->> 'profesi'), p -> 'jawaban_survey', v_periode);
end $$;
revoke execute on function public.kirim_survei_budaya(jsonb) from public;
grant execute on function public.kirim_survei_budaya(jsonb) to anon, authenticated;

commit;
