# 🗄️ 03 — Laporan Audit Skema Database, Index & Integritas Data

> **Status Audit:** Tahap 2 — Audit Skema & Integritas Data (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Target Database:** Supabase PostgreSQL Live Instance (`dtrgxgutcuznrxflmpzk.supabase.co`)

---

## 1. Ringkasan Eksekutif

Audit skema database live terhadap 24 tabel menunjukkan bahwa sistem Ayumi Beauty House saat ini sudah memiliki **3.960 data pasien** dan **3.971 data rekam medis**. Namun, ditemukan **masalah integritas data nyata**: sebanyak **12 dari 55 baris (21,8%)** pada tabel `transaction_items` berstatus **"Baris Yatim"** (*Orphan Rows*). Item produk (seperti *"All Day With My Soothing Oil"*) tercatat dengan `item_type = 'treatment'` tanpa ID produk maupun ID treatment. Akibatnya, produk tersebut tidak pernah mengurangi stok inventaris dan tidak terhitung dalam laporan laba/rugi produk.

Selain itu, indeks Foreign Key pada relasi penting (`transaction_items.transaction_id`, `treatment_records.patient_id`, dan `appointments.patient_id`) perlu dipastikan memiliki index komposit untuk mengantisipasi proyeksi **1.000.000 baris transaksi** dalam 10 tahun ke depan.

---

## 2. Kesenjangan Dokumentasi vs Skema Live

| Nama Tabel / Entitas | Status Dokumentasi Master Lama | Kondisi Live Database | Fungsi & Catatan Arsitektur |
| :--- | :---: | :---: | :--- |
| `followup_queue` | ❌ Tidak Terdokumentasi | **1.024 rows** | Antrean reminder WhatsApp otomatis (H+3 kepuasan, H+14 recall, birthday reminder). |
| `coupon_packages` | ⚠️ Disebut Sekilas | **17 rows** | Katalog master paket kupon bundling treatment multi-sesi. |
| `coupon_package_items` | ❌ Tidak Terdokumentasi | **17 rows** | Rincian jatah treatment dan sesi per paket kupon. |
| `patient_coupons` | ⚠️ Disebut Sekilas | **4 rows** | Kupon kepemilikan pasien (status active, expired, tanggal berlaku). |
| `patient_coupon_items` | ❌ Tidak Terdokumentasi | **4 rows** | Kuota sisa sesi treatment kupon milik masing-masing pasien. |
| `user_branch_assignments` | ❌ Tidak Terdokumentasi | **0 rows** | Riwayat audit perpindahan penugasan staf/terapis antar cabang. |
| `notifications` | ❌ Tidak Terdokumentasi | **18 rows** | Log notifikasi real-time in-app untuk kasir dan terapis. |
| `treatment_categories` | ⚠️ Terdaftar di Master | **0 rows** | Kategori treatment saat ini belum diisi barisnya (relasi nullable). |

---

## 3. Analisis Akar Masalah `transaction_items` (Baris Yatim)

### A. Fakta Temuan di Database
Dari 55 total baris `transaction_items`, ditemukan **12 baris yatim**:
- Contoh: Item *"All Day With My Soothing Oil"* (Harga Rp 79.000) dan *"Dekoratif"* (Harga Rp 49.000).
- Kolom: `item_type = 'treatment'`, `treatment_id = NULL`, `product_id = NULL`.

### B. Bagaimana Hal Ini Terjadi di Kode?
Pada implementasi kasir awal (`app/kasir/page.js`), saat staf memasukkan item manual atau mengimpor data transaksi lama:
1. Objek item keranjang belanja dikirim ke database tanpa validasi apakah `item.id` merupakan ID produk atau ID treatment yang valid di master katalog.
2. Di database, kolom `product_id` dan `treatment_id` keduanya bersifat `NULLABLE` tanpa adanya `CHECK CONSTRAINT`. Akibatnya, PostgreSQL menerima baris data tersebut meskipun tidak memiliki referensi ke katalog produk ataupun menu treatment.

### C. Solusi Perbaikan Berlapis:
1. **Lapisan Frontend (`app/kasir/page.js`)**:
   - Nonaktifkan input item teks bebas. Kasir **wajib** memilih dari daftar dropdown/search catalog produk atau treatment.
   - Tambahkan validasi sebelum checkout: jika `item.type === 'product'`, pastikan `product_id` adalah UUID valid.
2. **Lapisan Database (Constraint PostgreSQL)**:
   - Tambahkan `CHECK CONSTRAINT` dengan klausul `NOT VALID` (agar data historis tidak error, namun mencegah 100% baris baru yang salah):
     ```sql
     ALTER TABLE transaction_items
     ADD CONSTRAINT chk_item_reference CHECK (
          (item_type = 'product'   AND product_id   IS NOT NULL)
       OR (item_type = 'treatment' AND treatment_id IS NOT NULL)
       OR (item_type = 'coupon'    AND (coupon_package_id IS NOT NULL OR patient_coupon_id IS NOT NULL))
     ) NOT VALID;
     ```
3. **Pembersihan Data Lama (*Data Cleanup*)**:
   - Jalankan skrip update terarah untuk memetakan nama item lama ke `products.id` berdasarkan pencocokan nama (*string matching*).

---

## 4. Rekomendasi Index & Performa Jangka Panjang

Dengan proyeksi pertumbuhan 4 cabang mencapai **~100.000 item transaksi per tahun**, index gabungan (*Composite Index*) sangat krusial agar query laporan bulanan tidak membebani CPU:

| No | Target Tabel | Kolom Index yang Dianjurkan | Alasan & Dampak Performa | Prioritas |
|:---:|:---|:---|:---|:---:|
| 1 | `transaction_items` | `(transaction_id, item_type)` | Mempercepat join query struk kasir & laporan penjualan per item. | 🔴 **P0 (Kritis)** |
| 2 | `transactions` | `(branch_id, created_at DESC)` | Mempercepat filter riwayat transaksi kasir dan laporan omset cabang. | 🔴 **P0 (Kritis)** |
| 3 | `treatment_records` | `(performed_by, treatment_date DESC)` | Mempercepat dashboard terapis dan kalkulasi laporan komisi. | 🟠 **P1 (Tinggi)** |
| 4 | `treatment_records` | `(patient_id, treatment_date DESC)` | Mempercepat loading histori medis saat pasien datang berkunjung. | 🟠 **P1 (Tinggi)** |
| 5 | `appointments` | `(branch_id, appointment_date, start_time)` | Mempercepat timeline antrean janji temu harian per cabang. | 🟠 **P1 (Tinggi)** |
| 6 | `product_stock` | `(branch_id, product_id)` | Mempercepat validasi stok dan locking saat transaksi kasir. | 🟠 **P1 (Tinggi)** |

---

## 5. Analisis Tipe Data & Zona Waktu

1. **Tipe Data Nilai Uang**:
   - Kolom `price`, `subtotal`, `total`, `discount` pada `transactions` dan `transaction_items` bertipe `NUMERIC` / `BIGINT`. **Status: AMAN** (tidak menggunakan `FLOAT` / `DOUBLE`, sehingga bebas dari selisih pembulatan sen/rupiah).
2. **Penanganan Zona Waktu (Timezone)**:
   - Kolom waktu menggunakan `TIMESTAMPTZ` (*timestamp with time zone* UTC).
   - Di frontend, konversi tanggal telah ditangani menggunakan locale `id-ID` (WIB/WITA).

---

## 6. Daftar Skrip SQL Perbaikan yang Disiapkan

File DDL lengkap telah dibuat di:
📄 **[`docs/audit/03a-perbaikan-database.sql`](file:///Users/user/Project%20Saas/ayumi-beauty-house/docs/audit/03a-perbaikan-database.sql)**
