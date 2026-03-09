document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("ikpForm");
    const submitBtn = document.getElementById("submitBtn");
    
    // PASTIKAN URL INI ADALAH URL TERBARU ANDA
    const scriptURL = "https://script.google.com/macros/s/AKfycbw6HOnDbRYJ4pXDTWBkTwFwIH8-q3JBeUf5y3l8okxQtEJ_uVUDjPRY3wMLc92Y3pyU/exec";

    // Cek apakah ada data yang dilempar dari tombol "Edit"
    const editDataStr = localStorage.getItem('editDataIKP');
    let isEditMode = false;
    let editTargetId = null;

    // Fungsi pembantu agar format tanggal cocok dengan input type="datetime-local"
    function formatDateTimeLocal(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    }

    // JIKA DALAM MODE EDIT: Isi otomatis formulir
    if (editDataStr) {
        isEditMode = true;
        const data = JSON.parse(editDataStr);
        editTargetId = data.Timestamp;

        // Ubah tampilan formulir
        document.querySelector('.form-section-title').innerHTML = `A. DATA PASIEN <span class="badge bg-warning text-dark ms-2">MODE EDIT</span>`;
        submitBtn.innerHTML = "UPDATE DATA";
        submitBtn.classList.replace('btn-simpan', 'btn-warning');

        // Memasukkan data ke dalam input form (Sesuai penamaan di JSON/Sheets)
        document.querySelector('[name="umur_hari"]').value = data['Umur (Hari)'] || '';
        document.querySelector('[name="umur_bulan"]').value = data['Umur (Bulan)'] || '';
        document.querySelector('[name="umur_tahun"]').value = data['Umur (Tahun)'] || '';
        document.querySelector('[name="jenis_kelamin"]').value = data['Jenis Kelamin'] || '';
        document.querySelector('[name="penanggung_biaya"]').value = data['Penanggung Biaya'] || '';
        document.querySelector('[name="tanggal_pelayanan"]').value = formatDateTimeLocal(data['Tanggal pelayanan']);
        
        document.querySelector('[name="tgl_waktu_insiden"]').value = formatDateTimeLocal(data['Tgl & Waktu insiden']);
        document.querySelector('[name="insiden"]').value = data['Insiden'] || '';
        document.querySelector('[name="kronologis"]').value = data['Kronologis'] || '';
        document.querySelector('[name="jenis_insiden"]').value = data['Jenis Insiden'] || '';
        document.querySelector('[name="terjadi_pada"]').value = data['Terjadi Pada'] || '';
        document.querySelector('[name="dampak"]').value = data['Dampak'] || '';
        document.querySelector('[name="probabilitas"]').value = data['Probabilitas'] || '';
        document.querySelector('[name="pelapor_pertama"]').value = data['Pelapor Pertama'] || '';
        document.querySelector('[name="menyangkut_pasien"]').value = data['Menyangkut Pasien'] || '';
        document.querySelector('[name="tempat_insiden"]').value = data['Tempat Insiden'] || '';
        document.querySelector('[name="unit_terkait"]').value = data['Unit Terkait'] || '';
        document.querySelector('[name="tindak_lanjut"]').value = data['Tindak Lanjut'] || '';
        document.querySelector('[name="dilakukan_oleh"]').value = data['Dilakukan Oleh'] || '';
        
        // Cek Radio Button Pernah Terjadi
        if (data['Pernah terjadi?'] === "Ya") {
            document.getElementById('radioYa').checked = true;
        } else {
            document.getElementById('radioTidak').checked = true;
        }
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault(); 
        
        submitBtn.innerHTML = "Menyimpan...";
        submitBtn.disabled = true;

        const formData = new FormData(form);
        const inputData = Object.fromEntries(formData.entries());

        // SIAPKAN PAYLOAD: Tentukan apakah ini 'create' atau 'update'
        const payload = {
            action: isEditMode ? 'update' : 'create',
            id: editTargetId, // Kosong jika create, berisi Timestamp jika update
            data: inputData
        };

        fetch(scriptURL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload),
        })
        .then((response) => response.json())
        .then((result) => {
            if (result.status === "success") {
                if(isEditMode) {
                    alert("Data Insiden berhasil DIPERBARUI!");
                    localStorage.removeItem('editDataIKP'); // Bersihkan memori edit
                    window.location.href = 'daftar_insiden.html'; // Kembalikan user ke daftar
                } else {
                    alert("Data Laporan IKP berhasil disimpan!");
                    form.reset(); 
                }
            } else {
                alert("Terjadi kesalahan: " + result.message);
            }
        })
        .catch((error) => {
            alert("Gagal terhubung ke server. Periksa koneksi internet Anda.");
        })
        .finally(() => {
            submitBtn.innerHTML = isEditMode ? "UPDATE DATA" : "SIMPAN";
            submitBtn.disabled = false;
        });
    });
});