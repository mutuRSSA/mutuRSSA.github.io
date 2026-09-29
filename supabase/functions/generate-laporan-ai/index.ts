// =====================================================================
// Edge Function: generate-laporan-ai
// Analis AI untuk Laporan Periodik Terintegrasi (laporan_komprehensif.html).
//
// Alur "agentik" dijalankan oleh halaman: satu panggilan per tugas
//   mutu | keselamatan | budaya | risiko   -> analisis tiap komponen
//   integrasi                              -> keterkaitan antar komponen
//   eksekutif                              -> ringkasan eksekutif
//   unit                                   -> umpan balik & saran untuk satu unit
// Halaman lalu memeriksa angka di narasi terhadap data (grounding) dan
// Komite menyunting hasilnya sebelum laporan difinalkan.
//
// Penyedia AI gratis (API key disimpan sebagai SECRET, tidak pernah ke browser):
//   GEMINI_API_KEY (+ GEMINI_MODEL, bawaan "gemini-2.5-flash") — Google AI Studio, gratis
//                  ±10 permintaan/menit. Catatan: pada tingkat gratis Google dapat
//                  memakai isian untuk pengembangan produk; karena itu hanya angka
//                  agregat tanpa identitas yang dikirim.
//   GROQ_API_KEY   (+ GROQ_MODEL,   bawaan "openai/gpt-oss-120b") — console.groq.com,
//                  gratis ±30 permintaan/menit, 8.000 token/menit (cadangan).
//   AI_PENYEDIA    urutan coba, bawaan "gemini,groq"
// Hanya data AGREGAT yang dikirim; kolom identitas dibuang lagi di sini.
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // ganti ke domain aplikasi setelah deploy
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TUGAS = ["mutu", "keselamatan", "budaya", "risiko", "integrasi", "eksekutif", "unit"] as const;
type Tugas = typeof TUGAS[number];

// Kunci yang tidak boleh ikut ke AI walau terkirim dari browser
const KUNCI_TERLARANG = new Set(["kronologi", "nama_pasien", "no_rm", "nama_pelapor", "detail_spesifik", "tindakan_segera", "pelaksana_tindakan", "email"]);
const BATAS_KONTEKS = 22000; // karakter JSON (batas token/menit penyedia gratis)

const ATURAN_UMUM = `Anda adalah analis Komite Mutu dan Keselamatan Pasien sebuah rumah sakit di Indonesia.
Tulis dalam bahasa Indonesia baku yang lugas untuk laporan resmi kepada Direktur (standar akreditasi KARS / STARKES).
ATURAN WAJIB:
1. Gunakan HANYA angka, nama indikator, unit, dan fakta yang ada di DATA. Jangan mengarang angka, persentase, kejadian, nama orang, atau regulasi yang tidak disebut.
2. Setiap angka yang Anda tulis harus sama persis dengan DATA (boleh dibulatkan ke 1 desimal). Jangan menghitung rata-rata baru kecuali jelas dari DATA.
3. Bila data kosong atau tidak cukup, katakan terus terang (misalnya "belum ada data survei pada periode ini") dan jangan berspekulasi.
4. Jangan menyalahkan individu; gunakan pendekatan sistem (just culture). Jangan menyebut identitas pasien atau pelapor.
5. Hindari pembuka klise seperti "Berdasarkan data di atas". Langsung ke substansi.
6. Keluarkan HANYA satu objek JSON valid sesuai SKEMA, tanpa teks lain, tanpa markdown.`;

const SKEMA_KOMPONEN = `{"ringkasan": "satu kalimat inti", "pembahasan": ["paragraf 1", "paragraf 2", "... (3-5 paragraf, masing-masing 3-6 kalimat)"], "temuan_kunci": ["poin singkat", "..."], "rekomendasi": [{"uraian": "tindakan konkret", "penanggung_jawab": "unit/jabatan", "prioritas": "tinggi|sedang|rendah"}]}`;

