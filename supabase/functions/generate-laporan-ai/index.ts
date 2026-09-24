// =====================================================================
// Edge Function: generate-laporan-ai
// Ganti pemanggilan Groq langsung dari browser (laporan_komprehensif.html).
// GROQ_API_KEY disimpan sebagai secret di Supabase, TIDAK PERNAH dikirim
// ke client. Function ini juga memvalidasi ulang role user di server —
// jangan hanya andalkan pengecekan role di sisi client (bisa dilewati).
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // ganti ke domain GitHub Pages Anda setelah deploy, mis. "https://username.github.io"
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Tidak terautentikasi." }, 401);
    }

    // Client dengan hak akses SERVICE ROLE — dipakai untuk verifikasi user & role
    // di server, lepas dari RLS (karena kita yang melakukan pengecekan manual di sini).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verifikasi token JWT milik user yang memanggil function ini
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Sesi tidak valid, silakan login ulang." }, 401);
    }

    // Cek role di server (JANGAN percaya role yang dikirim dari client)
    const { data: profil, error: profilError } = await supabaseAdmin
      .from("profiles")
      .select("role, status")
      .eq("id", userData.user.id)
      .single();

    if (profilError || !profil || profil.status !== "Aktif") {
      return jsonResponse({ error: "Profil tidak ditemukan atau nonaktif." }, 403);
    }

    if (!["Komite Mutu", "Super Admin"].includes(profil.role)) {
      return jsonResponse({ error: "Halaman ini khusus untuk Komite Mutu / Super Admin." }, 403);
    }

    // Ambil ringkasan data yang dikirim dari client (BUKAN data mentah pasien —
    // hanya angka agregat yang memang sudah dihitung di client untuk prompt AI)
    const body = await req.json();
    const {
      periodeTxt,
      statDataMutu,
      statDataInsiden,
      jumlahRisiko,
      jumlahFmea,
      jumlahBudaya,
    } = body;

    if (!periodeTxt || !statDataMutu || !statDataInsiden) {
      return jsonResponse({ error: "Parameter laporan tidak lengkap." }, 400);
    }

    const budayaTxt =
      (jumlahBudaya || 0) > 0
        ? `Terdapat hasil survei budaya keselamatan pasien pada periode ini dengan total ${jumlahBudaya} responden.`
        : `Tidak ada survei budaya keselamatan pasien yang dilakukan pada periode ini.`;

    const promptText = `Anda adalah seorang Direktur Peningkatan Mutu Rumah Sakit yang sangat profesional.
Tugas Anda adalah menulis Bab "ANALISIS TERINTEGRASI DAN TINDAK LANJUT" untuk Laporan Komite Mutu periode ${periodeTxt} dalam bahasa Indonesia yang sangat formal, terstruktur, dan elegan sesuai standar akreditasi KARS/JCI.

Berikut adalah ringkasan data riil periode ini:
1. DATA MUTU: Total indikator dipantau: ${statDataMutu.total}. Tercapai: ${statDataMutu.tercapai}, Gagal: ${statDataMutu.gagal}. Rata-rata capaian INM adalah ${statDataMutu.avgInm}%. Sebagian besar indikator gagal telah dilakukan perbaikan (PDSA).
2. DATA INSIDEN (IKP): Terjadi total ${statDataInsiden.total} insiden. Ekstrem/Merah: ${statDataInsiden.merah}, Tinggi/Kuning: ${statDataInsiden.kuning}, Sedang/Hijau: ${statDataInsiden.hijau}, Rendah/Biru: ${statDataInsiden.biru}.
3. DATA RISIKO & FMEA: Terdapat ${jumlahRisiko || 0} risiko prioritas di Profil RS, dan ${jumlahFmea || 0} proyek redesain FMEA sedang berjalan.
4. BUDAYA KESELAMATAN: ${budayaTxt}

TUGAS ANDA:
Buatkan output teks HANYA dalam format HTML (gunakan tag <p>, <ul>, <li>, <b> langsung, tanpa <html> atau <body>) yang mencakup:
1. Bahas korelasi antara capaian mutu (terutama keberhasilan PDSA) dengan tren insiden keselamatan pasien (jenis/grading).
2. Hubungkan analisis tersebut dengan Manajemen Risiko (FMEA) dan Budaya Keselamatan Pasien di rumah sakit.
3. Berikan 3 poin "Rekomendasi Strategis Direktur" (menggunakan bullet points) untuk triwulan berikutnya.

Aturan ketat: DILARANG menggunakan kalimat pembuka murahan seperti 'Berdasarkan data di atas'. Langsung gunakan gaya bahasa laporan eksekutif.`;

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) {
      return jsonResponse({ error: "GROQ_API_KEY belum diset di secrets Supabase." }, 500);
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + groqApiKey,
      },
      body: JSON.stringify({
        model: "qwen-2.5-32b",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.3,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error("Groq error:", errText);
      return jsonResponse({ error: "Gagal terhubung ke API AI Groq." }, 502);
    }

    const groqData = await groqResponse.json();
    const content = groqData?.choices?.[0]?.message?.content;
    if (!content) {
      return jsonResponse({ error: "Format respons AI tidak dikenali." }, 502);
    }

    const cleaned = content.replace(/```html/g, "").replace(/```/g, "");
    return jsonResponse({ content: cleaned }, 200);

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Terjadi kesalahan internal server." }, 500);
  }
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
