-- =====================================================================
-- Migrasi: Perbaikan grading & hak ubah laporan insiden (IKP/KPC)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928150000 sudah dijalankan.
--
-- 1. Grading risiko DIHITUNG DATABASE dari skor dampak x probabilitas
--    (matriks KKP-RS), tidak lagi dipercaya dari browser. Dulu 3 sel
--    matriks di formulir IKP keliru:
--      dampak 5 + prob 1   : Kuning -> Merah
--      dampak 3 + prob 4-5 : Merah  -> Kuning
--      dampak 2 + prob 5   : Kuning -> Hijau
--    Kejadian Sentinel selalu Merah (wajib RCA). KPC tanpa skor tetap Biru.
-- 2. Laporan lama dengan skor yang tercatat dihitung ulang gradingnya.
--    Setiap perubahan tercatat di Log Audit (nilai lama & baru).
--    Daftar kasus yang berubah: lihat query "Cek" di bagian bawah.
-- 3. Mengubah laporan insiden (status, grading, hasil investigasi) hanya
--    boleh oleh Komite Mutu (admin). Dulu staf unit pelapor secara teknis
--    bisa mengubah/menutup laporan unitnya lewat API.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Matriks grading
-- ---------------------------------------------------------------------
create or replace function public.mutu_grading_insiden(p_jenis text, p_dampak int, p_prob int)
returns text language sql immutable as $$
  select case
    when p_jenis = 'Sentinel' then 'Merah'
    when p_dampak not between 1 and 5 or p_prob not between 1 and 5 then null
    else (array[
      -- prob:  1        2        3        4        5
      array['Biru',  'Biru',  'Biru',   'Hijau',  'Hijau'],    -- dampak 1
      array['Biru',  'Biru',  'Hijau',  'Hijau',  'Hijau'],    -- dampak 2
      array['Hijau', 'Hijau', 'Kuning', 'Kuning', 'Kuning'],   -- dampak 3
      array['Kuning','Kuning','Merah',  'Merah',  'Merah'],    -- dampak 4
      array['Merah', 'Merah', 'Merah',  'Merah',  'Merah']     -- dampak 5
    ])[p_dampak][p_prob]
  end
$$;
grant execute on function public.mutu_grading_insiden(text, int, int) to anon, authenticated;

create or replace function public.jaga_grading_insiden()
returns trigger language plpgsql set search_path = public as $$
declare v text;
begin
  v := public.mutu_grading_insiden(new.jenis_insiden, new.skor_dampak, new.skor_probabilitas);
  if v is not null then new.grading_risiko := v; end if;   -- tanpa skor (mis. KPC): biarkan
  return new;
end $$;
drop trigger if exists jaga_grading_insiden on public.data_insiden;
create trigger jaga_grading_insiden before insert or update of jenis_insiden, skor_dampak, skor_probabilitas, grading_risiko
  on public.data_insiden for each row execute function public.jaga_grading_insiden();

-- ---------------------------------------------------------------------
-- 2. Hitung ulang grading laporan lama (lewat trigger di atas; tercatat di Log Audit)
-- ---------------------------------------------------------------------
do $$
declare v_n int;
begin
  update public.data_insiden d
     set grading_risiko = public.mutu_grading_insiden(d.jenis_insiden, d.skor_dampak, d.skor_probabilitas)
   where public.mutu_grading_insiden(d.jenis_insiden, d.skor_dampak, d.skor_probabilitas) is not null
     and d.grading_risiko is distinct from public.mutu_grading_insiden(d.jenis_insiden, d.skor_dampak, d.skor_probabilitas);
  get diagnostics v_n = row_count;
  raise notice 'Grading laporan insiden yang dikoreksi: %', v_n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Ubah laporan insiden: hanya Komite Mutu
-- ---------------------------------------------------------------------
drop policy if exists insiden_update on public.data_insiden;
create policy insiden_update on public.data_insiden
  for update to authenticated
  using ((select public.mutu_is_admin()))
  with check ((select public.mutu_is_admin()));

commit;

-- Cek kasus yang gradingnya berubah (dari Log Audit):
-- select a.waktu, a.id_baris, a.data_lama ->> 'grading_risiko' as lama, a.data_baru ->> 'grading_risiko' as baru,
--        a.data_baru ->> 'jenis_insiden' as jenis, a.data_baru ->> 'status_investigasi' as status
--   from public.audit_log a
--  where a.tabel = 'data_insiden' and a.aksi = 'UPDATE' and 'grading_risiko' = any (a.kolom_berubah)
--  order by a.waktu desc;