const INSTRUKSI: Record<Tugas, string> = {
  mutu: `Buat pembahasan KOMPONEN MUTU. Bahas: (a) gambaran capaian per kategori (INM, IMP-RS, IMP-Unit); (b) indikator yang tidak tercapai, terutama yang tidak tercapai beberapa bulan berturut-turut atau memburuk dibanding periode sebelumnya / tahun lalu; (c) status dan efektivitas PDSA untuk indikator tersebut; (d) keandalan data: kepatuhan pelaporan unit dan hasil validasi. Rekomendasi 3-5 butir. SKEMA: ${SKEMA_KOMPONEN}`,
  keselamatan: `Buat pembahasan KOMPONEN KESELAMATAN PASIEN (IKP dan KPC). Bahas: (a) jumlah dan sebaran jenis (KTD, KNC, KTC, Sentinel, KPC) serta grading, dibanding periode sebelumnya bila ada; (b) rasio laporan nyaris cedera (KNC+KTC+KPC) terhadap KTD sebagai cermin budaya melapor; (c) tipe insiden dan unit terbanyak; (d) kejadian sentinel dan pelaporan ke KNKP; (e) ketepatan waktu pelaporan (2x24 jam), investigasi yang melewati batas, dan tindak lanjut rekomendasi yang terbuka/terlambat. Rekomendasi 3-5 butir. SKEMA: ${SKEMA_KOMPONEN}`,
  budaya: `Buat pembahasan BUDAYA KESELAMATAN PASIEN dari hasil survei. Bahas: (a) tingkat respons dibanding target; (b) skor empat budaya (lapor, adil, fleksibel, belajar) dan 12 dimensi, dimensi terkuat dan terlemah (ambang: >=75% kuat, <50% perlu perbaikan); (c) perubahan dibanding periode survei sebelumnya bila ada; (d) profil responden bila relevan. Bila tidak ada survei pada periode ini, jelaskan singkat dan sebutkan hasil survei terakhir yang tersedia di DATA. Rekomendasi 2-4 butir. SKEMA: ${SKEMA_KOMPONEN}`,
  risiko: `Buat pembahasan MANAJEMEN RISIKO dan FMEA. Bahas: (a) register risiko: jumlah per tingkat, per kategori, status verifikasi; (b) profil risiko RS (Tinggi/Ekstrem) dan penetapannya; (c) efektivitas penanganan: tindakan selesai vs terlambat, review berkala yang jatuh tempo; (d) FMEA: proses yang dianalisis, titik kritis RPN >= 80, dan penurunan RPN setelah tindakan. Rekomendasi 3-5 butir. SKEMA: ${SKEMA_KOMPONEN}`,
  integrasi: `Buat PEMBAHASAN TERINTEGRASI yang menghubungkan mutu, keselamatan pasien, budaya keselamatan, dan manajemen risiko. Gunakan tabel "tema" (keterkaitan per topik, misalnya pasien jatuh, obat, identifikasi, infeksi) dan "unit_prioritas" (unit dengan sinyal dari beberapa komponen) di DATA, serta ringkasan tiap komponen. Bahas: (a) tema yang muncul di lebih dari satu komponen dan apa artinya; (b) apakah profil risiko RS sudah mencerminkan insiden dan indikator yang bermasalah (celah atau keselarasan); (c) keselarasan budaya melapor dengan pola laporan insiden; (d) unit yang perlu pendampingan terpadu; (e) status tindak lanjut laporan sebelumnya. SKEMA: {"pembahasan": ["4-6 paragraf"], "keterkaitan": [{"tema": "nama tema", "uraian": "hubungan antarkomponen"}], "rekomendasi_strategis": [{"uraian": "arah kebijakan konkret untuk Direktur", "penanggung_jawab": "unit/jabatan", "tenggat_saran": "misal: triwulan berikutnya", "prioritas": "tinggi|sedang|rendah"}]}`,
  eksekutif: `Buat RINGKASAN EKSEKUTIF satu halaman untuk Direktur dari seluruh DATA dan ringkasan komponen. SKEMA: {"ringkasan_eksekutif": ["2-3 paragraf padat"], "sorotan": ["4-6 poin terpenting, masing-masing satu kalimat berisi angka dari DATA"]}`,
  unit: `Buat UMPAN BALIK untuk kepala satu unit kerja berdasarkan DATA unit tersebut pada periode ini (indikator mutu unit, kepatuhan pelaporan, insiden, risiko, PDSA, validasi). Nada konstruktif dan menghargai; saran harus konkret dan dapat dikerjakan unit dalam periode berikutnya. SKEMA: {"ringkasan": "2-3 kalimat", "apresiasi": ["hal yang sudah baik"], "perhatian": ["hal yang perlu diperhatikan, dengan angka"], "saran": ["saran tindakan konkret untuk unit"]}`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ---------- otentikasi & otorisasi (jangan percaya client) ----------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Tidak terautentikasi." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData.user) return json({ error: "Sesi tidak valid, silakan login ulang." }, 401);
    const { data: profil } = await admin.from("profiles").select("role, status, wajib_ganti_password").eq("id", userData.user.id).single();
    if (!profil || profil.status !== "Aktif" || profil.wajib_ganti_password) return json({ error: "Profil tidak aktif." }, 403);
    const { data: rp } = await admin.from("role_permissions").select("is_admin").eq("role", profil.role).maybeSingle();
    if (!rp?.is_admin) return json({ error: "Fitur ini khusus untuk role administrator." }, 403);

    // ---------- masukan ----------
    const body = await req.json().catch(() => ({}));
    const tugas = body?.tugas as Tugas;
    if (!TUGAS.includes(tugas)) return json({ error: "Tugas AI tidak dikenal." }, 400);
    const periode = String(body?.periode || "").slice(0, 120);
    const konteks = bersihkan(body?.konteks ?? {});
    const teksKonteks = JSON.stringify(konteks);
    if (teksKonteks.length > BATAS_KONTEKS) {
      return json({ error: `Data untuk AI terlalu besar (${teksKonteks.length} karakter, batas ${BATAS_KONTEKS}).` }, 413);
    }

    const sistem = ATURAN_UMUM;
    const pengguna = `PERIODE LAPORAN: ${periode}\nTUGAS: ${INSTRUKSI[tugas]}\n\nDATA (JSON):\n${teksKonteks}`;

    // ---------- panggil penyedia secara berurutan ----------
    const urutan = (Deno.env.get("AI_PENYEDIA") || "gemini,groq").split(",").map((s) => s.trim().toLowerCase());
    const galat: string[] = [];
    let tunggu = 0;
    for (const p of urutan) {
      try {
        const r = p === "groq" ? await panggilGroq(sistem, pengguna) : p === "gemini" ? await panggilGemini(sistem, pengguna) : null;
        if (!r) continue;
        if (r.batas) { tunggu = Math.max(tunggu, r.batas); galat.push(`${p}: batas pemakaian`); continue; }
        const hasil = uraiJson(r.teks);
        if (!hasil) { galat.push(`${p}: jawaban bukan JSON`); continue; }
        return json({ hasil, model: r.model, pemakaian: r.pemakaian ?? null }, 200);
      } catch (e) {
        galat.push(`${p}: ${(e as Error).message}`);
      }
    }
    if (tunggu) return json({ error: "Batas pemakaian AI gratis tercapai, coba lagi sebentar.", tunggu_detik: tunggu, rincian: galat }, 429);
    return json({ error: "Layanan AI tidak tersedia. " + (galat.join("; ") || "Belum ada API key (GROQ_API_KEY / GEMINI_API_KEY)."), rincian: galat }, 502);
  } catch (err) {
    console.error(err);
    return json({ error: "Terjadi kesalahan internal server." }, 500);
  }
});

