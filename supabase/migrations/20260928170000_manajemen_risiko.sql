-- =====================================================================
-- Migrasi: Alur manajemen risiko (rancangan disetujui 28/09/2026)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928160000 sudah dijalankan
--           (memakai mutu_grading_insiden dari migrasi 18).
--
-- Alur: Identifikasi (unit) -> Analisis & evaluasi (matriks 5x5 = IKP)
--   -> Rencana penanganan -> Verifikasi Komite (Moderat ke atas; Rendah
--   langsung Aktif) -> Pantau berkala (riwayat review) -> Usulan profil
--   risiko RS (maks. 20/tahun, per kategori) -> Penetapan (SK Direktur,
--   diinput Komite) -> Laporan triwulan.
--
-- 1. data_risiko: kolom baru (tingkat, status alur, verifikasi, jadwal review).
--    Skor = Dampak x Probabilitas (kolom `frekuensi` = probabilitas);
--    tingkat dibaca dari matriks. Angka kontrol 1-4 lama tetap disimpan
--    sebagai catatan (kolom `kontrol`), tidak lagi dipakai menghitung.
-- 2. risiko_tindakan : rencana penanganan (opsi, tindakan, PIC, tenggat, status, bukti).
-- 3. risiko_review   : riwayat pemantauan (skor terkini, progres, efektivitas).
-- 4. profil_risiko_item / profil_risiko_sk : profil risiko RS per tahun.
-- 5. Konversi data lama (risiko terkirim -> Aktif; rencana/realisasi/
--    pemantauan lama -> tindakan & review pertama; tanda profil RS lama ->
--    usulan profil tahun risiko itu). Tidak ada data yang dihapus.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Fungsi bantu
-- ---------------------------------------------------------------------
create or replace function public.mutu_tingkat_risiko(p_dampak int, p_prob int)
returns text language sql immutable as $$
  select case public.mutu_grading_insiden('KTD', p_dampak, p_prob)
           when 'Biru' then 'Rendah' when 'Hijau' then 'Moderat'
           when 'Kuning' then 'Tinggi' when 'Merah' then 'Ekstrem' end
$$;
grant execute on function public.mutu_tingkat_risiko(int, int) to authenticated;

-- Jarak review berikutnya menurut tingkat (keputusan: bulanan/triwulan/semester/tahunan)
create or replace function public.mutu_interval_review(p_tingkat text)
returns interval language sql immutable as $$
  select case p_tingkat when 'Ekstrem' then interval '1 month' when 'Tinggi' then interval '3 months'
                        when 'Moderat' then interval '6 months' else interval '12 months' end
$$;

-- ---------------------------------------------------------------------
-- 1. data_risiko: kolom baru
-- ---------------------------------------------------------------------
alter table public.data_risiko add column if not exists kategori_risiko      text;
alter table public.data_risiko add column if not exists sumber_temuan        text;
alter table public.data_risiko add column if not exists pemilik_risiko       text;
alter table public.data_risiko add column if not exists tanggal_identifikasi date default current_date;
alter table public.data_risiko add column if not exists tingkat_risiko       text;
alter table public.data_risiko add column if not exists catatan_verifikasi   text;
alter table public.data_risiko add column if not exists diajukan_pada        timestamptz;
alter table public.data_risiko add column if not exists diverifikasi_oleh    text;
alter table public.data_risiko add column if not exists diverifikasi_pada    timestamptz;
alter table public.data_risiko add column if not exists review_terakhir      date;
alter table public.data_risiko add column if not exists review_berikutnya    date;
alter table public.data_risiko add column if not exists alasan_tutup         text;
alter table public.data_risiko add column if not exists ditutup_pada         timestamptz;
alter table public.data_risiko add column if not exists diperbarui_pada      timestamptz default now();

