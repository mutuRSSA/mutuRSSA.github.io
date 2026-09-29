-- =====================================================================
-- Migrasi: Laporan periodik terintegrasi (triwulan / semester / tahunan)
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929130000 sudah dijalankan.
--
--   * laporan_periodik          : satu laporan per jenis x tahun x nomor.
--       data    = SNAPSHOT hasil kompilasi (angka laporan tidak berubah walau
--                 data harian dikoreksi, sampai dikompilasi ulang = versi baru);
--       narasi  = pembahasan per komponen, terintegrasi & ringkasan eksekutif
--                 (draf AI yang disunting Komite).
--       Alur: draf -> diajukan (diserahkan ke Direktur) -> disetujui (terkunci,
--       disposisi Direktur tercatat). Dapat dibuka kembali menjadi draf.
--   * laporan_periodik_riwayat  : salinan setiap diajukan / disetujui / dibuka
--                                 kembali (jejak versi yang diserahkan).
--   * laporan_umpan_balik_unit  : umpan balik & saran per unit. Unit dapat
--                                 membaca umpan baliknya setelah laporan disetujui.
--   * laporan_tindak_lanjut     : rekomendasi & disposisi Direktur yang dipantau
--                                 dan tampil di laporan periode berikutnya.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create table if not exists public.laporan_periodik (
  id                 uuid primary key default gen_random_uuid(),
  jenis              text not null check (jenis in ('triwulan', 'semester', 'tahunan')),
  tahun              int  not null check (tahun between 2000 and 2100),
  nomor              int  not null,
  judul              text,
  status             text not null default 'draf' check (status in ('draf', 'diajukan', 'disetujui')),
  versi              int  not null default 0,
  data               jsonb,
  narasi             jsonb not null default '{}'::jsonb,
  ai_model           text,
  dikompilasi_pada   timestamptz,
  dikompilasi_oleh   text,
  nomor_surat        text,
  diajukan_oleh      text,
  diajukan_pada      timestamptz,
  disposisi_direktur text,
  tanggal_disposisi  date,
  disetujui_oleh     text,
  disetujui_pada     timestamptz,
  dibuat_oleh        text,
  dibuat_pada        timestamptz not null default now(),
  diperbarui_oleh    text,
  diperbarui_pada    timestamptz not null default now(),
  unique (jenis, tahun, nomor),
  check ((jenis = 'triwulan' and nomor between 1 and 4) or (jenis = 'semester' and nomor between 1 and 2) or (jenis = 'tahunan' and nomor = 1))
);

create table if not exists public.laporan_periodik_riwayat (
  id                 uuid primary key default gen_random_uuid(),
  id_laporan         uuid not null references public.laporan_periodik(id) on delete cascade,
  versi              int,
  status             text,
  keterangan         text,
  data               jsonb,
  narasi             jsonb,
  disposisi_direktur text,
  dicatat_oleh       text,
  dicatat_pada       timestamptz not null default now()
);
create index if not exists laporan_periodik_riwayat_idx on public.laporan_periodik_riwayat (id_laporan, dicatat_pada);

create table if not exists public.laporan_umpan_balik_unit (
  id              uuid primary key default gen_random_uuid(),
  id_laporan      uuid not null references public.laporan_periodik(id) on delete cascade,
  unit_kerja      text not null,
  ringkasan       text,
  apresiasi       jsonb not null default '[]'::jsonb,
  perhatian       jsonb not null default '[]'::jsonb,
  saran           jsonb not null default '[]'::jsonb,
  sumber          text,               -- 'aturan' | 'ai:<model>' | 'disunting'
  diperbarui_oleh text,
  diperbarui_pada timestamptz not null default now(),
  unique (id_laporan, unit_kerja)
);

create table if not exists public.laporan_tindak_lanjut (
  id              uuid primary key default gen_random_uuid(),
  id_laporan      uuid not null references public.laporan_periodik(id) on delete cascade,
  sumber          text not null default 'disposisi' check (sumber in ('rekomendasi', 'disposisi')),
  uraian          text not null,
  unit_kerja      text,
  pic             text,
  tenggat         date,
  status          text not null default 'rencana' check (status in ('rencana', 'berjalan', 'selesai', 'batal')),
  progres         text,
  dibuat_pada     timestamptz not null default now(),
  diperbarui_pada timestamptz not null default now(),
  selesai_pada    timestamptz
);
create index if not exists laporan_tindak_lanjut_idx on public.laporan_tindak_lanjut (id_laporan);

-- ---------------------------------------------------------------------
-- RLS: laporan hanya Komite (admin). Unit membaca umpan balik unitnya
-- sendiri setelah laporan disetujui.
-- ---------------------------------------------------------------------
alter table public.laporan_periodik          enable row level security;
alter table public.laporan_periodik_riwayat  enable row level security;
alter table public.laporan_umpan_balik_unit  enable row level security;
alter table public.laporan_tindak_lanjut     enable row level security;
grant select, insert, update, delete on public.laporan_periodik, public.laporan_umpan_balik_unit, public.laporan_tindak_lanjut to authenticated;
grant select on public.laporan_periodik_riwayat to authenticated;
revoke all on public.laporan_periodik, public.laporan_periodik_riwayat, public.laporan_umpan_balik_unit, public.laporan_tindak_lanjut from anon;

