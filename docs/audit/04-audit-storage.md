# 📸 04 — Laporan Audit Storage Foto Medis & Efisiensi Biaya

> **Status Audit:** Tahap 3 — Audit Storage Foto Medis (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Target:** Pipeline Unggah Foto Medis, Kompresi, Skalabilitas Storage, & Efisiensi Biaya

---

## 1. Ringkasan Eksekutif

Audit terhadap alur pengelolaan foto rekam medis (*Before/After & Kondisi Kulit Pasien*) menunjukkan bahwa saat ini **belum ada kompresi otomatis untuk foto yang diunggah dari galeri/file input**. Foto resolusi tinggi dari kamera smartphone modern (~4 MB hingga 8 MB per file) diunggah langsung ke Supabase Storage bucket `patient-photos`. 

Dengan proyeksi 4 cabang (~30.000 treatment/tahun dengan rata-rata 3–4 foto per sesi = 120.000 foto/tahun), penyimpanan tanpa kompresi akan menghabiskan **~480 GB per tahun (2,4 TB dalam 5 tahun)**. Dengan menerapkan kompresi otomatis di sisi browser (*Client-Side Resize max 1600px + WebP kualitas 80*), ukuran per foto dapat dipangkas menjadi **~250–300 KB (hanya ~36 GB per tahun)**. Ini menghasilkan **penghematan kapasitas dan bandwidth hingga 13 kali lipat** tanpa mengurangi ketajaman detail klinis yang dibutuhkan dokter/terapis.

---

## 2. Alur Upload Foto Medis Saat Ini

```text
[Kamera Live / Galeri File HP]
            │
            ▼
[State Komponen React (File/Blob)]
            │  (Tanpa validasi ukuran maksimal)
            │  (Tanpa resize dimensi)
            │  (Format tergantung input: JPEG/PNG asli ~4MB)
            ▼
[supabase.storage.from('patient-photos').upload()]
            │
            ▼
[Penyimpanan Storage Path di tabel 'patient_photos']
            │
            ▼
[Akses View: createSignedUrl(path, 3600) -> Unduh Full Size]
```

---

## 3. Tabel Temuan Audit Storage

| No | Temuan | Lokasi File : Baris | Dampak Biaya & Performa | Rekomendasi |
|:---:|:---|:---|:---|:---|
| 1 | **Ketiadaan Kompresi pada Upload Galeri File** | [`app/treatment-records/new/page.js:327-347`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/new/page.js#L327-L347)<br>[`app/treatment-records/[id]/edit/page.js:275-295`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/%5Bid%5D/edit/page.js#L275-L295) | File asli 4–8 MB langsung diunggah. Menghabiskan kuota storage dan kuota bandwidth transfer data keluar Supabase. | Pasang kompresi otomatis client-side via Canvas API / `browser-image-compression` sebelum fungsi `.upload()` dipanggil. |
| 2 | **Ketiadaan Validasi Batas Ukuran File (Max Size)** | [`app/treatment-records/new/page.js:925`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/new/page.js#L925) | Staf bisa tidak sengaja mengunggah file foto berukuran >15 MB atau format non-gambar yang berpotensi error di tengah proses. | Tambahkan validasi ukuran maksimal (misal: maks 10 MB sebelum kompresi) dan filter tipe mime `image/*`. |
| 3 | **Ketiadaan Thumbnail untuk Tampilan Galeri / List** | [`app/patients/[id]/page.js:450-510`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/patients/%5Bid%5D/page.js#L450-L510) | Membuka profil pasien dengan 20 foto lama akan mengunduh ~80 MB data ke iPad/HP kasir sekaligus, menyebabkan loading berat. | Manfaatkan fitur Supabase Image Transformation (`render/image`) untuk generate thumbnail kecil saat preview. |
| 4 | **Potensi File Yatim (*Orphan Storage Files*) jika Submit Batal** | [`app/treatment-records/new/page.js:370-410`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/new/page.js#L370-L410) | Jika slot foto 1 berhasil diunggah tetapi koneksi internet terputus sebelum record SOAP tersimpan, file tertinggal di Storage. | Bungkus alur dengan rollback penghapusan file Storage jika insert database `treatment_records` gagal. |
| 5 | **Penggunaan Signed URL Berjangka Waktu (1 Jam)** | [`app/treatment-records/[id]/page.js:199`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/%5Bid%5D/page.js#L199) | **AMAN & PRAKTIK BAIK**. URL foto tidak permanen dan otomatis expired dalam 3600 detik. | Pertahankan penggunaan Signed URL untuk seluruh akses foto klinis. |

---

## 4. Simulasi Penghematan Biaya (1, 3, dan 5 Tahun)

### Asumsi Volume 4 Cabang (Banjar, Tasikmalaya, Pangandaran, Ciamis):
- Rata-rata treatment: **100 pasien/hari di 4 cabang** = ~30.000 treatment/tahun.
- Rata-rata foto medis: **4 foto per treatment** (Tampak Depan, Kiri, Kanan, Before/After) = **120.000 foto/tahun**.

| Parameter | Kondisi Saat Ini (Tanpa Kompresi) | Setelah Optimasi (WebP 1600px q80) | Selisih Penghematan |
|:---|:---:|:---:|:---:|
| **Ukuran Rata-rata per Foto** | **~4.000 KB (4 MB)** | **~300 KB (0,3 MB)** | **Hemat 92,5%** |
| **Kebutuhan Storage Tahun ke-1** | 480 GB | 36 GB | **Hemat 444 GB** (Masuk kuota gratis Pro 100GB) |
| **Kebutuhan Storage Tahun ke-3** | 1.440 GB (1,44 TB) | 108 GB | **Hemat 1.332 GB** |
| **Kebutuhan Storage Tahun ke-5** | 2.400 GB (2,40 TB) | 180 GB | **Hemat 2.220 GB** |
| **Bandwidth Egress per 10.000 View** | ~40 GB data | ~3 GB data | **Loading 13x Lebih Cepat** |

---

## 5. Rencana Rekomendasi Implementasi Kompresi (Client-Side)

### Spesifikasi Parameter Kompresi yang Direkomendasikan:
- **Dimensi Maksimal**: Panjang sisi terpanjang **1600 px** (aspek rasio terkunci).
- **Format Target**: **WebP** (didukung 100% oleh semua browser modern & iOS Safari).
- **Kualitas Kompresi**: **0.80 (80%)**.

### Contoh Helper Kompresi yang Siap Diterapkan:
```javascript
// Helper Client-Side Image Compression (Canvas WebP)
export async function compressImageForMedical(file, maxWidth = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = (event) => {
            const img = new Image()
            img.src = event.target.result
            img.onload = () => {
                const canvas = document.createElement('canvas')
                let { width, height } = img

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width)
                        width = maxWidth
                    }
                } else {
                    if (height > maxWidth) {
                        width = Math.round((width * maxWidth) / height)
                        height = maxWidth
                    }
                }

                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                ctx.drawImage(img, 0, 0, width, height)

                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Kompresi gambar gagal'))
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                        type: 'image/webp',
                        lastModified: Date.now(),
                    })
                    resolve(compressedFile)
                }, 'image/webp', quality)
            }
            img.onerror = (err) => reject(err)
        }
        reader.onerror = (err) => reject(err)
    })
}
```

---

## 6. Catatan Kualitas Medis & Rekomendasi Klinis

- **Apakah Pori-pori, Jerawat, dan Pigmentasi Tetap Terlihat?**  
  Pada resolusi **1600px** dengan WebP kualitas 80%, tekstur kulit, komedo, jerawat, bekas luka, dan warna hiperpigmentasi tetap **sangat tajam dan jelas terbaca** di layar tablet/iPad dokter dan terapis.
- **Pengecualian**:  
  Jika di masa mendatang klinik menambahkan alat diagnostik khusus mikroskopis (*Skin Analyzer Digital / Foto Dermoskopi Ultra-Macro*), foto jenis tersebut dapat diberi opsi toggle *"Mode Detail Ultra/High-Res"* agar tidak di-resize agresif. Untuk foto dokumentasi standar klinik kecantikan, WebP 1600px adalah standar baku industri.