-- Batasan status lama (draft/terkirim) bila ada, diganti status alur baru
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.data_risiko'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%status%'
              and conname <> 'data_risiko_status_alur_check'
  loop
    execute format('alter table public.data_risiko drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.data_risiko drop constraint if exists data_risiko_status_alur_check;
alter table public.data_risiko add constraint data_risiko_status_alur_check
  check (status in ('draft', 'terkirim', 'diajukan', 'revisi', 'aktif', 'ditutup'));

create index if not exists data_risiko_status_idx on public.data_risiko (status, unit_kerja);

-- ---------------------------------------------------------------------
-- 2-4. Tabel baru
-- ---------------------------------------------------------------------
create table if not exists public.risiko_tindakan (
  id          uuid primary key default gen_random_uuid(),
  id_risiko   text not null references public.data_risiko(id_risiko) on delete cascade on update cascade,
  opsi        text not null default 'kurangi' check (opsi in ('hindari', 'kurangi', 'alihkan', 'terima')),
  tindakan    text not null,
  pic         text,
  tenggat     date,
  status      text not null default 'rencana' check (status in ('rencana', 'berjalan', 'selesai', 'batal')),
  bukti       text,
  dibuat_pada timestamptz not null default now(),
  selesai_pada timestamptz
);
create index if not exists risiko_tindakan_risiko_idx on public.risiko_tindakan (id_risiko);

create table if not exists public.risiko_review (
  id            uuid primary key default gen_random_uuid(),
  id_risiko     text not null references public.data_risiko(id_risiko) on delete cascade on update cascade,
  tanggal       date not null default current_date,
  dampak        int  not null check (dampak between 1 and 5),
  probabilitas  int  not null check (probabilitas between 1 and 5),
  tingkat       text,
  progres       text,
  efektivitas   text check (efektivitas in ('efektif', 'sebagian', 'belum efektif')),
  peninjau_nama text,
  dibuat_oleh   uuid default auth.uid(),
  dibuat_pada   timestamptz not null default now()
);
create index if not exists risiko_review_risiko_idx on public.risiko_review (id_risiko, tanggal);

create table if not exists public.profil_risiko_item (
  id          uuid primary key default gen_random_uuid(),
  tahun       int  not null check (tahun between 2000 and 2100),
  id_risiko   text not null references public.data_risiko(id_risiko) on delete cascade on update cascade,
  kategori    text,
  urutan      int,
  status      text not null default 'usulan' check (status in ('usulan', 'ditetapkan')),
  catatan     text,
  dibuat_pada timestamptz not null default now(),
  unique (tahun, id_risiko)
);

create table if not exists public.profil_risiko_sk (
  tahun        int primary key check (tahun between 2000 and 2100),
  nomor_sk     text not null,
  tanggal_sk   date not null,
  catatan      text,
  diinput_oleh text,
  diinput_pada timestamptz not null default now()
);

-- Tautan FMEA -> risiko asal
alter table public.data_fmea add column if not exists id_risiko text;

-- ---------------------------------------------------------------------
-- 5. Penjaga alur di data_risiko
-- ---------------------------------------------------------------------
create or replace function public.jaga_alur_risiko()
returns trigger language plpgsql set search_path = public as $$
declare
  -- auth.uid() kosong = SQL Editor / service role (anon tidak punya akses ke tabel ini)
  v_admin boolean := auth.uid() is null or public.mutu_is_admin();
  v_bypass boolean := coalesce(current_setting('mutu.lewati_audit', true), '') = 'on'
                   or coalesce(current_setting('mutu.review_risiko', true), '') = 'on';
  v_nama text;
begin
  if tg_op = 'DELETE' then
    if not v_admin and not v_bypass and old.status not in ('draft', 'revisi') then
      raise exception 'Risiko yang sudah diajukan atau aktif tidak dapat dihapus. Minta Komite menutupnya.';
    end if;
    return old;
  end if;

  -- Skor & tingkat selalu dihitung ulang dari dampak x probabilitas
  new.skor_risiko := case when new.dampak between 1 and 5 and new.frekuensi between 1 and 5 then new.dampak * new.frekuensi end;
  new.skor_akhir := new.skor_risiko;
  new.tingkat_risiko := public.mutu_tingkat_risiko(new.dampak::int, new.frekuensi::int);
  if new.status = 'terkirim' then new.status := 'aktif'; end if;
  if new.tanggal_identifikasi is null then
    new.tanggal_identifikasi := case when tg_op = 'UPDATE' then coalesce(old.tanggal_identifikasi, current_date) else current_date end;
  end if;
  new.diperbarui_pada := now();
  if new.status = 'aktif' and new.review_berikutnya is null then
    new.review_berikutnya := (current_date + public.mutu_interval_review(new.tingkat_risiko))::date;
  end if;

  if v_bypass then return new; end if;

  if not v_admin then
    -- Staf unit: hanya boleh mengubah risiko draf/revisi; kolom Komite tidak bisa diubah
    if tg_op = 'UPDATE' then
      if old.status not in ('draft', 'revisi') then
        raise exception 'Risiko berstatus % tidak dapat diubah langsung. Gunakan review berkala.', old.status;
      end if;
      new.is_profil_rs := old.is_profil_rs;
      new.catatan_verifikasi := old.catatan_verifikasi;
      new.diverifikasi_oleh := old.diverifikasi_oleh;
      new.diverifikasi_pada := old.diverifikasi_pada;
    else
      new.is_profil_rs := false;
      new.catatan_verifikasi := null; new.diverifikasi_oleh := null; new.diverifikasi_pada := null;
    end if;
    if new.status not in ('draft', 'diajukan') then
      raise exception 'Unit hanya dapat menyimpan risiko sebagai draf atau mengajukannya.';
    end if;
  end if;

  if new.status = 'diajukan' then
    if new.tingkat_risiko is null then raise exception 'Dampak dan probabilitas wajib diisi sebelum diajukan.'; end if;
    if coalesce(btrim(new.risiko_teridentifikasi), '') = '' or coalesce(btrim(new.kategori_risiko), '') = '' then
      raise exception 'Pernyataan risiko dan kategori wajib diisi sebelum diajukan.';
    end if;
    -- Moderat ke atas: wajib punya minimal satu tindakan dengan PIC dan tenggat
    if new.tingkat_risiko <> 'Rendah' and not exists (
         select 1 from public.risiko_tindakan t
          where t.id_risiko = new.id_risiko and t.status <> 'batal'
            and coalesce(btrim(t.pic), '') <> '' and t.tenggat is not null) then
      raise exception 'Risiko % wajib memiliki minimal satu rencana tindakan dengan PIC dan tenggat sebelum diajukan.', new.tingkat_risiko;
    end if;
    new.diajukan_pada := now();
    -- Keputusan: risiko Rendah langsung Aktif tanpa verifikasi Komite
    if new.tingkat_risiko = 'Rendah' then
      new.status := 'aktif';
      new.diverifikasi_oleh := 'Otomatis (tingkat Rendah)';
      new.diverifikasi_pada := now();
    end if;
  end if;

  if v_admin and tg_op = 'UPDATE' and old.status is distinct from new.status then
    select nama_lengkap into v_nama from public.profiles where id = auth.uid();
    if new.status = 'revisi' and coalesce(btrim(new.catatan_verifikasi), '') = '' then
      raise exception 'Catatan revisi wajib diisi.';
    end if;
    if new.status in ('aktif', 'revisi') and old.status = 'diajukan' then
      new.diverifikasi_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diverifikasi_pada := now();
    end if;
    if new.status = 'ditutup' then
      if coalesce(btrim(new.alasan_tutup), '') = '' then raise exception 'Alasan penutupan risiko wajib diisi.'; end if;
      new.ditutup_pada := now();
    end if;
  end if;

  if new.status = 'aktif' and (tg_op = 'INSERT' or old.status is distinct from 'aktif') and new.review_berikutnya is null then
    new.review_berikutnya := (current_date + public.mutu_interval_review(new.tingkat_risiko))::date;
  end if;
  return new;
end $$;

drop trigger if exists jaga_alur_risiko on public.data_risiko;
create trigger jaga_alur_risiko before insert or update or delete on public.data_risiko
  for each row execute function public.jaga_alur_risiko();

-- Review: tingkat dihitung; skor terbaru & jadwal review berikutnya diteruskan ke risikonya
create or replace function public.isi_review_risiko()
returns trigger language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.data_risiko where id_risiko = new.id_risiko;
  if v_status is distinct from 'aktif' and coalesce(current_setting('mutu.lewati_audit', true), '') <> 'on' then
    raise exception 'Review hanya untuk risiko yang Aktif.';
  end if;
  new.tingkat := public.mutu_tingkat_risiko(new.dampak, new.probabilitas);
  if new.peninjau_nama is null then
    new.peninjau_nama := (select nama_lengkap from public.profiles where id = auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists isi_review_risiko on public.risiko_review;
create trigger isi_review_risiko before insert on public.risiko_review
  for each row execute function public.isi_review_risiko();

create or replace function public.teruskan_review_risiko()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lama text;
begin
  -- Hanya review terbaru yang menentukan skor risiko saat ini
  if exists (select 1 from public.risiko_review r where r.id_risiko = new.id_risiko
              and (r.tanggal, r.dibuat_pada) > (new.tanggal, new.dibuat_pada)) then
    return null;
  end if;
  select tingkat_risiko into v_lama from public.data_risiko where id_risiko = new.id_risiko;
  perform set_config('mutu.review_risiko', 'on', true);
  update public.data_risiko
     set dampak = new.dampak, frekuensi = new.probabilitas, review_terakhir = new.tanggal,
         review_berikutnya = (new.tanggal + public.mutu_interval_review(new.tingkat))::date,
         -- Naik dari Rendah (dulu tanpa verifikasi) ke Moderat atau lebih: perlu rencana & verifikasi Komite
         status = case when v_lama = 'Rendah' and new.tingkat <> 'Rendah' then 'revisi' else status end,
         catatan_verifikasi = case when v_lama = 'Rendah' and new.tingkat <> 'Rendah'
           then format('Tingkat naik dari Rendah menjadi %s pada review %s. Lengkapi rencana penanganan (PIC dan tenggat), lalu ajukan ke Komite.',
                       new.tingkat, to_char(new.tanggal, 'DD-MM-YYYY'))
           else catatan_verifikasi end
   where id_risiko = new.id_risiko;
  perform set_config('mutu.review_risiko', 'off', true);
  return null;
end $$;
drop trigger if exists teruskan_review_risiko on public.risiko_review;
create trigger teruskan_review_risiko after insert on public.risiko_review
  for each row execute function public.teruskan_review_risiko();

create or replace function public.jaga_tindakan_risiko()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'selesai' and (tg_op = 'INSERT' or old.status is distinct from 'selesai') then new.selesai_pada := now(); end if;
  if new.status <> 'selesai' then new.selesai_pada := null; end if;
  return new;
end $$;
drop trigger if exists jaga_tindakan_risiko on public.risiko_tindakan;
create trigger jaga_tindakan_risiko before insert or update on public.risiko_tindakan
  for each row execute function public.jaga_tindakan_risiko();

-- Profil RS: maks. 20 risiko per tahun; tanda is_profil_rs ikut disinkronkan
create or replace function public.jaga_profil_risiko()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(current_setting('mutu.lewati_audit', true), '') <> 'on'
     and (select count(*) from public.profil_risiko_item where tahun = new.tahun) >= 20 then
    raise exception 'Profil risiko RS tahun % sudah berisi 20 risiko (batas maksimal).', new.tahun;
  end if;
  -- Hanya risiko Tinggi / Ekstrem yang masih berjalan yang boleh masuk profil RS
  if tg_op = 'INSERT' and coalesce(current_setting('mutu.lewati_audit', true), '') <> 'on'
     and not exists (select 1 from public.data_risiko r where r.id_risiko = new.id_risiko
                      and r.tingkat_risiko in ('Tinggi', 'Ekstrem') and r.status in ('aktif', 'terkirim')) then
    raise exception 'Profil risiko RS hanya untuk risiko Tinggi atau Ekstrem yang berstatus Aktif.';
  end if;
  if tg_op = 'INSERT' and new.kategori is null then
    new.kategori := (select kategori_risiko from public.data_risiko where id_risiko = new.id_risiko);
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.profil_risiko_sk where tahun = new.tahun) then
    new.status := 'ditetapkan';
  end if;
  return new;
end $$;
drop trigger if exists jaga_profil_risiko on public.profil_risiko_item;
create trigger jaga_profil_risiko before insert on public.profil_risiko_item
  for each row execute function public.jaga_profil_risiko();

create or replace function public.sinkron_tanda_profil()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text := case when tg_op = 'DELETE' then old.id_risiko else new.id_risiko end;
begin
  perform set_config('mutu.review_risiko', 'on', true);
  update public.data_risiko
     set is_profil_rs = exists (select 1 from public.profil_risiko_item where id_risiko = v_id)
   where id_risiko = v_id;
  perform set_config('mutu.review_risiko', 'off', true);
  return null;
end $$;
drop trigger if exists sinkron_tanda_profil on public.profil_risiko_item;
create trigger sinkron_tanda_profil after insert or delete on public.profil_risiko_item
  for each row execute function public.sinkron_tanda_profil();

-- SK diinput -> semua usulan tahun itu menjadi ditetapkan (SK dihapus -> kembali usulan)
create or replace function public.terapkan_sk_profil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profil_risiko_item
     set status = case when tg_op = 'DELETE' then 'usulan' else 'ditetapkan' end
   where tahun = case when tg_op = 'DELETE' then old.tahun else new.tahun end;
  return null;
end $$;
drop trigger if exists terapkan_sk_profil on public.profil_risiko_sk;
create trigger terapkan_sk_profil after insert or update or delete on public.profil_risiko_sk
  for each row execute function public.terapkan_sk_profil();

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
drop policy if exists risiko_per_unit on public.data_risiko;
drop policy if exists risiko_baca on public.data_risiko;
drop policy if exists risiko_tambah on public.data_risiko;
drop policy if exists risiko_ubah on public.data_risiko;
drop policy if exists risiko_hapus on public.data_risiko;
create policy risiko_baca on public.data_risiko for select to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
create policy risiko_tambah on public.data_risiko for insert to authenticated
  with check ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
create policy risiko_ubah on public.data_risiko for update to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()))
  with check ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));
