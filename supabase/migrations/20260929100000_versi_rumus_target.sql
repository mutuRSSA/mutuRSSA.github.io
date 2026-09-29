-- =====================================================================
-- Migrasi: Riwayat versi rumus & target indikator
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929090000 sudah dijalankan.
--
-- Masalah: mengubah rumus/target di Profil Indikator dulu ikut mengubah
-- capaian bulan-bulan yang sudah lewat, sehingga laporan yang sudah
-- diserahkan bisa berbeda angkanya bila dibuka lagi.
--
-- Solusi:
--   * master_indikator_versi: satu baris per versi (rumus N/D, satuan,
--     target, arah, formulir, unit pelaksana) dengan tanggal BERLAKU MULAI
--     (tanggal 1 suatu bulan). Versi berlaku sampai versi berikutnya.
--   * Setiap perubahan kolom tersebut di master_indikator otomatis membuat
--     versi baru. Bulan mulai berlaku dikirim lewat kolom
--     master_indikator.berlaku_mulai (diisi Profil Indikator):
--       - diisi (mis. 2026-10-01): bulan sebelumnya tetap memakai versi lama;
--       - kosong: KOREKSI untuk seluruh periode (perilaku lama; dipakai
--         Konversi Rumus Lama & perbaikan rumus yang salah).
--   * hitung_capaian_mutu() memakai versi yang berlaku di tiap bulan dan
--     kini juga mengembalikan target & arah_target versi tersebut.
--
-- Data lama: setiap indikator mendapat versi pertama (berlaku sejak
-- 2000-01-01) berisi rumus & target saat ini, jadi hasil hitung tidak berubah.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.master_indikator add column if not exists arah_target text;
alter table public.master_indikator add column if not exists berlaku_mulai date;       -- masukan sementara, dikosongkan trigger
alter table public.master_indikator add column if not exists catatan_perubahan text;   -- masukan sementara, dikosongkan trigger

create table if not exists public.master_indikator_versi (
  id                   uuid primary key default gen_random_uuid(),
  id_indikator         uuid not null references public.master_indikator(id_indikator) on delete cascade,
  berlaku_mulai        date not null check (extract(day from berlaku_mulai) = 1),
  id_form              text,
  template_numerator   text,
  template_denominator text,
  satuan               text,
  target               text,
  arah_target          text,
  unit_pelaksana       text,
  catatan              text,
  dibuat_oleh          text,
  dibuat_pada          timestamptz not null default now(),
  unique (id_indikator, berlaku_mulai)
);
create index if not exists master_indikator_versi_idx on public.master_indikator_versi (id_indikator, berlaku_mulai);

alter table public.master_indikator_versi enable row level security;
grant select on public.master_indikator_versi to authenticated;
revoke all on public.master_indikator_versi from anon;
drop policy if exists versi_baca on public.master_indikator_versi;
create policy versi_baca on public.master_indikator_versi for select to authenticated using ((select public.mutu_aktif()));
-- Ditulis hanya lewat trigger (security definer) di bawah.

drop trigger if exists audit_master_indikator_versi on public.master_indikator_versi;
create trigger audit_master_indikator_versi after insert or update or delete on public.master_indikator_versi
  for each row execute function public.audit_catat('id');

-- Versi pertama untuk semua indikator yang ada
insert into public.master_indikator_versi (id_indikator, berlaku_mulai, id_form, template_numerator, template_denominator,
                                           satuan, target, arah_target, unit_pelaksana, catatan, dibuat_oleh)
select m.id_indikator, date '2000-01-01', m.id_form, m.template_numerator, m.template_denominator,
       m.satuan, m.target, m.arah_target, m.unit_pelaksana, 'Versi awal (migrasi riwayat versi)', 'sistem'
  from public.master_indikator m
on conflict (id_indikator, berlaku_mulai) do nothing;

-- ---------------------------------------------------------------------
-- Trigger: perubahan rumus/target -> versi baru
-- ---------------------------------------------------------------------
-- Pada INSERT, baris master belum ada saat BEFORE trigger berjalan (FK). Versi indikator
-- baru dicatat oleh trigger AFTER INSERT berikut.
create or replace function public.catat_versi_indikator_baru()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.master_indikator_versi (id_indikator, berlaku_mulai, id_form, template_numerator, template_denominator,
                                             satuan, target, arah_target, unit_pelaksana, catatan, dibuat_oleh)
  values (new.id_indikator, date '2000-01-01', new.id_form, new.template_numerator, new.template_denominator,
          new.satuan, new.target, new.arah_target, new.unit_pelaksana, 'Indikator baru',
          coalesce((select nama_lengkap from public.profiles where id = auth.uid()), 'sistem'))
  on conflict (id_indikator, berlaku_mulai) do nothing;
  return null;
