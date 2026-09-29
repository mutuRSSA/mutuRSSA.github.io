// =====================================================================
// Skala & aturan manajemen risiko (dipakai Risk Register, Dasbor Risiko,
// Profil Risiko RS). Matriks SAMA dengan grading IKP dan dengan fungsi
// database mutu_tingkat_risiko() — bila diubah, ubah keduanya.
// =====================================================================

const RISIKO_KATEGORI = [
    "A. RISIKO KLINIS", "B. RISIKO KESELAMATAN PASIEN", "C. RISIKO FASILITAS DAN PERALATAN MEDIS",
    "D. RISIKO KEAMANAN", "E. RISIKO KESEHATAN KERJA STAF (K3RS)", "F. RISIKO INFEKSI",
    "G. RISIKO KEUANGAN", "H. RISIKO HUKUM", "I. RISIKO REPUTASI",
    "J. RISIKO TEKNOLOGI INFORMASI", "K. RISIKO BENCANA", "L. LAINNYA (BELUM DIKATEGORIKAN)"
];

const RISIKO_SUMBER = ['Insiden (IKP/KPC)', 'Audit / supervisi', 'Komplain', 'Indikator mutu', 'Rapat / curah pendapat', 'FMEA', 'Regulasi baru', 'Lainnya'];

// Skala dampak: pakai angka TERTINGGI bila satu risiko menyentuh beberapa kolom
const RISIKO_KOLOM_DAMPAK = ['Pasien (klinis)', 'Staf & pengunjung (K3)', 'Pelayanan & operasional', 'Keuangan', 'Hukum & regulasi', 'Reputasi'];
const RISIKO_DAMPAK = [
    { skor: 1, nama: 'Tidak signifikan', uraian: ['Tidak ada cedera', 'Tidak ada cedera', 'Gangguan < 1 jam, pasien tidak terdampak', '< Rp 5 juta', 'Tidak ada pelanggaran', 'Keluhan internal, tidak keluar RS'] },
    { skor: 2, nama: 'Minor', uraian: ['Cedera ringan, cukup pertolongan pertama, tanpa tambahan hari rawat', 'Cedera ringan, cukup P3K', 'Sebagian layanan terganggu < 1 hari', 'Rp 5–50 juta', 'Ketidaksesuaian ringan, teguran lisan', 'Keluhan pasien/keluarga, tidak menyebar'] },
    { skor: 3, nama: 'Moderat', uraian: ['Cedera sedang, fungsi berkurang sementara (pulih), atau hari rawat bertambah', 'Cedera perlu pengobatan atau cuti sakit', 'Satu layanan terhenti 1–3 hari', 'Rp 50–250 juta', 'Temuan audit atau teguran tertulis', 'Pemberitaan lokal / media sosial terbatas'] },
    { skor: 4, nama: 'Mayor', uraian: ['Cedera berat, kehilangan fungsi permanen', 'Cedera berat atau cacat permanen', 'Layanan penting terhenti > 3 hari, pasien harus dirujuk', 'Rp 250 juta–1 miliar', 'Sanksi administratif, gugatan, atau tuntutan hukum', 'Pemberitaan regional atau nasional'] },
    { skor: 5, nama: 'Katastropik', uraian: ['Kematian yang tidak berhubungan dengan perjalanan penyakit', 'Kematian staf atau pengunjung', 'RS / layanan utama terhenti > 1 minggu', '> Rp 1 miliar', 'Pencabutan izin / status akreditasi, perkara pidana', 'Pemberitaan nasional berkepanjangan, kepercayaan publik turun'] }
];
const RISIKO_PROB = [
    { skor: 1, nama: 'Sangat jarang', kejadian: '> 5 tahun sekali', perkiraan: 'Hampir tidak mungkin terjadi' },
    { skor: 2, nama: 'Jarang', kejadian: '2–5 tahun sekali', perkiraan: 'Kecil kemungkinan terjadi' },
    { skor: 3, nama: 'Mungkin', kejadian: '1–2 tahun sekali', perkiraan: 'Bisa terjadi sesekali' },
    { skor: 4, nama: 'Sering', kejadian: 'Beberapa kali setahun', perkiraan: 'Besar kemungkinan terjadi' },
    { skor: 5, nama: 'Sangat sering', kejadian: 'Tiap minggu / bulan', perkiraan: 'Hampir pasti terjadi' }
];