create policy risiko_hapus on public.data_risiko for delete to authenticated
  using ((select public.mutu_is_admin()) or unit_kerja = (select public.mutu_unit()));

alter table public.risiko_tindakan    enable row level security;
alter table public.risiko_review      enable row level security;
alter table public.profil_risiko_item enable row level security;
alter table public.profil_risiko_sk   enable row level security;
grant select, insert, update, delete on public.risiko_tindakan, public.risiko_review,
      public.profil_risiko_item, public.profil_risiko_sk to authenticated;
revoke all on public.risiko_tindakan, public.risiko_review, public.profil_risiko_item, public.profil_risiko_sk from anon;

-- Tindakan & review: admin, atau unit pemilik risiko
-- (fungsi bantu dibungkus (select ...) agar tidak dipanggil per baris; lihat catatan RLS)
drop policy if exists risiko_tindakan_akses on public.risiko_tindakan;
create policy risiko_tindakan_akses on public.risiko_tindakan for all to authenticated
  using ((select public.mutu_is_admin())
         or exists (select 1 from public.data_risiko r where r.id_risiko = risiko_tindakan.id_risiko and r.unit_kerja = (select public.mutu_unit())))
  with check ((select public.mutu_is_admin())
         or exists (select 1 from public.data_risiko r where r.id_risiko = risiko_tindakan.id_risiko and r.unit_kerja = (select public.mutu_unit())));
