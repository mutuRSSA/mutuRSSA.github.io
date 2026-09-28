// =====================================================================
// Edge Function: admin-manage-users
// Mengelola akun pengguna lewat Supabase Auth (password di-hash oleh
// Supabase, tidak pernah disimpan sebagai teks biasa) + tabel `profiles`.
//
// Hanya bisa dipanggil oleh user Aktif yang rolenya ditandai sebagai
// administrator (role_permissions.is_admin = true, diatur di Panel RBAC).
// Dicek ulang DI SERVER — role yang dikirim dari browser tidak dipercaya.
//
// Aksi (body JSON: { action, ... }):
//   list                         -> daftar semua akun (auth + profil)
//   create  {email, password, nama_lengkap, role, unit_kerja, status}
//   update  {id, email?, password?, nama_lengkap, role, unit_kerja, status}
//   delete  {id}
//   reset_password_default {id}  -> password = PASSWORD_DEFAULT ("muturssa"),
//                                   akun ditandai wajib ganti password
//   migrasi_legacy {domain, jalankan}
//                                -> pindahkan akun dari tabel lama `users`
//                                   ke Supabase Auth + profiles. jalankan=false
//                                   hanya pratinjau (tidak mengubah apa pun).
//
// Aksi untuk SEMUA pengguna login (bukan hanya admin):
//   ganti_password_sendiri {password_lama, password_baru}
//
// Status 'Nonaktif' juga mem-ban akun di Supabase Auth, sehingga user
// tidak bisa mendapatkan token baru sama sekali (bukan hanya dicegah di UI).
//
// Deploy:  supabase functions deploy admin-manage-users
// =====================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // ganti ke domain aplikasi Anda setelah deploy
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS_VALID = ["Aktif", "Nonaktif"];
const BAN_SELAMANYA = "876000h"; // ~100 tahun
const PANJANG_PASSWORD_MIN = 8;
// Password default setelah reset. Bisa diganti lewat secret:
//   supabase secrets set PASSWORD_DEFAULT=...
const PASSWORD_DEFAULT = Deno.env.get("PASSWORD_DEFAULT") ?? "muturssa";

type Profil = {
  id: string; nama_lengkap: string; role: string; unit_kerja: string; status: string;
  wajib_ganti_password?: boolean;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method tidak diizinkan." }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));

    // Aksi pengguna biasa: ganti password sendiri
    if (body.action === "ganti_password_sendiri") {
      const user = await verifikasiLogin(req, admin);
      await gantiPasswordSendiri(admin, user, body);
      return jsonResponse({ ok: true }, 200);
    }

    // Semua aksi lain: khusus admin
    const pemanggil = await verifikasiAdmin(req, admin);
    switch (body.action) {
      case "list":
        return jsonResponse({ users: await daftarAkun(admin) }, 200);
      case "create":
        return jsonResponse({ user: await buatAkun(admin, body) }, 200);
      case "update":
        return jsonResponse({ user: await ubahAkun(admin, body, pemanggil.id) }, 200);
      case "delete":
        await hapusAkun(admin, body, pemanggil.id);
        return jsonResponse({ ok: true }, 200);
      case "reset_password_default":
        await resetPasswordDefault(admin, body, pemanggil.id);
        return jsonResponse({ ok: true, password_default: PASSWORD_DEFAULT }, 200);
      case "migrasi_legacy":
        return jsonResponse(await migrasiLegacy(admin, body), 200);
      default:
        throw new HttpError(400, "Aksi tidak dikenali.");
    }
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    console.error(err);
    return jsonResponse({ error: "Terjadi kesalahan internal server." }, 500);
  }
});

// ---------------------------------------------------------------------
// Otorisasi
// ---------------------------------------------------------------------
async function verifikasiLogin(req: Request, admin: SupabaseClient) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Tidak terautentikasi.");

  const jwt = authHeader.replace("Bearer ", "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Sesi tidak valid, silakan login ulang.");
  return data.user;
}

async function verifikasiAdmin(req: Request, admin: SupabaseClient) {
  const user = await verifikasiLogin(req, admin);
  const data = { user };

  const { data: profil } = await admin
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  if (!profil || profil.status !== "Aktif") {
    throw new HttpError(403, "Akun Anda tidak aktif.");
  }
  if (profil.wajib_ganti_password) {
    throw new HttpError(403, "Silakan ganti password Anda terlebih dahulu.");
  }
  const { data: rp } = await admin
    .from("role_permissions")
    .select("is_admin")
    .eq("role", profil.role)
    .maybeSingle();
  if (!rp?.is_admin) {
    throw new HttpError(403, "Hanya role administrator yang dapat mengelola akun.");
  }
  return data.user;
}

