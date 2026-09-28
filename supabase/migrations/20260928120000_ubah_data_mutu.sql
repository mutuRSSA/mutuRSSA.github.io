-- =====================================================================
-- Migrasi: Edit baris data mutu (Input Mutu)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928110000 sudah dijalankan.
--
-- ubah_data_mutu(p_rows): mengubah isi beberapa baris sekaligus (dari tabel
-- Excel atau Form Tunggal). Unit & formulir tidak bisa diubah; bulan/tahun
-- ikut tanggal di isian. SECURITY INVOKER: aturan RLS update berlaku (staf
-- hanya bisa mengubah data unitnya sendiri). Setiap perubahan tercatat di
-- Log Audit (trigger audit_catat) lengkap dengan isi sebelum & sesudahnya.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create or replace function public.ubah_data_mutu(p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_n int := 0;
  v_gagal jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Format data tidak valid.'; end if;
  if jsonb_array_length(p_rows) = 0 then return jsonb_build_object('diubah', 0, 'gagal', '[]'::jsonb); end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Satu kali ubah maksimal 2.000 baris.'; end if;

  drop table if exists _ubah;
  create temp table _ubah on commit drop as
  select x.id, x.data_input, x.bulan, x.tahun
    from jsonb_to_recordset(p_rows) as x(id uuid, data_input jsonb, bulan int, tahun int);

  if exists (select 1 from _ubah where id is null or bulan not between 1 and 12 or tahun not between 2000 and 2100
                                   or jsonb_typeof(data_input) is distinct from 'array') then
    raise exception 'Format data tidak valid (id, bulan, tahun, atau isi).';
  end if;

  update public.data_mutu_harian d
     set data_input = u.data_input, bulan = u.bulan, tahun = u.tahun
    from _ubah u
   where d.id = u.id;
  get diagnostics v_n = row_count;

  -- Baris yang tidak berubah: sudah dihapus orang lain, atau bukan hak pengguna (RLS)
  select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_gagal
    from _ubah u
   where not exists (select 1 from public.data_mutu_harian d where d.id = u.id and d.data_input = u.data_input);

  return jsonb_build_object('diubah', v_n, 'gagal', v_gagal);
end $$;

revoke execute on function public.ubah_data_mutu(jsonb) from public, anon;
grant  execute on function public.ubah_data_mutu(jsonb) to authenticated;

commit;