drop policy if exists risiko_review_baca on public.risiko_review;
create policy risiko_review_baca on public.risiko_review for select to authenticated
  using ((select public.mutu_is_admin())
         or exists (select 1 from public.data_risiko r where r.id_risiko = risiko_review.id_risiko and r.unit_kerja = (select public.mutu_unit())));
drop policy if exists risiko_review_tambah on public.risiko_review;
create policy risiko_review_tambah on public.risiko_review for insert to authenticated
  with check ((select public.mutu_is_admin())
         or exists (select 1 from public.data_risiko r where r.id_risiko = risiko_review.id_risiko and r.unit_kerja = (select public.mutu_unit())));
drop policy if exists risiko_review_hapus_admin on public.risiko_review;
create policy risiko_review_hapus_admin on public.risiko_review for delete to authenticated
  using ((select public.mutu_is_admin()));

drop policy if exists profil_item_baca on public.profil_risiko_item;
create policy profil_item_baca on public.profil_risiko_item for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists profil_item_tulis on public.profil_risiko_item;
create policy profil_item_tulis on public.profil_risiko_item for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));
drop policy if exists profil_sk_baca on public.profil_risiko_sk;
create policy profil_sk_baca on public.profil_risiko_sk for select to authenticated using ((select public.mutu_aktif()));
drop policy if exists profil_sk_tulis on public.profil_risiko_sk;
create policy profil_sk_tulis on public.profil_risiko_sk for all to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