type Jawaban = { teks: string; model: string; pemakaian?: unknown; batas?: number };

async function panggilGroq(sistem: string, pengguna: string): Promise<Jawaban | null> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
  const kirim = async (modeJson: boolean) => {
    const isi: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: sistem }, { role: "user", content: pengguna }],
      temperature: 0.2,
      max_completion_tokens: 2500,
    };
    if (modeJson) isi.response_format = { type: "json_object" };
    if (model.startsWith("openai/gpt-oss")) isi.reasoning_effort = "low";
    return await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(isi),
    });
  };
  let res = await kirim(true);
  if (res.status === 400) res = await kirim(false); // sebagian model menolak mode JSON
  if (res.status === 429) return { teks: "", model, batas: detikTunggu(res) };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return { teks: d?.choices?.[0]?.message?.content || "", model: "groq:" + model, pemakaian: d?.usage };
}

async function panggilGemini(sistem: string, pengguna: string): Promise<Jawaban | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistem }] },
      contents: [{ role: "user", parts: [{ text: pengguna }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 4096 },
    }),
  });
  if (res.status === 429) return { teks: "", model, batas: detikTunggu(res) };
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const teks = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
  return { teks, model: "gemini:" + model, pemakaian: d?.usageMetadata };
}

function detikTunggu(res: Response): number {
  const h = Number(res.headers.get("retry-after"));
  return Number.isFinite(h) && h > 0 ? Math.min(Math.ceil(h), 120) : 20;
}

function uraiJson(teks: string): Record<string, unknown> | null {
  if (!teks) return null;
  const bersih = teks.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(bersih); } catch { /* ambil objek terluar */ }
  const a = bersih.indexOf("{"), b = bersih.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(bersih.slice(a, b + 1)); } catch { /* gagal */ } }
  return null;
}

function bersihkan(v: unknown, dalam = 0): unknown {
  if (dalam > 12) return null;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => bersihkan(x, dalam + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!KUNCI_TERLARANG.has(k)) o[k] = bersihkan(x, dalam + 1);
    }
    return o;
  }
  if (typeof v === "string") return v.slice(0, 400);
  return v;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