// ---------------------------------------------------------------------
// Aksi
// ---------------------------------------------------------------------
async function daftarAkun(admin: SupabaseClient) {
  // Ambil semua akun auth (per halaman 1000)
  const semuaAuth: Array<{ id: string; email?: string; last_sign_in_at?: string; created_at: string }> = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    semuaAuth.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const { data: profil, error } = await admin
    .from("profiles")
    .select("*"); // "*" supaya tetap jalan sebelum/sesudah kolom baru ditambahkan
  if (error) throw error;

  const petaProfil = new Map<string, Profil>(profil.map((p: Profil) => [p.id, p]));
  return semuaAuth
    .map((u) => {
      const p = petaProfil.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        nama_lengkap: p?.nama_lengkap ?? "",
        role: p?.role ?? "",
        unit_kerja: p?.unit_kerja ?? "",
        status: p?.status ?? "Nonaktif",
        profil_lengkap: Boolean(p),
        wajib_ganti_password: p?.wajib_ganti_password === true,
        login_terakhir: u.last_sign_in_at ?? null,
        dibuat: u.created_at,
      };
    })
    .sort((a, b) => a.nama_lengkap.localeCompare(b.nama_lengkap, "id"));
}

async function buatAkun(admin: SupabaseClient, body: Record<string, unknown>) {
  const input = await validasiInput(admin, body, true);

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email!,
    password: input.password!,
    email_confirm: true, // aplikasi internal: tidak perlu verifikasi email
    ban_duration: input.status === "Nonaktif" ? BAN_SELAMANYA : "none",
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new HttpError(409, "Email tersebut sudah terdaftar.");
    }
    throw new HttpError(400, error.message);
  }

  const { error: errProfil } = await admin.from("profiles").upsert({
    id: data.user.id,
    email: input.email,
    nama_lengkap: input.nama_lengkap,
    role: input.role,
    unit_kerja: input.unit_kerja,
    status: input.status,
  });
  if (errProfil) {
    // Rollback supaya tidak ada akun auth tanpa profil
    await admin.auth.admin.deleteUser(data.user.id);
    throw errProfil;
  }
  return { id: data.user.id, email: data.user.email };
}

async function ubahAkun(admin: SupabaseClient, body: Record<string, unknown>, idPemanggil: string) {
  const id = String(body.id ?? "");
  if (!id) throw new HttpError(400, "ID akun wajib diisi.");
  const input = await validasiInput(admin, body, false);

  if (id === idPemanggil) {
    if (input.status !== "Aktif") throw new HttpError(400, "Anda tidak dapat menonaktifkan akun Anda sendiri.");
    const { data: profilSaya } = await admin.from("profiles").select("role").eq("id", id).single();
    if (profilSaya && profilSaya.role !== input.role) {
      throw new HttpError(400, "Anda tidak dapat mengubah role akun Anda sendiri.");
    }
  }

  // Profil dulu: jika ditolak database (mis. menonaktifkan admin terakhir),
  // akun Auth belum tersentuh.
  if (input.email) {
    const { data: bentrok } = await admin.from("profiles").select("id").eq("email", input.email).neq("id", id).maybeSingle();
    if (bentrok) throw new HttpError(409, "Username/email tersebut sudah dipakai akun lain.");
  }
  const { error: errProfil } = await admin.from("profiles").upsert({
    id,
    ...(input.email ? { email: input.email } : {}),
    nama_lengkap: input.nama_lengkap,
    role: input.role,
    unit_kerja: input.unit_kerja,
    status: input.status,
  });
  if (errProfil) throw new HttpError(400, errProfil.message);

  const perubahanAuth: Record<string, unknown> = {
    ban_duration: input.status === "Nonaktif" ? BAN_SELAMANYA : "none",
  };
  if (input.email) perubahanAuth.email = input.email;
  if (input.password) perubahanAuth.password = input.password;

  const { error } = await admin.auth.admin.updateUserById(id, perubahanAuth);
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new HttpError(409, "Email tersebut sudah dipakai akun lain.");
    }
    throw new HttpError(400, error.message);
  }

  // Akun Nonaktif: login baru diblokir oleh ban di atas, dan sesi yang
  // masih berjalan langsung kehilangan akses data karena RLS memeriksa
  // profiles.status = 'Aktif' pada setiap query.
  return { id };
}