-- Log Audit untuk tabel baru
drop trigger if exists audit_risiko_tindakan on public.risiko_tindakan;
create trigger audit_risiko_tindakan after insert or update or delete on public.risiko_tindakan
  for each row execute function public.audit_catat('id');
drop trigger if exists audit_risiko_review on public.risiko_review;
create trigger audit_risiko_review after insert or update or delete on public.risiko_review
  for each row execute function public.audit_catat('id');
drop trigger if exists audit_profil_risiko_item on public.profil_risiko_item;
create trigger audit_profil_risiko_item after insert or update or delete on public.profil_risiko_item
  for each row execute function public.audit_catat('id');
drop trigger if exists audit_profil_risiko_sk on public.profil_risiko_sk;
create trigger audit_profil_risiko_sk after insert or update or delete on public.profil_risiko_sk
  for each row execute function public.audit_catat('tahun');

-- ---------------------------------------------------------------------
-- 7. Konversi data lama (sekali; aman diulang)
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  perform set_config('mutu.lewati_audit', 'on', true);

  -- Skor, tingkat, status: terkirim -> aktif (trigger menghitung ulang)
  update public.data_risiko set status = status where tingkat_risiko is null or status = 'terkirim';
  get diagnostics v_n = row_count;
  raise notice 'Risiko dihitung ulang tingkatnya: %', v_n;

  -- Rencana/realisasi lama (halaman profil RS) -> satu tindakan
  insert into public.risiko_tindakan (id_risiko, opsi, tindakan, pic, tenggat, status, bukti)
  select r.id_risiko, 'kurangi', btrim(r.rencana_penanganan), nullif(btrim(r.pic_penanganan), ''),
         case when r.periode_program::text ~ '^\d{4}-\d{2}-\d{2}' then left(r.periode_program::text, 10)::date end,
         case when r.status_penanganan ilike '%selesai%' then 'selesai'
              when r.status_penanganan ilike '%proses%' or r.status_penanganan ilike '%berjalan%' then 'berjalan'
              else 'rencana' end,
         nullif(concat_ws(E'\n', nullif(btrim(r.realisasi), ''), nullif(btrim(r.rencana_lanjutan), '')), '')
    from public.data_risiko r
   where coalesce(btrim(r.rencana_penanganan), '') <> ''
     and not exists (select 1 from public.risiko_tindakan t where t.id_risiko = r.id_risiko);
  get diagnostics v_n = row_count;
  raise notice 'Tindakan dari data lama: %', v_n;

  -- Hasil pemantauan lama -> review pertama
  insert into public.risiko_review (id_risiko, tanggal, dampak, probabilitas, progres, peninjau_nama)
  select r.id_risiko, current_date, r.dampak::int, r.frekuensi::int, btrim(r.hasil_pemantauan), 'Konversi data lama'
    from public.data_risiko r
   where coalesce(btrim(r.hasil_pemantauan), '') <> ''
     and r.dampak between 1 and 5 and r.frekuensi between 1 and 5
     and not exists (select 1 from public.risiko_review v where v.id_risiko = r.id_risiko);
  get diagnostics v_n = row_count;
  raise notice 'Review dari data lama: %', v_n;

  -- Tanda profil RS lama -> usulan profil risiko tahun risiko itu
  insert into public.profil_risiko_item (tahun, id_risiko, kategori, status)
  select coalesce(r.tahun, extract(year from current_date)::int), r.id_risiko, r.kategori_risiko, 'usulan'
    from public.data_risiko r
   where r.is_profil_rs is true
  on conflict (tahun, id_risiko) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'Usulan profil risiko dari data lama: %', v_n;

  perform set_config('mutu.lewati_audit', 'off', true);
end $$;

commit;