drop policy if exists laporan_admin on public.laporan_periodik;
create policy laporan_admin on public.laporan_periodik for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));
drop policy if exists laporan_riwayat_admin on public.laporan_periodik_riwayat;
create policy laporan_riwayat_admin on public.laporan_periodik_riwayat for select to authenticated
  using ((select public.mutu_is_admin()));
drop policy if exists laporan_tl_admin on public.laporan_tindak_lanjut;
create policy laporan_tl_admin on public.laporan_tindak_lanjut for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));
drop policy if exists umpan_balik_admin on public.laporan_umpan_balik_unit;
create policy umpan_balik_admin on public.laporan_umpan_balik_unit for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));
-- Status laporan dibaca lewat fungsi SECURITY DEFINER (unit tidak dapat membaca laporan_periodik)
create or replace function public.laporan_sudah_disetujui(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.laporan_periodik where id = p_id and status = 'disetujui')
$$;
revoke execute on function public.laporan_sudah_disetujui(uuid) from public, anon;
grant execute on function public.laporan_sudah_disetujui(uuid) to authenticated;
drop policy if exists umpan_balik_unit_baca on public.laporan_umpan_balik_unit;
create policy umpan_balik_unit_baca on public.laporan_umpan_balik_unit for select to authenticated
  using (unit_kerja = (select public.mutu_unit()) and public.laporan_sudah_disetujui(id_laporan));

-- Unit: daftar laporan yang sudah disetujui (judul & periode saja, untuk umpan balik)
create or replace function public.laporan_umpan_balik_saya()
returns table (id_laporan uuid, judul text, jenis text, tahun int, nomor int, disetujui_pada timestamptz,
               unit_kerja text, ringkasan text, apresiasi jsonb, perhatian jsonb, saran jsonb)
language sql stable security definer set search_path = public as $$
  select l.id, l.judul, l.jenis, l.tahun, l.nomor, l.disetujui_pada, u.unit_kerja, u.ringkasan, u.apresiasi, u.perhatian, u.saran
    from public.laporan_umpan_balik_unit u
    join public.laporan_periodik l on l.id = u.id_laporan
   where l.status = 'disetujui' and u.unit_kerja = public.mutu_unit()
   order by l.tahun desc, l.disetujui_pada desc
$$;
revoke execute on function public.laporan_umpan_balik_saya() from public, anon;
grant execute on function public.laporan_umpan_balik_saya() to authenticated;

-- ---------------------------------------------------------------------
-- Alur status & penguncian
-- ---------------------------------------------------------------------
-- SECURITY DEFINER: menulis riwayat (tabel riwayat tidak dapat ditulis langsung oleh pengguna)
create or replace function public.jaga_laporan_periodik()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nama text := (select nama_lengkap from public.profiles where id = auth.uid());
  v_ket  text;
begin
  if tg_op = 'INSERT' then
    new.status := 'draf';
    new.versi := case when new.data is null then 0 else 1 end;
    new.dibuat_oleh := coalesce(v_nama, new.dibuat_oleh, 'sistem');
    new.diperbarui_oleh := new.dibuat_oleh;
    new.diajukan_pada := null; new.disetujui_pada := null;
    if new.data is not null then new.dikompilasi_pada := now(); new.dikompilasi_oleh := new.dibuat_oleh; end if;
    return new;
  end if;

  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then return new; end if;

  if old.status = 'disetujui' then
    -- Laporan disetujui terkunci; hanya boleh dibuka kembali menjadi draf (isi tetap)
    if new.status <> 'draf' then
      if new.data is distinct from old.data or new.narasi is distinct from old.narasi
         or new.disposisi_direktur is distinct from old.disposisi_direktur then
        raise exception 'Laporan sudah disetujui dan terkunci. Buka kembali (menjadi draf) bila perlu revisi.';
      end if;
    else
      new.data := old.data; new.narasi := old.narasi;
      v_ket := 'Dibuka kembali untuk revisi';
    end if;
  elsif old.status = 'diajukan' and new.status = 'diajukan'
        and (new.data is distinct from old.data or new.narasi is distinct from old.narasi) then
    raise exception 'Laporan sedang diajukan ke Direktur. Kembalikan ke draf untuk mengubah isi.';
  end if;

  -- Kompilasi ulang = versi baru
  if new.data is distinct from old.data then
    new.versi := old.versi + 1;
    new.dikompilasi_pada := now();
    new.dikompilasi_oleh := coalesce(v_nama, 'sistem');
  end if;

  if new.status is distinct from old.status then
    if new.status = 'diajukan' then
      if new.data is null then raise exception 'Kompilasi data terlebih dahulu sebelum laporan diajukan.'; end if;
      new.diajukan_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diajukan_pada := now();
      v_ket := 'Diajukan ke Direktur';
    elsif new.status = 'disetujui' then
      if old.status <> 'diajukan' then raise exception 'Laporan harus diajukan ke Direktur terlebih dahulu.'; end if;
      if coalesce(btrim(new.disposisi_direktur), '') = '' then
        raise exception 'Isi disposisi / arahan Direktur sebelum menandai laporan disetujui.';
      end if;
      new.disetujui_oleh := coalesce(nullif(btrim(new.disetujui_oleh), ''), (select direktur_nama from public.pengaturan_institusi where id = 1), 'Direktur');
      new.disetujui_pada := now();
      new.tanggal_disposisi := coalesce(new.tanggal_disposisi, current_date);
      v_ket := 'Disetujui Direktur';
    elsif new.status = 'draf' then
      v_ket := coalesce(v_ket, 'Dikembalikan ke draf');
      new.disetujui_pada := null;
    end if;
  end if;

  if v_ket is not null then
    insert into public.laporan_periodik_riwayat (id_laporan, versi, status, keterangan, data, narasi, disposisi_direktur, dicatat_oleh)
    values (new.id, new.versi, new.status, v_ket, new.data, new.narasi, new.disposisi_direktur, coalesce(v_nama, 'sistem'));
  end if;
  new.diperbarui_oleh := coalesce(v_nama, 'sistem');
  new.diperbarui_pada := now();
  return new;
