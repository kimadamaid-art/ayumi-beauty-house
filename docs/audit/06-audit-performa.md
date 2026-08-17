# ⚡ 06 — Laporan Audit Performa & Skalabilitas Jangka Panjang

> **Status Audit:** Tahap 5 — Audit Performa & Skalabilitas (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Konteks:** Pertumbuhan Data 4 Cabang Menuju 1.000.000 Transaksi & Perangkat Kerja Staf (iPad/Smartphone)

---

## 1. Ringkasan Eksekutif

Sistem Ayumi Beauty House saat ini terasa responsif karena database baru berumur beberapa bulan dengan volume data yang masih kecil (~4.000 pasien dan puluhan transaksi baru). Namun, **terdapat jebakan performa arsitektural (*Client-Side Aggregation*)** pada modul laporan (`/reports/therapists`, `/reports/treatments`, dan `/dashboard`).

Modul-modul tersebut mengambil ratusan hingga ribuan baris data mentah dari Supabase ke browser, lalu melakukan kalkulasi omset, komisi, dan persentase menggunakan fungsi `reduce()` / `map()` di memori JavaScript iPad/HP kasir. Dalam 2–3 tahun ke depan saat data transaksi menembus 100.000 baris, iPad kasir berisiko mengalami *freeze/crash* saat membuka halaman laporan bulanan.

---

## 2. Tabel Prediksi Titik Kritis Kegagalan Performa

| Halaman / Fitur | Masalah Arsitektur | Lokasi File | Perkiraan Kapan Bermasalah | Prioritas |
|:---|:---|:---|:---:|:---:|
| **Laporan Performa Terapis** (`/reports/therapists`) | Menarik seluruh baris item tindakan mentah lalu mengelompokkan omset & komisi di memori browser via `useMemo`. | [`app/reports/therapists/page.js:90-180`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/reports/therapists/page.js#L90-L180) | **Tahun ke-2 (~50.000 baris tindakan)**: Loading >8 detik di iPad. | 🔴 **P0 (Kritis)** |
| **Laporan Menu Treatment** (`/reports/treatments`) | Menarik seluruh baris detail tindakan dan menghitung total omset per kategori di JavaScript. | [`app/reports/treatments/page.js:80-160`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/reports/treatments/page.js#L80-L160) | **Tahun ke-2 s.d. ke-3**: Browser tablet mengalami *out-of-memory*. | 🔴 **P0 (Kritis)** |
| **Dashboard Eksekutif** (`/dashboard`) | Mengambil ratusan rekam medis, transaksi, dan target cabang sekaligus untuk grafik tren bulanan. | [`app/dashboard/page.js:140-280`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/dashboard/page.js#L140-L280) | **Tahun ke-3**: Grafik render lambat dan interaksi filter macet. | 🟠 **P1 (Tinggi)** |
| **Detail Rekam Medis (Signed URLs)** | Melakukan loop sequential `for ... of` untuk men-generate Signed URL foto satu per satu. | [`app/treatment-records/[id]/page.js:195-208`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/%5Bid%5D/page.js#L195-L208) | **Tahun ke-1**: Delay 1–2 detik jika rekam medis memiliki >6 foto. | 🟡 **P2 (Sedang)** |
| **Daftar Master Pasien** (`/patients`) | Menggunakan server pagination (20 baris per halaman) dengan pencarian `ilike`. | [`app/patients/page.js:60-120`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/patients/page.js#L60-L120) | **Aman hingga 10+ tahun** (sudah terpaginasi dengan baik). | ✅ **AMAN** |

---

## 3. Detail Temuan Prioritas Tinggi & Analisis Beban

### 🔴 Temuan #1: Agregasi Laporan di Memori Browser (Client-Side)
- **Kondisi Saat Ini:**
  Halaman `app/reports/therapists/page.js` menjalankan query:
  ```javascript
  supabase.from('treatment_record_items').select('..., treatment_records(...)')
  ```
  Kemudian 100% komisi, total treatment, dan total omset dihitung menggunakan perulangan JavaScript:
  ```javascript
  treatmentItems.forEach(item => {
      therapistGroups[therapistId].totalRevenue += item.price_at_time;
      therapistGroups[therapistId].totalCommission += (item.price_at_time * item.commission_percent / 100);
  });
  ```
- **Analisis Beban Jangka Panjang:**
  Dalam 1 tahun (4 cabang × 100 pasien/hari) terdapat **~30.000–50.000 item tindakan**. Ketika owner membuka filter "Tahun Ini" atau "Kuartal Ini", browser iPad staf harus mengunduh JSON sebesar **~15 MB s.d. 25 MB** dan memproses perulangan puluhan ribu objek di CPU mobile.
- **Solusi Ideal:** Buat PostgreSQL View atau SQL Aggregate Function (misal `SELECT performed_by, SUM(price_at_time), SUM(commission) GROUP BY performed_by`) sehingga database hanya mengirimkan **ringkasan 10–20 baris data (< 5 KB)** ke browser!

---

### 🔴 Temuan #2: Loop Tunggal Signed URL Foto Medis
- **Kondisi Saat Ini:**
  Pada `app/treatment-records/[id]/page.js`, URL foto di-generate secara sekuensial satu demi satu di dalam loop:
  ```javascript
  for (const photo of photosData) {
      const { data } = await supabase.storage.from('patient-photos').createSignedUrl(photo.storage_path, 3600);
  }
  ```
- **Solusi Cepat:** Gunakan `Promise.all(photosData.map(...))` atau batch API `createSignedUrls([...])` agar seluruh URL foto klinis ter-generate secara paralel dalam 1 panggilan round-trip network.

---

## 4. Rekomendasi Roadmap Optimalisasi

### A. Perbaikan Cepat (Quick Wins — 1 s.d. 2 Hari):
1. **Parallel Signed URL**: Ubah loop sekuensial foto medis di `app/treatment-records/[id]/page.js` menjadi `Promise.all()`.
2. **Lazy Loading PDF/Excel Library**: Pustaka berat `jspdf` dan `xlsx` sudah di-load secara dinamis via `await import()`, pertahankan pola ini agar bundle awal halaman kasir tetap ringan (< 150 KB).

### B. Perombakan Skalabilitas (Strategic Architecture — 1 s.d. 3 Bulan):
1. **Database Aggregated Views untuk Laporan**:
   - Buat View `v_monthly_therapist_commissions` dan `v_treatment_sales_summary` di PostgreSQL.
   - Halaman laporan frontend cukup membaca view tersebut secara instan tanpa perlu mengolah data mentah.
2. **Mekanisme Caching Master Data**:
   - Data statis yang jarang berubah (daftar cabang, daftar menu treatment, master produk) disimpan di memory cache SWR / React State global agar tidak di-fetch ulang setiap kali berpindah tab menu.