end $$;
drop trigger if exists catat_versi_indikator_baru on public.master_indikator;
create trigger catat_versi_indikator_baru after insert on public.master_indikator
  for each row execute function public.catat_versi_indikator_baru();

-- BEFORE UPDATE: perubahan rumus/target -> versi baru mulai berlaku_mulai
create or replace function public.catat_versi_indikator()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mulai date := coalesce(date_trunc('month', new.berlaku_mulai)::date, date '2000-01-01');
  v_nama  text := (select nama_lengkap from public.profiles where id = auth.uid());
begin
  if tg_op = 'UPDATE' and (
     new.id_form is distinct from old.id_form or
     new.template_numerator is distinct from old.template_numerator or
     new.template_denominator is distinct from old.template_denominator or
     new.satuan is distinct from old.satuan or
     new.target is distinct from old.target or
     new.arah_target is distinct from old.arah_target or
     new.unit_pelaksana is distinct from old.unit_pelaksana) then
    delete from public.master_indikator_versi where id_indikator = new.id_indikator and berlaku_mulai >= v_mulai;
    insert into public.master_indikator_versi (id_indikator, berlaku_mulai, id_form, template_numerator, template_denominator,
                                               satuan, target, arah_target, unit_pelaksana, catatan, dibuat_oleh)
    values (new.id_indikator, v_mulai, new.id_form, new.template_numerator, new.template_denominator,
            new.satuan, new.target, new.arah_target, new.unit_pelaksana,
            coalesce(nullif(btrim(new.catatan_perubahan), ''),
                     case when v_mulai = date '2000-01-01' then 'Koreksi untuk seluruh periode'
                          else 'Perubahan mulai ' || to_char(v_mulai, 'MM/YYYY') end),
            coalesce(v_nama, 'sistem'));
  end if;
  new.berlaku_mulai := null;
  new.catatan_perubahan := null;
  return new;
end $$;

drop trigger if exists catat_versi_indikator on public.master_indikator;
create trigger catat_versi_indikator before update on public.master_indikator
  for each row execute function public.catat_versi_indikator();

-- ---------------------------------------------------------------------
-- Hitung capaian memakai versi yang berlaku di tiap bulan
-- (kolom hasil bertambah target & arah_target -> fungsi dibuat ulang)
-- ---------------------------------------------------------------------
drop function if exists public.hitung_capaian_mutu(int, int[], text);
create function public.hitung_capaian_mutu(
  p_tahun int,
  p_bulan int[] default null,
  p_unit text default null
) returns table (
  id_indikator uuid, id_form text, unit_kerja text, bulan int,
  jumlah_baris bigint, numerator numeric, denominator numeric, capaian numeric,
  target text, arah_target text
)
language sql stable security invoker set search_path = public as $$
  with v as (
    select x.*, lead(x.berlaku_mulai) over (partition by x.id_indikator order by x.berlaku_mulai) as berikut
      from public.master_indikator_versi x
      join public.master_indikator m on m.id_indikator = x.id_indikator
  ),
  vb as materialized (
    select v.*,
           array(select b from generate_series(1, 12) b
                  where make_date(p_tahun, b, 1) >= v.berlaku_mulai
                    and (v.berikut is null or make_date(p_tahun, b, 1) < v.berikut)
                    and (p_bulan is null or b = any (p_bulan))
                  order by b) as bln
      from v
     where v.id_form is not null
       and (public.mutu_template(v.template_numerator) is not null
            or public.mutu_template(v.template_denominator) is not null)
  ),
  grp as (
    select vb.bln, jsonb_agg(jsonb_build_object(
             'kunci', vb.id, 'id_form', vb.id_form, 'satuan', vb.satuan,
             'unit_pelaksana', vb.unit_pelaksana,
             'tn', vb.template_numerator, 'td', vb.template_denominator)) as ind
      from vb
     where cardinality(vb.bln) > 0
     group by vb.bln
  )
  select vb.id_indikator, h.id_form, h.unit_kerja, h.bulan, h.jumlah_baris, h.numerator, h.denominator, h.capaian,
         vb.target, vb.arah_target
    from grp
    cross join lateral public._mutu_hitung(grp.ind, p_tahun, grp.bln, p_unit) h
    join vb on vb.id::text = h.kunci
$$;
revoke execute on function public.hitung_capaian_mutu(int, int[], text) from public, anon;
grant  execute on function public.hitung_capaian_mutu(int, int[], text) to authenticated;

commit;
