-- =====================================================================
-- Migrasi: Pengaturan institusi (identitas RS & pejabat penanda tangan)
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260928170000 sudah dijalankan.
--
-- Satu baris pengaturan dipakai semua laporan (kop, logo, tanda tangan),
-- menggantikan nama RS / logo / nama pejabat yang tertulis di kode.
-- Logo disimpan sebagai data URL (gambar kecil, maks. ±400 KB) agar laporan
-- tidak bergantung pada situs luar.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

create table if not exists public.pengaturan_institusi (
  id                  int primary key default 1 check (id = 1),
  nama_rs             text not null default 'RSUD Saras Adyatma',
  nama_singkat        text default 'RSUD Saras Adyatma',
  pemilik             text default 'Pemerintah Kabupaten Bantul',
  alamat              text,
  kota                text default 'Bantul',
  telepon             text,
  email               text,
  situs_web           text,
  logo_data           text check (logo_data is null or (logo_data like 'data:image/%' and length(logo_data) <= 600000)),
  direktur_nama       text,
  direktur_nip        text,
  ketua_komite_nama   text,
  ketua_komite_nip    text,
  sekretaris_komite_nama text,
  sekretaris_komite_nip  text,
  diperbarui_oleh     text,
  diperbarui_pada     timestamptz not null default now()
);
insert into public.pengaturan_institusi (id) values (1) on conflict (id) do nothing;

alter table public.pengaturan_institusi enable row level security;
grant select, update on public.pengaturan_institusi to authenticated;
revoke all on public.pengaturan_institusi from anon;

drop policy if exists institusi_baca on public.pengaturan_institusi;
create policy institusi_baca on public.pengaturan_institusi for select to authenticated
  using ((select public.mutu_aktif()));
drop policy if exists institusi_ubah on public.pengaturan_institusi;
create policy institusi_ubah on public.pengaturan_institusi for update to authenticated
  using ((select public.mutu_is_admin())) with check ((select public.mutu_is_admin()));

create or replace function public.isi_pembaru_institusi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := 1;
  new.diperbarui_pada := now();
  new.diperbarui_oleh := coalesce((select nama_lengkap from public.profiles where id = auth.uid()), new.diperbarui_oleh);
  return new;
end $$;
drop trigger if exists isi_pembaru_institusi on public.pengaturan_institusi;
create trigger isi_pembaru_institusi before update on public.pengaturan_institusi
  for each row execute function public.isi_pembaru_institusi();

drop trigger if exists audit_pengaturan_institusi on public.pengaturan_institusi;
create trigger audit_pengaturan_institusi after update on public.pengaturan_institusi
  for each row execute function public.audit_catat('id');

-- Nama & logo RS untuk halaman tanpa login (login, formulir publik)
create or replace function public.institusi_publik()
returns table (nama_rs text, nama_singkat text, logo_data text)
language sql stable security definer set search_path = public as $$
  select nama_rs, nama_singkat, logo_data from public.pengaturan_institusi where id = 1
$$;
grant execute on function public.institusi_publik() to anon, authenticated;

-- Halaman Pengaturan Institusi untuk role administrator
update public.role_permissions
   set allowed_pages = concat_ws(',', nullif(allowed_pages, ''), 'pengaturan_institusi.html')
 where is_admin
   and coalesce(allowed_pages, '') not like '%pengaturan_institusi.html%';

commit;