async function hapusAkun(admin: SupabaseClient, body: Record<string, unknown>, idPemanggil: string) {
  const id = String(body.id ?? "");
  if (!id) throw new HttpError(400, "ID akun wajib diisi.");
  if (id === idPemanggil) throw new HttpError(400, "Anda tidak dapat menghapus akun Anda sendiri.");

  // Hapus profil dulu (aman walaupun FK profiles->auth.users sudah ON DELETE CASCADE)
  const { error: errProfil } = await admin.from("profiles").delete().eq("id", id);
  if (errProfil) throw new HttpError(400, errProfil.message);

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new HttpError(400, error.message);
}

// ---------------------------------------------------------------------
// Password: reset oleh admin & ganti sendiri oleh pengguna
// ---------------------------------------------------------------------
async function resetPasswordDefault(admin: SupabaseClient, body: Record<string, unknown>, idPemanggil: string) {
  const id = String(body.id ?? "");
  if (!id) throw new HttpError(400, "ID akun wajib diisi.");
  if (id === idPemanggil) throw new HttpError(400, "Gunakan menu Ganti Password untuk akun Anda sendiri.");

  // Tandai dulu, baru ubah password: jika penandaan gagal, password lama tetap berlaku.
  const { data: diubah, error: errFlag } = await admin
    .from("profiles").update({ wajib_ganti_password: true }).eq("id", id).select("id");
  if (errFlag) {
    if (/wajib_ganti_password/.test(errFlag.message)) {
      throw new HttpError(400, "Kolom wajib_ganti_password belum ada. Jalankan migrasi 20260928020000_wajib_ganti_password.sql.");
    }
    throw new HttpError(400, errFlag.message);
  }
  if (!diubah?.length) throw new HttpError(404, "Profil akun tidak ditemukan.");

  const { error } = await admin.auth.admin.updateUserById(id, { password: PASSWORD_DEFAULT });
  if (error) throw new HttpError(400, error.message);
}

async function gantiPasswordSendiri(
  admin: SupabaseClient,
  user: { id: string; email?: string },
  body: Record<string, unknown>,
) {
  const lama = typeof body.password_lama === "string" ? body.password_lama : "";
  const baru = typeof body.password_baru === "string" ? body.password_baru : "";
  const email = (user.email ?? "").toLowerCase();
  const username = email.split("@")[0];

  if (!lama || !baru) throw new HttpError(400, "Password lama dan password baru wajib diisi.");
  if (baru.length < PANJANG_PASSWORD_MIN) throw new HttpError(400, `Password baru minimal ${PANJANG_PASSWORD_MIN} karakter.`);
  if (baru === lama) throw new HttpError(400, "Password baru harus berbeda dari password lama.");
  if (baru.toLowerCase() === PASSWORD_DEFAULT.toLowerCase()) throw new HttpError(400, "Password baru tidak boleh sama dengan password default.");
  if (username && baru.toLowerCase().includes(username)) throw new HttpError(400, "Password baru tidak boleh mengandung username Anda.");

  // Verifikasi password lama dengan mencoba login (klien terpisah, tanpa menyimpan sesi)
  const penguji = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: errLama } = await penguji.auth.signInWithPassword({ email, password: lama });
  if (errLama) throw new HttpError(400, "Password lama salah.");

  const { error } = await admin.auth.admin.updateUserById(user.id, { password: baru });
  if (error) throw new HttpError(400, error.message);

  // Hapus tanda wajib ganti (abaikan jika kolom belum ada)
  const { error: errFlag } = await admin
    .from("profiles").update({ wajib_ganti_password: false }).eq("id", user.id);
  if (errFlag && !/wajib_ganti_password/.test(errFlag.message)) throw new HttpError(400, errFlag.message);
}