// Matriks [dampak][probabilitas] (sama dengan grading IKP)
const RISIKO_MATRIKS = {
    5: ['Ekstrem', 'Ekstrem', 'Ekstrem', 'Ekstrem', 'Ekstrem'],
    4: ['Tinggi', 'Tinggi', 'Ekstrem', 'Ekstrem', 'Ekstrem'],
    3: ['Moderat', 'Moderat', 'Tinggi', 'Tinggi', 'Tinggi'],
    2: ['Rendah', 'Rendah', 'Moderat', 'Moderat', 'Moderat'],
    1: ['Rendah', 'Rendah', 'Rendah', 'Moderat', 'Moderat']
};
function risikoTingkat(dampak, prob) {
    const d = parseInt(dampak, 10), p = parseInt(prob, 10);
    return (RISIKO_MATRIKS[d] && p >= 1 && p <= 5) ? RISIKO_MATRIKS[d][p - 1] : null;
}
const RISIKO_TINGKAT = {
    Ekstrem: { warna: 'Merah',  bg: '#dc3545', fg: '#fff', urut: 4, keputusan: 'Tindakan segera; naik ke profil risiko RS', review: 'Bulanan' },
    Tinggi:  { warna: 'Kuning', bg: '#ffc107', fg: '#000', urut: 3, keputusan: 'Ditangani dengan prioritas; kandidat profil risiko RS', review: 'Triwulanan' },
    Moderat: { warna: 'Hijau',  bg: '#198754', fg: '#fff', urut: 2, keputusan: 'Dikelola unit dengan rencana penanganan', review: 'Semesteran' },
    Rendah:  { warna: 'Biru',   bg: '#0d6efd', fg: '#fff', urut: 1, keputusan: 'Boleh diterima dengan kontrol rutin', review: 'Tahunan' }
};
function risikoBadge(tingkat, skor) {
    const t = RISIKO_TINGKAT[tingkat];
    if (!t) return '<span class="badge bg-secondary">Belum dinilai</span>';
    return `<span class="badge" style="background:${t.bg};color:${t.fg}">${tingkat}${skor ? ' · ' + skor : ''}</span>`;
}

const RISIKO_STATUS = {
    draft:    { label: 'Draf', kelas: 'bg-secondary' },
    diajukan: { label: 'Menunggu verifikasi', kelas: 'bg-info text-dark' },
    revisi:   { label: 'Perlu revisi', kelas: 'bg-warning text-dark' },
    aktif:    { label: 'Aktif', kelas: 'bg-success' },
    terkirim: { label: 'Aktif', kelas: 'bg-success' },
    ditutup:  { label: 'Ditutup', kelas: 'bg-dark' }
};
function risikoStatusBadge(status) {
    const s = RISIKO_STATUS[status] || { label: status || '-', kelas: 'bg-secondary' };
    return `<span class="badge ${s.kelas}">${s.label}</span>`;
}

const RISIKO_OPSI = { kurangi: 'Kurangi', hindari: 'Hindari', alihkan: 'Alihkan', terima: 'Terima' };
const RISIKO_STATUS_TINDAKAN = { rencana: 'Rencana', berjalan: 'Berjalan', selesai: 'Selesai', batal: 'Batal' };

// Tanggal ISO (yyyy-mm-dd) hari ini, waktu lokal
function risikoHariIni() {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
}
const risikoJatuhTempo = r => r.status === 'aktif' && r.review_berikutnya && r.review_berikutnya <= risikoHariIni();

if (typeof module !== 'undefined') module.exports = { RISIKO_MATRIKS, risikoTingkat, RISIKO_TINGKAT, RISIKO_DAMPAK, RISIKO_PROB, RISIKO_KATEGORI };