end $$;
drop trigger if exists jaga_laporan_periodik on public.laporan_periodik;
create trigger jaga_laporan_periodik before insert or update on public.laporan_periodik
  for each row execute function public.jaga_laporan_periodik();

create or replace function public.jaga_hapus_laporan()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'draf' and coalesce(current_setting('mutu.lewati_audit', true), '') <> 'on' then
    raise exception 'Hanya laporan berstatus draf yang dapat dihapus.';
  end if;
  return old;
end $$;
drop trigger if exists jaga_hapus_laporan on public.laporan_periodik;
create trigger jaga_hapus_laporan before delete on public.laporan_periodik
  for each row execute function public.jaga_hapus_laporan();

-- Umpan balik unit ikut terkunci bila laporan sudah diajukan / disetujui
create or replace function public.jaga_umpan_balik_unit()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.laporan_periodik
   where id = case when tg_op = 'DELETE' then old.id_laporan else new.id_laporan end;
  if v_status in ('diajukan', 'disetujui') then
    raise exception 'Umpan balik unit tidak dapat diubah karena laporan sudah %.', v_status;
  end if;
  if tg_op <> 'DELETE' then
    new.diperbarui_pada := now();
    new.diperbarui_oleh := coalesce((select nama_lengkap from public.profiles where id = auth.uid()), 'sistem');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists jaga_umpan_balik_unit on public.laporan_umpan_balik_unit;
create trigger jaga_umpan_balik_unit before insert or update or delete on public.laporan_umpan_balik_unit
  for each row execute function public.jaga_umpan_balik_unit();

create or replace function public.isi_tindak_lanjut_laporan()
returns trigger language plpgsql set search_path = public as $$
begin
  new.diperbarui_pada := now();
  if new.status = 'selesai' and (tg_op = 'INSERT' or old.status is distinct from 'selesai') then new.selesai_pada := now(); end if;
  if new.status <> 'selesai' then new.selesai_pada := null; end if;
  return new;
end $$;
drop trigger if exists isi_tindak_lanjut_laporan on public.laporan_tindak_lanjut;
create trigger isi_tindak_lanjut_laporan before insert or update on public.laporan_tindak_lanjut
  for each row execute function public.isi_tindak_lanjut_laporan();

-- Log audit: buat/hapus & perubahan status laporan (isi lengkap ada di riwayat),
-- serta seluruh perubahan umpan balik unit dan tindak lanjut
drop trigger if exists audit_laporan_periodik on public.laporan_periodik;
create trigger audit_laporan_periodik after insert or delete on public.laporan_periodik
  for each row execute function public.audit_catat('id');
drop trigger if exists audit_status_laporan_periodik on public.laporan_periodik;
create trigger audit_status_laporan_periodik after update on public.laporan_periodik
  for each row when (old.status is distinct from new.status) execute function public.audit_catat('id');
drop trigger if exists audit_laporan_umpan_balik_unit on public.laporan_umpan_balik_unit;
create trigger audit_laporan_umpan_balik_unit after insert or update or delete on public.laporan_umpan_balik_unit
  for each row execute function public.audit_catat('id');
drop trigger if exists audit_laporan_tindak_lanjut on public.laporan_tindak_lanjut;
create trigger audit_laporan_tindak_lanjut after insert or update or delete on public.laporan_tindak_lanjut
  for each row execute function public.audit_catat('id');

commit;
