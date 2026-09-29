-- =====================================================================
-- Persiapan bersama untuk semua berkas uji.
-- Dijalankan di dalam transaksi yang SELALU di-ROLLBACK oleh jalankan.mjs,
-- jadi tidak ada data uji yang tertinggal di database.
-- =====================================================================

-- Pengguna uji (auth.users minimal + profil + role)
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'komite.uji@contoh.test'),
  ('a0000000-0000-4000-8000-0000000000b1', 'petugas.uji@contoh.test'),
  ('a0000000-0000-4000-8000-0000000000b2', 'petugas2.uji@contoh.test')
on conflict (id) do nothing;

insert into public.role_permissions (role, allowed_pages, is_admin) values
  ('Uji Komite', '', true), ('Uji Petugas', '', false);

insert into public.profiles (id, nama_lengkap, role, unit_kerja, status, wajib_ganti_password) values
  ('a0000000-0000-4000-8000-0000000000a1', 'Komite Uji',   'Uji Komite',  'Non-Unit',   'Aktif', false),
  ('a0000000-0000-4000-8000-0000000000b1', 'Petugas Uji A', 'Uji Petugas', 'UNIT UJI A', 'Aktif', false),
  ('a0000000-0000-4000-8000-0000000000b2', 'Petugas Uji B', 'Uji Petugas', 'UNIT UJI B', 'Aktif', false)
on conflict (id) do update set nama_lengkap = excluded.nama_lengkap, role = excluded.role,
  unit_kerja = excluded.unit_kerja, status = excluded.status, wajib_ganti_password = false;

insert into public.master_unit (nama_unit) values ('UNIT UJI A'), ('UNIT UJI B');

-- ---------------------------------------------------------------------
-- Alat bantu
-- ---------------------------------------------------------------------
-- Bertindak sebagai pengguna tertentu (sama seperti permintaan dari aplikasi)
create function pg_temp.sebagai(p_siapa text) returns void language plpgsql as $$
declare v_id uuid := case p_siapa
    when 'komite'   then 'a0000000-0000-4000-8000-0000000000a1'
    when 'petugas'  then 'a0000000-0000-4000-8000-0000000000b1'
    when 'petugas2' then 'a0000000-0000-4000-8000-0000000000b2' end;
begin
  if p_siapa = 'sistem' then
    perform set_config('request.jwt.claims', '{}', true);
    perform set_config('role', session_user, true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.cek(p_ok boolean, p_pesan text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'GAGAL: %', p_pesan; end if;
end $$;

-- Perintah harus ditolak dengan pesan yang cocok dengan pola (regex, tanpa huruf besar/kecil)
create function pg_temp.harus_gagal(p_perintah text, p_pola text, p_pesan text) returns void language plpgsql as $$
begin
  begin
    execute p_perintah;
  exception when others then
    if sqlerrm !~* p_pola then
      raise exception 'GAGAL: % (ditolak dengan pesan lain: %)', p_pesan, sqlerrm;
    end if;
    return;
  end;
  raise exception 'GAGAL: % (perintah seharusnya ditolak)', p_pesan;
end $$;

do $$ begin execute format('grant usage on schema %I to authenticated', pg_my_temp_schema()::regnamespace::text); end $$;