// ---------------------------------------------------------------------
// Migrasi satu kali: tabel lama `users` -> Supabase Auth + profiles
// ---------------------------------------------------------------------
// - Password lama (teks biasa) dipakai apa adanya lalu di-hash oleh Supabase,
//   jadi staf tetap login dengan password yang sama.
// - Username tanpa '@' diubah menjadi email: username@<domain>.
// - Akun yang emailnya sudah ada di Auth dilewati (aman dijalankan ulang).
// - Password kosong / < 6 karakter (batas minimum Supabase) diganti password
//   acak dan ditandai "perlu reset".
// - Tabel `users` TIDAK diubah/dihapus di sini. Hapus manual setelah yakin.
async function migrasiLegacy(admin: SupabaseClient, body: Record<string, unknown>) {
  const domain = (typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "").replace(/^@/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new HttpError(400, "Domain email tidak valid (contoh: rs.local atau rssa.go.id).");
  }
  const jalankan = body.jalankan === true;

  const { data: lama, error } = await admin.from("users").select("*");
  if (error) throw new HttpError(400, "Gagal membaca tabel users: " + error.message);

  const emailTerdaftar = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (e) throw e;
    data.users.forEach((u) => u.email && emailTerdaftar.add(u.email.toLowerCase()));
    if (data.users.length < 1000) break;
  }

  const { data: roles } = await admin.from("role_permissions").select("role");
  const roleValid = new Set((roles ?? []).map((r: { role: string }) => r.role));

  const hasil: Array<Record<string, string>> = [];
  const emailDiBatchIni = new Set<string>();

  for (const u of (lama ?? []) as Record<string, unknown>[]) {
    const username = String(u.username ?? "").trim().toLowerCase();
    const baris: Record<string, string> = {
      username,
      nama: String(u.nama_lengkap ?? ""),
      email: "",
      hasil: "",
      catatan: "",
    };
    hasil.push(baris);

    if (!username) { baris.hasil = "dilewati"; baris.catatan = "username kosong"; continue; }

    const email = username.includes("@") ? username : `${username.replace(/\s+/g, ".")}@${domain}`;
    baris.email = email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { baris.hasil = "dilewati"; baris.catatan = "email hasil konversi tidak valid"; continue; }
    if (emailTerdaftar.has(email) || emailDiBatchIni.has(email)) { baris.hasil = "dilewati"; baris.catatan = "email sudah ada di Auth"; continue; }
    emailDiBatchIni.add(email);

    const catatan: string[] = [];
    let password = typeof u.password === "string" ? u.password : String(u.password ?? "");
    if (password.length < 6) {
      password = crypto.randomUUID();
      catatan.push("password lama tidak memenuhi syarat → PERLU RESET via Edit");
    }
    const role = String(u.role ?? "").trim();
    if (!roleValid.has(role)) catatan.push(`role "${role}" tidak ada di role_permissions`);
    const statusMentah = String(u.status ?? "").trim().toLowerCase();
    const status = statusMentah === "aktif" ? "Aktif" : "Nonaktif";
    const unit_kerja = String(u.unit_kerja ?? u.unit ?? "").trim();
    if (!unit_kerja) catatan.push("unit kerja kosong");
    baris.catatan = catatan.join("; ");

    if (!jalankan) { baris.hasil = "akan dibuat"; continue; }

    const { data: dibuat, error: errBuat } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      ban_duration: status === "Nonaktif" ? BAN_SELAMANYA : "none",
    });
    if (errBuat || !dibuat.user) { baris.hasil = "GAGAL"; baris.catatan = errBuat?.message ?? "tidak diketahui"; continue; }

    const { error: errProfil } = await admin.from("profiles").upsert({
      id: dibuat.user.id,
      email,
      nama_lengkap: String(u.nama_lengkap ?? "").trim() || username,
      role,
      unit_kerja,
      status,
    });
    if (errProfil) {
      await admin.auth.admin.deleteUser(dibuat.user.id);
      baris.hasil = "GAGAL";
      baris.catatan = "profil: " + errProfil.message;
      continue;
    }
    baris.hasil = "dibuat";
  }

  const ringkasan = hasil.reduce<Record<string, number>>((acc, b) => {
    acc[b.hasil] = (acc[b.hasil] ?? 0) + 1;
    return acc;
  }, {});
  return { jalankan, domain, total: hasil.length, ringkasan, hasil };
}

// ---------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------
async function validasiInput(admin: SupabaseClient, body: Record<string, unknown>, akunBaru: boolean) {
  const teks = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const email = teks(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const nama_lengkap = teks(body.nama_lengkap);
  const role = teks(body.role);
  const unit_kerja = teks(body.unit_kerja);
  const status = teks(body.status) || "Aktif";

  if (!nama_lengkap || !role || !unit_kerja) throw new HttpError(400, "Nama, role, dan unit kerja wajib diisi.");
  if (akunBaru && !email) throw new HttpError(400, "Email wajib diisi.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Format email tidak valid.");
  if (akunBaru && !password) throw new HttpError(400, "Password wajib diisi untuk akun baru.");
  if (password && password.length < PANJANG_PASSWORD_MIN) {
    throw new HttpError(400, `Password minimal ${PANJANG_PASSWORD_MIN} karakter.`);
  }
  if (!STATUS_VALID.includes(status)) throw new HttpError(400, "Status tidak valid.");

  // Role harus benar-benar ada di role_permissions
  const { data: roleAda } = await admin.from("role_permissions").select("role").eq("role", role).maybeSingle();
  if (!roleAda) throw new HttpError(400, `Role "${role}" tidak terdaftar.`);

  return { email, password, nama_lengkap, role, unit_kerja, status };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
