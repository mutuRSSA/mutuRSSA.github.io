-- =====================================================================
-- Migrasi: Ganti nama / gabung unit ikut memperbarui Hak Akses Kolom
-- Tanggal : 2026-10-02
-- Syarat  : migrasi sampai 20260929150000 sudah dijalankan.
--
-- Hak Akses Kolom di Form Builder disimpan sebagai NAMA unit di dalam
-- setup_formulir.kolom[].akses ("Unit A, Unit B"). ganti_nama_unit()
-- hanya memperbarui kolom teks unit_kerja/unit_pelaksana/..., sehingga
-- setelah unit diganti nama, unit tersebut kehilangan hak isi kolom di
-- Input Mutu dan indikatornya hilang dari Laporan Mutu.
--
--   * _ganti_unit_di_akses_kolom(lama, baru): mengganti nama unit di semua
--     daftar hak akses kolom (tidak peka huruf besar/kecil, tanpa duplikat).
--   * Dipicu otomatis oleh entri Log Audit GANTI_NAMA_UNIT yang ditulis
--     ganti_nama_unit() (berlaku untuk ganti nama maupun gabung unit), jadi
--     fungsi ganti_nama_unit() tidak perlu diubah.
--   * Perubahan setup_formulir tercatat di Log Audit seperti biasa.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public._ganti_unit_di_akses_kolom(p_lama text, p_baru text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_lama text := lower(btrim(coalesce(p_lama, '')));
  v_baru text := btrim(coalesce(p_baru, ''));
  v_n int := 0;
begin
  if v_lama = '' or v_baru = '' or v_lama = lower(v_baru) then
    return 0;
  end if;

  with kolom_baru as (
    select f.id_form,
           jsonb_agg(
             case
               when jsonb_typeof(k.v) = 'object'
                and exists (select 1 from unnest(string_to_array(coalesce(k.v ->> 'akses', ''), ',')) x
                             where lower(btrim(x)) = v_lama)
               then jsonb_set(k.v, '{akses}', to_jsonb((
                      select string_agg(d.nm, ', ' order by d.urut)
                        from (select distinct on (lower(a.nm)) a.nm, a.urut
                                from (select case when lower(btrim(x)) = v_lama then v_baru else btrim(x) end as nm, o as urut
                                        from unnest(string_to_array(k.v ->> 'akses', ',')) with ordinality u(x, o)
                                       where btrim(x) <> '') a
                               order by lower(a.nm), a.urut) d)))
               else k.v
             end order by k.o) as kolom
      from public.setup_formulir f
      cross join lateral jsonb_array_elements(f.kolom) with ordinality k(v, o)
     where jsonb_typeof(f.kolom) = 'array'
     group by f.id_form
  )
  update public.setup_formulir s
     set kolom = kb.kolom
    from kolom_baru kb
   where s.id_form = kb.id_form
     and s.kolom is distinct from kb.kolom;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public._ganti_unit_di_akses_kolom(text, text) from public, anon, authenticated;

-- Dipicu oleh ringkasan Log Audit dari ganti_nama_unit()
create or replace function public.akses_kolom_ikut_ganti_nama_unit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.data_baru ->> 'status', '') = 'ok' then
    perform public._ganti_unit_di_akses_kolom(new.data_baru ->> 'lama', new.data_baru ->> 'baru');
  end if;
  return null;
end $$;
revoke execute on function public.akses_kolom_ikut_ganti_nama_unit() from public, anon, authenticated;

drop trigger if exists akses_kolom_ikut_ganti_nama_unit on public.audit_log;
create trigger akses_kolom_ikut_ganti_nama_unit
  after insert on public.audit_log
  for each row when (new.aksi = 'GANTI_NAMA_UNIT')
  execute function public.akses_kolom_ikut_ganti_nama_unit();

commit;
