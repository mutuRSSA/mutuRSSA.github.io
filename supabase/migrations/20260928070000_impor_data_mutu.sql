-- =====================================================================
-- Migrasi: Impor data mutu dari Google Sheet (halaman impor_data_lama.html)
-- Tanggal : 2026-09-28
-- Syarat  : migrasi 20260928000000 s.d. 20260928060000 sudah dijalankan.
--
-- Fungsi `impor_data_mutu` menerima satu batch baris data_mutu_harian:
--   * khusus role administrator;
--   * memvalidasi unit, formulir, bulan, tahun, dan format data_input;
--   * MELEWATI kombinasi unit + indikator + bulan + tahun yang SUDAH ADA
--     di Supabase (data yang sudah diinput langsung di aplikasi menang);
--   * satu batch = satu transaksi (gagal = tidak ada yang masuk);
--   * dicatat sebagai 1 entri ringkasan di Log Audit per batch.
-- Halaman impor tidak pernah memecah satu kombinasi ke 2 batch, sehingga
-- aman dijalankan ulang: kombinasi yang sudah terimpor otomatis dilewati.
--
-- Aman dijalankan ulang.
-- =====================================================================

begin;

-- Izinkan aksi 'IMPOR' di log audit
alter table public.audit_log drop constraint if exists audit_log_aksi_check;
alter table public.audit_log add constraint audit_log_aksi_check
  check (aksi in ('INSERT', 'UPDATE', 'DELETE', 'TUTUP_TAHUN', 'IMPOR'));

create or replace function public.impor_data_mutu(p_rows jsonb, p_sumber text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_masuk      int := 0;
  v_dilewati   int := 0;
  v_komb_skip  jsonb;
  v_salah      text;
  v_hasil      jsonb;
begin
  if not public.mutu_is_admin() then
    raise exception 'Hanya role administrator yang dapat mengimpor data.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Format data tidak valid.';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Satu batch maksimal 5.000 baris.';
  end if;

  create temp table _impor on commit drop as
  select x.unit_kerja, x.id_indikator, x.bulan, x.tahun,
         coalesce(nullif(trim(x.petugas_input), ''), 'Impor Google Sheet') as petugas_input,
         x.data_input
    from jsonb_to_recordset(p_rows)
      as x(unit_kerja text, id_indikator text, bulan int, tahun int, petugas_input text, data_input jsonb);

  -- Validasi
  select format('unit "%s" tidak ada di daftar unit', unit_kerja) into v_salah
    from _impor i where not exists (select 1 from public.master_unit u where u.nama_unit = i.unit_kerja) limit 1;
  if v_salah is null then
    select format('formulir "%s" tidak ada di Form Builder', id_indikator) into v_salah
      from _impor i where not exists (select 1 from public.setup_formulir f where f.id_form = i.id_indikator) limit 1;
  end if;
  if v_salah is null then
    select 'bulan/tahun tidak valid' into v_salah
      from _impor where bulan not between 1 and 12 or tahun not between 2000 and 2100 limit 1;
  end if;
  if v_salah is null then
    select 'data_input harus berupa array' into v_salah
      from _impor where jsonb_typeof(data_input) is distinct from 'array' limit 1;
  end if;
  if v_salah is not null then
    raise exception 'Impor dibatalkan: %', v_salah;
  end if;

  -- Cegah input bersamaan saat pengecekan kombinasi
  lock table public.data_mutu_harian in share row exclusive mode;

  -- Kombinasi yang sudah ada di Supabase -> dilewati
  create temp table _ada on commit drop as
  select distinct i.unit_kerja, i.id_indikator, i.bulan, i.tahun
    from _impor i
   where exists (select 1 from public.data_mutu_harian d
                  where d.unit_kerja = i.unit_kerja and d.id_indikator = i.id_indikator
                    and d.bulan = i.bulan and d.tahun = i.tahun);

  select count(*) into v_dilewati
    from _impor i join _ada a using (unit_kerja, id_indikator, bulan, tahun);

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_komb_skip from _ada a;

  -- Audit per baris dimatikan untuk impor massal (diganti 1 entri ringkasan)
  perform set_config('mutu.lewati_audit', 'on', true);

  insert into public.data_mutu_harian (unit_kerja, id_indikator, bulan, tahun, petugas_input, data_input)
  select i.unit_kerja, i.id_indikator, i.bulan, i.tahun, i.petugas_input, i.data_input
    from _impor i
   where not exists (select 1 from _ada a
                      where a.unit_kerja = i.unit_kerja and a.id_indikator = i.id_indikator
                        and a.bulan = i.bulan and a.tahun = i.tahun);
  get diagnostics v_masuk = row_count;

  perform set_config('mutu.lewati_audit', 'off', true);

  v_hasil := jsonb_build_object(
    'dimasukkan', v_masuk,
    'dilewati', v_dilewati,
    'kombinasi_dilewati', v_komb_skip
  );

  insert into public.audit_log (user_id, user_email, user_nama, user_role, tabel, aksi, id_baris, data_baru)
  select auth.uid(), u.email, p.nama_lengkap, p.role, 'data_mutu_harian', 'IMPOR',
         left(coalesce(p_sumber, 'Google Sheet'), 200),
         v_hasil - 'kombinasi_dilewati' || jsonb_build_object('jumlah_kombinasi_dilewati', jsonb_array_length(v_komb_skip))
    from (select 1) x
    left join public.profiles p on p.id = auth.uid()
    left join auth.users u on u.id = auth.uid();

  return v_hasil;
end $$;

revoke execute on function public.impor_data_mutu(jsonb, text) from public, anon;
grant  execute on function public.impor_data_mutu(jsonb, text) to authenticated;

-- Akses halaman impor untuk semua role administrator (RBAC)
update public.role_permissions
   set allowed_pages = concat_ws(',', nullif(allowed_pages, ''), 'impor_data_lama.html')
 where is_admin
   and coalesce(allowed_pages, '') not like '%impor_data_lama.html%';

commit;
