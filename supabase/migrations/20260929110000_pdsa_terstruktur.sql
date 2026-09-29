-- =====================================================================
-- Migrasi: PDSA terstruktur (periode tahun+bulan & tautan ke profil indikator)
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929100000 sudah dijalankan.
--
-- Dulu periode PDSA disimpan sebagai teks bebas ("Agustus 2026") dan
-- id_indikator berisi ID FORMULIR, sehingga laporan bisa salah mengambil
-- PDSA dari triwulan/unit lain dan satu formulir bisa dipakai beberapa
-- indikator.
--   * periode_tahun, periode_bulan : periode capaian yang dianalisis.
--   * id_profil                    : master_indikator.id_indikator (uuid).
--   * id_indikator (id formulir) & judul_indikator tetap diisi (kompatibel).
--   * periode_analisis (teks) tetap diisi otomatis dari tahun+bulan.
-- Data lama dikonversi: teks periode dibaca (nama bulan / angka), id_profil
-- dicocokkan dari formulir + judul indikator.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.data_pdsa add column if not exists id_profil     uuid references public.master_indikator(id_indikator) on delete set null;
alter table public.data_pdsa add column if not exists periode_tahun int check (periode_tahun between 2000 and 2100);
alter table public.data_pdsa add column if not exists periode_bulan int check (periode_bulan between 1 and 12);
alter table public.data_pdsa add column if not exists diperbarui_pada timestamptz default now();
create index if not exists data_pdsa_profil_periode_idx on public.data_pdsa (id_profil, periode_tahun, periode_bulan);

-- Baca teks periode: "Agustus 2026", "Agu 2026", "8/2026", "08-2026", "2026-08"
create or replace function public.mutu_baca_periode(p text, out tahun int, out bulan int)
language plpgsql immutable as $$
declare
  t text := lower(btrim(coalesce(p, '')));
  nama text[] := array['jan','feb','mar','apr','mei','jun','jul','agu','sep','okt','nov','des'];
  nama_en text[] := array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  m text[];
  i int;
begin
  m := regexp_match(t, '(\d{4})\D+(\d{1,2})(\D|$)');
  if m is not null and m[2]::int between 1 and 12 then tahun := m[1]::int; bulan := m[2]::int; return; end if;
  m := regexp_match(t, '(^|\D)(\d{1,2})\D+(\d{4})');
  if m is not null and m[2]::int between 1 and 12 then tahun := m[3]::int; bulan := m[2]::int; return; end if;
  m := regexp_match(t, '(\d{4})');
  if m is not null then tahun := m[1]::int; end if;
  for i in 1..12 loop
    if t ~ ('(^|[^a-z])(' || nama[i] || '|' || nama_en[i] || ')') then bulan := i; exit; end if;
  end loop;
end $$;

-- Periode teks otomatis dari tahun+bulan; id formulir & judul mengikuti profil
create or replace function public.isi_pdsa_terstruktur()
returns trigger language plpgsql set search_path = public as $$
declare v_bln text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
begin
  if new.periode_tahun is null and new.periode_bulan is null and new.periode_analisis is not null then
    select tahun, bulan into new.periode_tahun, new.periode_bulan from public.mutu_baca_periode(new.periode_analisis);
  end if;
  if new.periode_tahun is not null and new.periode_bulan is not null then
    new.periode_analisis := v_bln[new.periode_bulan] || ' ' || new.periode_tahun;
  end if;
  if new.id_profil is not null then
    select coalesce(m.id_form, new.id_indikator), coalesce(m.judul_indikator, new.judul_indikator)
      into new.id_indikator, new.judul_indikator
      from public.master_indikator m where m.id_indikator = new.id_profil;
  end if;
  new.diperbarui_pada := now();
  return new;
end $$;
drop trigger if exists isi_pdsa_terstruktur on public.data_pdsa;
create trigger isi_pdsa_terstruktur before insert or update on public.data_pdsa
  for each row execute function public.isi_pdsa_terstruktur();

-- Konversi data lama
do $$
declare v_n int;
begin
  perform set_config('mutu.lewati_audit', 'on', true);

  update public.data_pdsa p
     set periode_tahun = x.tahun, periode_bulan = x.bulan
    from (select id_pdsa, (public.mutu_baca_periode(periode_analisis)).* from public.data_pdsa) x
   where x.id_pdsa = p.id_pdsa and p.periode_tahun is null;
  get diagnostics v_n = row_count;
  raise notice 'PDSA dengan periode terbaca: %', v_n;

  -- id_indikator lama berisi uuid profil (dari Laporan Mutu)
  update public.data_pdsa p set id_profil = m.id_indikator
    from public.master_indikator m
   where p.id_profil is null and p.id_indikator = m.id_indikator::text;

  -- id_indikator lama berisi id formulir: cocokkan judul, atau satu-satunya profil formulir itu
  update public.data_pdsa p set id_profil = coalesce(
           (select m.id_indikator from public.master_indikator m
             where m.id_form = p.id_indikator and lower(btrim(m.judul_indikator)) = lower(btrim(p.judul_indikator)) limit 1),
           (select min(m.id_indikator::text)::uuid from public.master_indikator m where m.id_form = p.id_indikator
             having count(*) = 1))
   where p.id_profil is null;
  get diagnostics v_n = row_count;

  select count(*) into v_n from public.data_pdsa where id_profil is null;
  raise notice 'PDSA yang belum tertaut ke profil indikator (perlu dipilih ulang di form): %', v_n;

  perform set_config('mutu.lewati_audit', 'off', true);
end $$;

commit;
