-- =====================================================================
-- Migrasi: Tanggapan Direktur per komponen laporan & identitas dinas induk
-- Tanggal : 2026-09-29
-- Syarat  : migrasi sampai 20260929140000 sudah dijalankan.
--
--   * laporan_periodik.tanggapan_direktur (jsonb):
--       {"mutu": "...", "keselamatan": "...", "budaya": "...", "risiko": "...",
--        "umum": "...", "rekomendasi": [{"uraian": "...", "keputusan": "setuju|revisi|tidak", "catatan": "..."}]}
--     Diisi Komite dari Lembar Tanggapan Direktur yang sudah ditandatangani;
--     ikut terkunci setelah laporan disetujui dan tersalin ke riwayat.
--   * pengaturan_institusi.dinas_induk : baris kop di bawah pemilik
--     (mis. "Dinas Kesehatan"), dipakai sampul & kop laporan.
-- Aman dijalankan ulang.
-- =====================================================================

begin;

alter table public.laporan_periodik add column if not exists tanggapan_direktur jsonb not null default '{}'::jsonb;
alter table public.laporan_periodik_riwayat add column if not exists tanggapan_direktur jsonb;

alter table public.pengaturan_institusi add column if not exists dinas_induk text default 'Dinas Kesehatan';
update public.pengaturan_institusi set dinas_induk = 'Dinas Kesehatan' where dinas_induk is null;

-- SECURITY DEFINER: menulis riwayat (tabel riwayat tidak dapat ditulis langsung oleh pengguna)
create or replace function public.jaga_laporan_periodik()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nama text := (select nama_lengkap from public.profiles where id = auth.uid());
  v_ket  text;
begin
  if tg_op = 'INSERT' then
    new.status := 'draf';
    new.versi := case when new.data is null then 0 else 1 end;
    new.dibuat_oleh := coalesce(v_nama, new.dibuat_oleh, 'sistem');
    new.diperbarui_oleh := new.dibuat_oleh;
    new.diajukan_pada := null; new.disetujui_pada := null;
    if new.data is not null then new.dikompilasi_pada := now(); new.dikompilasi_oleh := new.dibuat_oleh; end if;
    return new;
  end if;

  if coalesce(current_setting('mutu.lewati_audit', true), '') = 'on' then return new; end if;

  if old.status = 'disetujui' then
    -- Laporan disetujui terkunci; hanya boleh dibuka kembali menjadi draf (isi tetap)
    if new.status <> 'draf' then
      if new.data is distinct from old.data or new.narasi is distinct from old.narasi
         or new.disposisi_direktur is distinct from old.disposisi_direktur
         or new.tanggapan_direktur is distinct from old.tanggapan_direktur then
        raise exception 'Laporan sudah disetujui dan terkunci. Buka kembali (menjadi draf) bila perlu revisi.';
      end if;
    else
      new.data := old.data; new.narasi := old.narasi; new.tanggapan_direktur := old.tanggapan_direktur;
      v_ket := 'Dibuka kembali untuk revisi';
    end if;
  elsif old.status = 'diajukan' and new.status = 'diajukan'
        and (new.data is distinct from old.data or new.narasi is distinct from old.narasi) then
    raise exception 'Laporan sedang diajukan ke Direktur. Kembalikan ke draf untuk mengubah isi.';
  end if;

  -- Kompilasi ulang = versi baru
  if new.data is distinct from old.data then
    new.versi := old.versi + 1;
    new.dikompilasi_pada := now();
    new.dikompilasi_oleh := coalesce(v_nama, 'sistem');
  end if;

  if new.status is distinct from old.status then
    if new.status = 'diajukan' then
      if new.data is null then raise exception 'Kompilasi data terlebih dahulu sebelum laporan diajukan.'; end if;
      new.diajukan_oleh := coalesce(v_nama, 'Komite Mutu');
      new.diajukan_pada := now();
      v_ket := 'Diajukan ke Direktur';
    elsif new.status = 'disetujui' then
      if old.status <> 'diajukan' then raise exception 'Laporan harus diajukan ke Direktur terlebih dahulu.'; end if;
      if coalesce(btrim(new.disposisi_direktur), '') = '' then
        raise exception 'Isi disposisi / arahan Direktur sebelum menandai laporan disetujui.';
      end if;
      new.disetujui_oleh := coalesce(nullif(btrim(new.disetujui_oleh), ''), (select direktur_nama from public.pengaturan_institusi where id = 1), 'Direktur');
      new.disetujui_pada := now();
      new.tanggal_disposisi := coalesce(new.tanggal_disposisi, current_date);
      v_ket := 'Disetujui Direktur';
    elsif new.status = 'draf' then
      v_ket := coalesce(v_ket, 'Dikembalikan ke draf');
      new.disetujui_pada := null;
    end if;
  end if;

  if v_ket is not null then
    insert into public.laporan_periodik_riwayat (id_laporan, versi, status, keterangan, data, narasi, disposisi_direktur, tanggapan_direktur, dicatat_oleh)
    values (new.id, new.versi, new.status, v_ket, new.data, new.narasi, new.disposisi_direktur, new.tanggapan_direktur, coalesce(v_nama, 'sistem'));
  end if;
  new.diperbarui_oleh := coalesce(v_nama, 'sistem');
  new.diperbarui_pada := now();
  return new;
end $$;
drop trigger if exists jaga_laporan_periodik on public.laporan_periodik;
create trigger jaga_laporan_periodik before insert or update on public.laporan_periodik
  for each row execute function public.jaga_laporan_periodik();


commit;
