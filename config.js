// =====================================================================
// config.js - PUSAT KONFIGURASI APLIKASI
// =====================================================================

// 1. KREDENSIAL SUPABASE
// PERBAIKAN: URL cukup sampai .co (TIDAK BOLEH ada /rest/v1/)
const SUPABASE_URL = 'https://ewosnpbpwkwxktakpibn.supabase.co';

// Catatan: Kunci anon (public key) Supabase biasanya diawali dengan huruf "eyJhbG...". 
// Pastikan Anda menyalin dari Project Settings > API > Project API Keys (anon / public).
const SUPABASE_KEY = 'sb_publishable_wwcNE3xansrDq16VWSj56A_LXpgTnQq';

// PERBAIKAN: Ubah nama variabel agar tidak bentrok dengan library bawaan CDN
let supabaseClient;
if (typeof window.supabase !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// 2. API GOOGLE APPS SCRIPT
const API_CONFIG = {
    MUTU: "https://script.google.com/macros/s/AKfycbxa8AxQhZoKjDLd3Ky3ryy79q6DZ9RkXKS9EyCUTdR27RjwK3gZj8CE-ZyTi-n1dfON/exec",
    IKP: "https://script.google.com/macros/s/AKfycbyPJJlzfUfHyU87IRhetFiEgU83VM-84OYa5AH31DHFFV1JKn_opYjPkzwBlu8nQKVo/exec",
    KPC: "https://script.google.com/macros/s/AKfycbxXgbToxjU7n_IAvLjJe27atbWfG2cNOXRgNSnCNyMXdALGdM8V3wVNXG3dwPjsFkF9/exec",
    SURVEY: "https://script.google.com/macros/s/AKfycbzs7-x6GGX8dMqLgYOXZfNDY3127xbSDEnibba5yM0YcXWiShBWo9Yh1yS9JQrsoEU2/exec",
    RISK: "https://script.google.com/macros/s/AKfycbztzI8Gu1NcLPJgw0xy6lf4mqnmqy31V0FKDcj9ipPy9m84lEJ2-_jSTCzvUjOfud6g9g/exec",
    MENU: "https://script.google.com/macros/s/AKfycbxRcpdb3tnHFWXWVLBzIymqAQnmygkxc_QoRVR43At859Yi6ZwYNkN0mSJaaKa5i4GJ/exec",
    COMPILER: "https://script.google.com/macros/s/AKfycbw3W4HOdLjo0Dz7y-sGLaC2ZXTxf-DcdMrC8ufeSBKZGE0ZpHTPGgRucTj2wJZ50JS_/exec",
    PPI: "https://script.google.com/macros/s/AKfycbw1J8m83-DeYBGpb4mB8-pI1SotM-xSzwbSGlDhUaA0DUGxu2AZTf6BfsYydGPL4XI9/exec"
    // GROQ_API_KEY DIHAPUS DARI SINI — sekarang disimpan sebagai secret di
    // Supabase Edge Function 'generate-laporan-ai', tidak pernah dikirim ke browser.
};