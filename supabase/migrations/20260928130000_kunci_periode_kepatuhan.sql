-- =====================================================================
-- Migrasi: Kunci periode & kepatuhan pelaporan
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928120100 sudah dijalankan.
--
-- 1. KUNCI PERIODE
--    Tabel kunci_periode_mutu: satu baris = satu bulan dikunci, untuk SEMUA
--    unit (unit_kerja kosong) atau untuk satu unit.
--    Trigger di data_mutu_harian menolak tambah / ubah / hapus data pada
--    bulan yang dikunci - termasuk oleh admin (admin harus membuka kunci dulu,
--    tercatat di Log Audit). Pengecualian: proses massal resmi yang sudah
--    menandai diri (Tutup Tahun, Impor Data Lama: mutu.lewati_audit = on).
--
-- 2. KEPATUHAN PELAPORAN
--    kepatuhan_pelaporan_mutu(tahun): jumlah baris per unit x formulir x bulan
--    (RLS berlaku: kepala unit hanya melihat unitnya).
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabel kunci periode
-- ---------------------------------------------------------------------
create table if not exists public.kunci_periode_mutu (
  id            uuid primary key default gen_random_uuid(),
  tahun         int  not null check (tahun between 2000 and 2100),
  bulan         int  not null check (bulan between 1 and 12),
  unit_kerja    text,                          -- null = semua unit
  catatan       text,
  dikunci_oleh  uuid default auth.uid(),
  dikunci_nama  text,
  dikunci_pada  timestamptz not null default now()
);
create unique index if not exists kunci_periode_mutu_uidx
  on public.kunci_periode_mutu (tahun, bulan, coalesce(unit_kerja, '*'));

alter table public.kunci_periode_mutu enable row level security;
grant select, insert, update, delete on public.kunci_periode_mutu to authenticated;
revoke all on public.kunci_periode_mutu from anon;

drop policy if exists kunci_periode_select on public.kunci_periode_mutu;
create policy kunci_periode_select on public.kunci_periode_mutu
  for select to authenticated using ((select public.mutu_aktif()));

drop policy if exists kunci_periode_tulis_admin on public.kunci_periode_mutu;
create policy kunci_periode_tulis_admin on public.kunci_periode_mutu
  for all to authenticated using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

-- Nama pengunci diisi otomatis dari profil
create or replace function public.isi_pengunci_periode()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.dikunci_oleh := auth.uid();
  new.dikunci_nama := (select nama_lengkap from public.profiles where id = auth.uid());
  new.dikunci_pada := now();
  return new;
end $$;
drop trigger if exists isi_pengunci_periode on public.kunci_periode_mutu;
create trigger isi_pengunci_periode before insert on public.kunci_periode_mutu
  for each row execute function public.isi_pengunci_periode();

-- Kunci & buka kunci tercatat di Log Audit
drop trigger if exists audit_kunci_periode_mutu on public.kunci_periode_mutu;
create trigger audit_kunci_periode_mutu after insert or update or delete on public.kunci_periode_mutu
  for each row execute function public.audit_catat('id');

-- Apakah unit + bulan terkunci? (SECURITY DEFINER: dipakai di trigger untuk semua pengguna)
create or replace function public.mutu_periode_terkunci(p_unit text, p_tahun int, p_bulan int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kunci_periode_mutu k
                  where k.tahun = p_tahun and k.bulan = p_bulan
                    and (k.unit_kerja is null or k.unit_kerja = p_unit))
$$;
grant execute on function public.mutu_periode_terkunci(text, int, int) to authenticated;

-- Penjaga di data_mutu_harian
create or replace function public.jaga_kunci_periode()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Proses massal resmi (Tutup Tahun, Impor Data Lama) tidak diblokir
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and public.mutu_periode_terkunci(old.unit_kerja, old.tahun, old.bulan) then
    raise exception 'Data bulan %/% untuk % sudah dikunci. Minta admin membuka kunci periode terlebih dahulu.',
      old.bulan, old.tahun, old.unit_kerja using errcode = 'P0001', hint = 'KUNCI_PERIODE';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.mutu_periode_terkunci(new.unit_kerja, new.tahun, new.bulan) then
    raise exception 'Data bulan %/% untuk % sudah dikunci. Minta admin membuka kunci periode terlebih dahulu.',
      new.bulan, new.tahun, new.unit_kerja using errcode = 'P0001', hint = 'KUNCI_PERIODE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists jaga_kunci_periode on public.data_mutu_harian;
create trigger jaga_kunci_periode before insert or update or delete on public.data_mutu_harian
  for each row execute function public.jaga_kunci_periode();

-- ---------------------------------------------------------------------
-- 2. Kepatuhan pelaporan: jumlah baris per unit x formulir x bulan
-- ---------------------------------------------------------------------
create or replace function public.kepatuhan_pelaporan_mutu(p_tahun int)
returns table (unit_kerja text, id_form text, bulan int, jumlah bigint)
language sql stable security invoker set search_path = public as $$
  select d.unit_kerja, d.id_indikator, d.bulan, count(*)
    from public.data_mutu_harian d
   where d.tahun = p_tahun
   group by d.unit_kerja, d.id_indikator, d.bulan
$$;
revoke execute on function public.kepatuhan_pelaporan_mutu(int) from public, anon;
grant  execute on function public.kepatuhan_pelaporan_mutu(int) to authenticated;

-- Halaman Kepatuhan Pelaporan untuk semua role administrator (RBAC)
update public.role_permissions
   set allowed_pages = concat_ws(',', nullif(allowed_pages, ''), 'kepatuhan_pelaporan.html')
 where is_admin
   and coalesce(allowed_pages, '') not like '%kepatuhan_pelaporan.html%';

commit;
