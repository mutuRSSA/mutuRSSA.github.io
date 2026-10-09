-- =====================================================================
-- Migrasi: Syarat rumus indikator bisa digabung dengan ATAU
-- Tanggal : 2026-10-09
-- Syarat  : migrasi sampai 20261007090000 sudah dijalankan.
--
-- Dulu semua syarat dalam "syarat":[...] harus terpenuhi (DAN).
-- Sekarang tiap syarat (mulai yang kedua) boleh punya "hubung":"atau".
-- Urutan pengerjaan seperti logika umum: DAN lebih dulu, lalu ATAU.
--   [A, B, {C, hubung:"atau"}, D]  =  (A DAN B) ATAU (C DAN D)
-- Tanpa "hubung" (atau "hubung":"dan") = DAN, jadi semua rumus lama tetap sama.
-- engine_mutu.js (mutuSyaratOk) memakai aturan yang sama persis.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public.mutu_syarat_ok(d jsonb, s jsonb)
returns boolean language sql immutable parallel safe as $$
  select case
    when jsonb_typeof(s) is distinct from 'array' then true
    -- Hanya DAN (semua rumus lama): satu kelompok
    when not (s @? '$[1 to last] ? (@.hubung == "atau")') then
      coalesce((select bool_and(public.mutu_indeks(x ->> 'kolom') is not null
                                and public.mutu_cocok(d ->> public.mutu_indeks(x ->> 'kolom'), x ->> 'operator', x ->> 'nilai'))
                  from jsonb_array_elements(s) x), true)
    -- Ada ATAU: pecah menjadi kelompok DAN; cukup satu kelompok yang terpenuhi
    else
      coalesce((select bool_or(ok) from (
                  select bool_and(public.mutu_indeks(x ->> 'kolom') is not null
                                  and public.mutu_cocok(d ->> public.mutu_indeks(x ->> 'kolom'), x ->> 'operator', x ->> 'nilai')) as ok
                    from (select x, sum(case when n > 1 and x ->> 'hubung' = 'atau' then 1 else 0 end) over (order by n) as kelompok
                            from jsonb_array_elements(s) with ordinality e(x, n)) t
                   group by kelompok) k), true)
  end
$$;

commit;
