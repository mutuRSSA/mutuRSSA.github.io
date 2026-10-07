-- =====================================================================
-- Migrasi: Verifikasi laporan insiden = menetapkan jenis insiden & grading
-- Tanggal : 2026-10-07
-- Syarat  : migrasi sampai 20261005090000 sudah dijalankan.
--
-- Dulu tombol Verifikasi meminta Komite MEMILIH jenis investigasi.
-- Sekarang verifikasi berarti Komite memeriksa dan (bila perlu) mengoreksi
-- JENIS INSIDEN serta SKOR DAMPAK & PROBABILITAS dari pelapor; grading
-- dihitung ulang dari matriks, lalu JENIS INVESTIGASI ditetapkan otomatis:
--   * Sentinel, atau grading Kuning/Merah (kecuali KPC)  -> RCA (45 hari)
--   * lainnya                                            -> investigasi sederhana
--     (Hijau 14 hari, Biru 7 hari); Komite boleh menaikkan ke RCA.
--
--   * Kolom *_pelapor : isian asli pelapor (jenis, skor, grading) disimpan saat
--     laporan masuk, sebagai jejak bila Komite mengoreksi.
--   * catatan_verifikasi : alasan koreksi / catatan Komite.
--   * jaga_alur_insiden diperbarui: memakai grading yang dihitung dari skor
--     terbaru pada UPDATE yang sama (dulu memakai grading lama karena trigger
--     grading berjalan sesudahnya), jenis investigasi diisi otomatis, dan
--     verifikasi ulang selama status Investigasi (sebelum hasil disimpan)
--     menghitung ulang jenis & batas investigasi.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.data_insiden add column if not exists jenis_insiden_pelapor     text;
alter table public.data_insiden add column if not exists skor_dampak_pelapor       int;
alter table public.data_insiden add column if not exists skor_probabilitas_pelapor int;
alter table public.data_insiden add column if not exists grading_pelapor           text;
alter table public.data_insiden add column if not exists catatan_verifikasi        text;

-- Data lama: isian pelapor = nilai saat ini (belum pernah dikoreksi lewat fitur ini)
do $$
begin
  perform set_config('mutu.lewati_audit', 'on', true);
  update public.data_insiden
     set jenis_insiden_pelapor = jenis_insiden, skor_dampak_pelapor = skor_dampak,
         skor_probabilitas_pelapor = skor_probabilitas, grading_pelapor = grading_risiko
   where jenis_insiden_pelapor is null and grading_pelapor is null;
  perform set_config('mutu.lewati_audit', 'off', true);
end $$;

-- Jenis investigasi wajib RCA?
create or replace function public.mutu_wajib_rca(p_jenis text, p_grading text)
returns boolean language sql immutable as $$
  select coalesce(p_jenis, '') = 'Sentinel' or (coalesce(p_jenis, '') <> 'KPC' and p_grading in ('Kuning', 'Merah'))
$$;
grant execute on function public.mutu_wajib_rca(text, text) to authenticated;

create or replace function public.jaga_alur_insiden()
returns trigger language plpgsql set search_path = public as $$
declare
  v_nama text;
  v_hari int;
  v_terbuka int;
  v_grading text;
  v_wajib boolean;
  v_verif_ulang boolean;
