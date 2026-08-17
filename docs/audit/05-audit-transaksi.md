# 💳 05 — Laporan Audit Atomisitas & Konsistensi Transaksi Kasir

> **Status Audit:** Tahap 4 — Audit Transaksi Kasir & POS (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Target:** Modul POS Kasir, Fungsi RPC PostgreSQL `process_checkout`, Proteksi Stok, & Penanganan Kupon

---

## 1. Ringkasan Eksekutif

Audit terhadap alur checkout kasir (`app/kasir/page.js` dan fungsi database `process_checkout`) menunjukkan bahwa **klaim atomisitas transaksi (*All-or-Nothing*) sebagian besar telah diterapkan dengan sangat baik di level database**. 

Pembuatan nota transaksi, pencatatan item belanja, pemotongan stok produk dengan penguncian baris (*Row-Level Locking / FOR UPDATE*), serta pembuatan paket kupon baru dieksekusi dalam **satu transaksi tunggal PostgreSQL via RPC `process_checkout`**. Jika stok produk di cabang kurang atau koneksi gagal saat eksekusi fungsi, seluruh proses otomatis dibatalkan (*rollback*) sehingga tidak ada nota tanpa potong stok.

Namun, ditemukan **1 celah non-atomis**: pemotongan sisa sesi kupon pasien saat klaim (*redeem kupon lama*) masih dijalankan di JavaScript frontend **setelah** fungsi RPC selesai. Jika koneksi terputus di detik krusial tersebut, nota transaksi berharga Rp 0 tersimpan tetapi jatah sesi kupon pasien tidak berkurang.

---

## 2. Alur Transaksi Kasir Saat Ini (Step-by-Step)

```text
[Kasir Klik Tombol "Proses Pembayaran"]
            │
            ▼ (1) Validasi Frontend & State Lock (setIsProcessing(true))
            │     [app/kasir/page.js:679]
            │
            ▼ (2) Jika ada Direct Treatment: Buat Header Rekam Medis (treatment_records)
            │     [app/kasir/page.js:687-701]
            │
            ▼ (3) Eksekusi Database RPC Atomis: 'process_checkout'
            │     [app/kasir/page.js:720] -> [process_checkout_rpc.sql:1-312]
            │     ├── a. Validasi role kasir & branch_id pengguna
            │     ├── b. Lock tabel counter & generate nomor nota (TRX-CABANG-YYYYMMDD-0001)
            │     ├── c. INSERT tabel 'transactions'
            │     ├── d. INSERT tabel 'transaction_items'
            │     ├── e. Lock baris 'product_stock' (FOR UPDATE) & kurangi stok produk cabang
            │     ├── f. Jika beli kupon baru: INSERT 'patient_coupons' & 'patient_coupon_items'
            │     └── g. Sinkronisasi 'treatment_record_items' jika ada rekam medis
            │
            ▼ (4) Pasca-RPC di Frontend (Non-Atomis):
            │     [app/kasir/page.js:744-785]
            │     ├── Potong sesi kupon pasien di 'patient_coupon_items'
            │     └── INSERT log pemakaian di 'coupon_usage_logs'
            │
            ▼ (5) Sukses: Modal Struk Muncul & Cart Dikosongkan
                  [app/kasir/page.js:800-830]
```

---

## 3. Verifikasi Klaim Dokumentasi Sistem

| Klaim di Dokumen Master | Status Penerapan | Bukti Kode & Catatan Teknis |
|:---|:---:|:---|
| **"Transaksi bersifat Atomis / All-or-Nothing"** | **TERBUKTI (Sebagian Besar)** | [`migrations_archive/process_checkout_rpc.sql:1-312`](file:///Users/user/Project%20Saas/ayumi-beauty-house/migrations_archive/process_checkout_rpc.sql#L1-L312)<br>Seluruh pembuatan transaksi, item, potong stok, dan generate kupon baru dibungkus dalam satu blok PL/pgSQL atomis. |
| **"Stok tidak akan minus karena Race Condition"** | **TERBUKTI** | [`migrations_archive/process_checkout_rpc.sql:170-185`](file:///Users/user/Project%20Saas/ayumi-beauty-house/migrations_archive/process_checkout_rpc.sql#L170-L185)<br>Menggunakan `SELECT ... FOR UPDATE` pada baris `product_stock` per cabang sebelum dikurangi. |
| **"Nomor nota urut & tidak pernah kembar"** | **TERBUKTI** | [`migrations_archive/process_checkout_rpc.sql:79-96`](file:///Users/user/Project%20Saas/ayumi-beauty-house/migrations_archive/process_checkout_rpc.sql#L79-L96)<br>Menggunakan tabel `daily_transaction_counters` dengan penguncian baris `FOR UPDATE` per cabang per hari. |
| **"Proteksi Klik Ganda (Double-Submit)"** | **TERBUKTI (Frontend)** | [`app/kasir/page.js:679`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/kasir/page.js#L679)<br>State `isProcessing` mengunci tombol bayar dan menampilkan spinner loading saat checkout berlangsung. |
| **"Pemotongan Sisa Sesi Kupon Atomis"** | **TIDAK TERBUKTI (Non-Atomis)** | [`app/kasir/page.js:744-780`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/kasir/page.js#L744-L780)<br>Pemotongan sisa sesi kupon dilakukan di browser setelah RPC selesai. |

---

## 4. Analisis Skenario Kegagalan & Risiko Finansial

### Skenario 1: Internet Putus Saat Eksekusi RPC Database
- **Titik Gagal:** Antara langkah 2 dan langkah 3.
- **Dampak Data:** PostgreSQL otomatis me-rollback seluruh operasi. Tidak ada nota separuh jadi dan stok tidak berkurang secara salah.
- **Dampak Finansial:** **Rp 0 (Aman)**. Kasir cukup klik ulang tombol bayar setelah internet stabil.

### Skenario 2: Internet Putus Tepat Setelah RPC Sukses (Saat Redeem Kupon)
- **Titik Gagal:** Langkah 4 (`app/kasir/page.js:744-785`).
- **Dampak Data:** Nota transaksi berharga Rp 0 (karena bayar pakai kupon) sudah sah tercatat di database, namun query update `remaining_sessions` di `patient_coupon_items` gagal terkirim.
- **Dampak Finansial:** Pasien mendapatkan 1 tindakan gratis tanpa kuota kuponnya berkurang (potensi kerugian senilai 1 sesi treatment, misal Rp 150.000 – Rp 350.000).

---

## 5. Rekomendasi Perbaikan Prioritas

1. **Pindahkan Logika Redeem Kupon ke Dalam RPC `process_checkout` (Prioritas P1)**:
   - Masukkan pengurangan sesi `patient_coupon_items` dan insert `coupon_usage_logs` langsung ke dalam fungsi PL/pgSQL database `process_checkout` agar 100% atomis.
2. **Validasi Ulang Kalkulasi Total di Database (Prioritas P2)**:
   - Saat ini frontend menghitung `subtotal` dan `total` lalu mengirimkannya ke RPC. Sebaiknya database melakukan verifikasi independen bahwa `total = SUM(price * qty) - discount` untuk mencegah manipulasi request.