begin
  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then return new; end if;

  -- Grading dari skor TERBARU (trigger jaga_grading_insiden berjalan sesudah trigger ini)
  v_grading := coalesce(public.mutu_grading_insiden(new.jenis_insiden, new.skor_dampak, new.skor_probabilitas), new.grading_risiko);

  -- Laporan baru selalu masuk sebagai "Baru" (belum diverifikasi); isian pelapor disimpan
  if tg_op = 'INSERT' then
    new.status_investigasi := 'Baru';
    new.jenis_investigasi := null; new.batas_investigasi := null;
    new.diverifikasi_oleh := null; new.diverifikasi_pada := null; new.selesai_pada := null;
    new.catatan_verifikasi := null;
    new.jenis_insiden_pelapor := new.jenis_insiden;
    new.skor_dampak_pelapor := new.skor_dampak;
    new.skor_probabilitas_pelapor := new.skor_probabilitas;
    new.grading_pelapor := v_grading;
    return new;
  end if;

  -- Isian pelapor tidak bisa diubah setelah laporan masuk
  new.jenis_insiden_pelapor := old.jenis_insiden_pelapor;
  new.skor_dampak_pelapor := old.skor_dampak_pelapor;
  new.skor_probabilitas_pelapor := old.skor_probabilitas_pelapor;
  new.grading_pelapor := old.grading_pelapor;

  select nama_lengkap into v_nama from public.profiles where id = auth.uid();
  v_wajib := public.mutu_wajib_rca(new.jenis_insiden, v_grading);

  -- Verifikasi (Baru -> Investigasi) atau verifikasi ulang sebelum hasil investigasi disimpan
  v_verif_ulang := new.status_investigasi = 'Investigasi'
                   and (old.status_investigasi is distinct from 'Investigasi'
                        or new.jenis_insiden is distinct from old.jenis_insiden
                        or new.skor_dampak is distinct from old.skor_dampak
                        or new.skor_probabilitas is distinct from old.skor_probabilitas
                        or new.catatan_verifikasi is distinct from old.catatan_verifikasi);

  if new.status_investigasi = 'Investigasi' then
    -- Jenis investigasi mengikuti jenis insiden & grading terverifikasi; Komite boleh menaikkan ke RCA.
    if v_wajib then new.jenis_investigasi := 'rca';
    elsif new.jenis_investigasi is distinct from 'rca' then new.jenis_investigasi := 'sederhana';
    end if;
  elsif new.status_investigasi = 'Tindak Lanjut' then
    if new.jenis_investigasi is null then new.jenis_investigasi := case when v_wajib then 'rca' else 'sederhana' end; end if;
  end if;

  if new.status_investigasi in ('Investigasi', 'Tindak Lanjut') then
    -- Batas waktu investigasi (dari tanggal insiden): RCA 45 hari, Hijau 14 hari, Biru 7 hari
    if new.batas_investigasi is null or new.jenis_investigasi is distinct from old.jenis_investigasi
       or v_grading is distinct from old.grading_risiko then
      v_hari := case when new.jenis_investigasi = 'rca' then 45 when v_grading = 'Hijau' then 14 else 7 end;
      new.batas_investigasi := coalesce(new.waktu_insiden::date, new.waktu_lapor::date, current_date) + v_hari;
    end if;
    if new.diverifikasi_pada is null or v_verif_ulang then
      new.diverifikasi_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diverifikasi_pada := now();
    end if;
    if new.status_investigasi = 'Tindak Lanjut' and new.investigasi_komite is null then
      raise exception 'Simpan hasil investigasi terlebih dahulu.';
    end if;
    new.alasan_ditolak := null;
    new.selesai_pada := null;
  elsif new.status_investigasi = 'Ditolak' then
    if coalesce(btrim(new.alasan_ditolak), '') = '' then raise exception 'Alasan penolakan wajib diisi.'; end if;
    if old.status_investigasi is distinct from 'Ditolak' then
      new.diverifikasi_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diverifikasi_pada := now();
    end if;
  elsif new.status_investigasi = 'Selesai' then
    if new.investigasi_komite is null then raise exception 'Kasus belum diinvestigasi.'; end if;
    select count(*) into v_terbuka from public.insiden_tindak_lanjut
     where id_insiden = new.id_insiden and status in ('rencana', 'berjalan');
    if v_terbuka > 0 then raise exception 'Masih ada % tindak lanjut yang belum selesai.', v_terbuka; end if;
    if old.status_investigasi is distinct from 'Selesai' then new.selesai_pada := now(); end if;
  elsif new.status_investigasi = 'Baru' then
    new.jenis_investigasi := null;
    new.batas_investigasi := null; new.diverifikasi_oleh := null; new.diverifikasi_pada := null; new.selesai_pada := null;
  end if;
  return new;
end $$;

commit;
