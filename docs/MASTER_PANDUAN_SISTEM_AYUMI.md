# 🏆 MASTER PANDUAN SISTEM & ARSITEKTUR DATABASE
## Ayumi Beauty House — Multi-Branch Clinic SaaS System

Selamat datang! Dokumen ini adalah **Panduan Master Terlengkap** yang menyatukan seluruh pembahasan mengenai arsitektur sistem, teknologi (*tech stack*), hubungan antar-cabang (*branches*), peta relasi database (*ERD*), alur transaksi kasir, keamanan data, hingga panduan pemilik bisnis (*Owner SOP*) dalam format yang sangat visual dan mudah dipahami.

---

## 🧭 Daftar Isi Utama

1. **🌟 Filosofi & Gambaran Umum Sistem**
2. **🧱 Arsitektur Tech Stack (Frontend, Backend & Database)**
3. **🌐 Mind-Map & Arsitektur Multi-Cabang (`branches`)**
4. **🗄️ Peta Struktur Database & Relasi 18 Tabel (ERD)**
5. **🔄 Simulasi Alur Perjalanan Data Nyata (Data Flow)**
6. **🔒 Keamanan, Satpam RLS & Pencegahan Kecurangan**
7. **💼 Panduan Operasional & Pemeliharaan untuk Owner**

---

## 🌟 Bab 1: Filosofi & Gambaran Umum Sistem

Aplikasi **Ayumi Beauty House** dirancang sebagai sistem perangkat lunak sebagai layanan (*Software-as-a-Service / SaaS*) modern untuk mengelola klinik kecantikan berbasis multi-cabang secara terpusat, presisi, dan aman.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        👑 OWNER MANAGEMENT                              │
│              (Memantau Seluruh Cabang Secara Real-Time)                 │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      ▼                              ▼                              ▼
🏢 Cabang Banjar              🏬 Cabang Tasikmalaya          🏖️ Cabang Pangandaran
[Kasir, Terapis, Stok]        [Kasir, Terapis, Stok]         [Kasir, Terapis, Stok]
```

---

## 🧱 Bab 2: Arsitektur Tech Stack (Bagaimana Semua Terhubung)

Sistem ini dibangun menggunakan 3 pilar teknologi modern kelas dunia:

```mermaid
flowchart LR
    subgraph FRONTEND ["🖥️ FRONTEND (Tampilan Layar)"]
        UI["Next.js 16 + React 19\nTailwind CSS v4\n(Cepat, Ringan & Responsif di iPad/HP)"]
    end

    subgraph API ["⚡ API & CLIENT HUB"]
        API_HUB["Singleton Supabase Client\n(lib/supabaseClient.js)\n(Hemat Memori & Bebas Leak)"]
    end

    subgraph BACKEND ["🗄️ BACKEND & DATABASE (Supabase Cloud)"]
        DB[("PostgreSQL Database\n• 18 Tabel Data\n• RLS Security\n• Atomic RPC")]
        AUTH["Auth Module\n(Login & Enkripsi)"]
        STORAGE["Private Storage\n(Foto Medis Signed URL)"]
    end

    UI <==> API_HUB
    API_HUB <==> DB
    API_HUB <==> AUTH
    API_HUB <==> STORAGE
```

### 🧩 Peran Masing-Masing Komponen:
1. **Frontend (Next.js 16 & React 19)**: Menampilkan antarmuka yang anggun, responsif di layar iPad/HP kasir dan terapis, serta memuat halaman dalam hitungan milidetik.
2. **Client Hub (`lib/supabaseClient.js`)**: Jembatan terpusat yang menghubungkan aplikasi layar ke server tanpa boros memori.
3. **Backend & Database (Supabase PostgreSQL)**: Otak penyimpanan data 24 jam yang menangani kalkulasi keuangan, keamanan data per cabang, dan foto medis pasien.

---

## 🌐 Bab 3: Mind-Map & Arsitektur Multi-Cabang (`branches`)

Setiap cabang fisik (`Banjar [BJR]`, `Tasikmalaya [TSK]`, `Pangandaran [PND]`, `Ciamis [CMS]`) terhubung secara independen ke Pusat Supabase Database:

### 🧠 Mind-Map Visual Cabang
```mermaid
mindmap
  root((🗄️ SUPABASE DATABASE<br/>Ayumi Cloud Center))
    🏢 Cabang Banjar [BJR]
      👥 Staf & Terapis Banjar
      📦 Stok Produk Banjar
      💳 Nota Transaksi (TRX-BJR-...)
      📅 Kalender Janji Temu
    🏬 Cabang Tasikmalaya [TSK]
      👥 Staf & Terapis Tasik
      📦 Stok Produk Tasik
      💳 Nota Transaksi (TRX-TSK-...)
      📅 Kalender Janji Temu
    🏖️ Cabang Pangandaran [PND]
      👥 Staf & Terapis Pangandaran
      📦 Stok Produk Pangandaran
      💳 Nota Transaksi (TRX-PND-...)
      📅 Kalender Janji Temu
    🌾 Cabang Ciamis [CMS]
      👥 Staf & Terapis Ciamis
      📦 Stok Produk Ciamis
      💳 Nota Transaksi (TRX-CMS-...)
      📅 Kalender Janji Temu
```

---

## 🗄️ Bab 4: Peta Struktur Database & Relasi 18 Tabel (ERD)

Database Ayumi Beauty House menggunakan **PostgreSQL** yang terdiri dari 18 tabel utama yang saling terhubung secara utuh:

```mermaid
erDiagram
    branches ||--o{ users : "memiliki staff"
    branches ||--o{ product_stock : "stok inventaris"
    branches ||--o{ transactions : "tempat transaksi"
    branches ||--o{ appointments : "lokasi kunjungan"
    branches ||--o{ treatment_records : "lokasi tindakan"

    patients ||--o{ appointments : "membuat reservasi"
    patients ||--o{ treatment_records : "memiliki rekam medis"
    patients ||--o{ transactions : "melakukan pembayaran"
    patients ||--o{ patient_coupons : "memiliki paket kupon"

    appointments ||--o{ appointment_treatments : "detail layanan"
    treatment_records ||--o{ treatment_record_items : "detail tindakan & SOAP"
    transactions ||--o{ transaction_items : "detail item & produk"
    
    users ||--o{ treatment_records : "terapis pelaksana"
    users ||--o{ user_branch_assignments : "riwayat penugasan"
```

### 📋 Ringkasan Peran Lemari Data (Tabel) Utama:
- **`branches`**: Master cabang fisik, kode cabang (`BJR`, `TSK`, `PND`, `CMS`), dan target bulanan.
- **`users`**: Data staf, terapis, kasir, admin, dan owner.
- **`patients`**: Profil lengkap pasien, No. WA, dan tanggal lahir.
- **`appointments`**: Kalender janji temu dan reservasi kedatangan.
- **`treatment_records`**: Rekam medis, keluhan SOAP, dan foto *before/after*.
- **`transactions` & `transaction_items`**: Catatan keuangan, struk nota, diskon, dan pembayaran kasir.
- **`products` & `product_stock`**: Master katalog skincare dan stok riil inventaris per cabang.
- **`coupon_packages` & `patient_coupons`**: Master paket kupon hemat dan sisa sesi perawatan pasien.
- **`followup_queue`**: Antrian CRM otomatis pengingat H+3/7/30 dan Ulang Tahun.

---

## 🔄 Bab 5: Simulasi Alur Perjalanan Data Nyata (Data Flow)

Bagaimana transaksi kasir diproses secara **Atomis (All-or-Nothing)** tanpa risiko stok minus atau nota ganda?

```mermaid
flowchart TD
    Start["🛒 Kasir Memilih Layanan / Produk & Klik 'Bayar'"] --> AuthCheck{"🔒 Cek Satpam RLS:\nApakah Kasir Terdaftar di Cabang Ini?"}
    
    AuthCheck -- Tidak --> Deny["⛔ Akses Ditolak Database"]
    AuthCheck -- Ya --> LockCounter["🔒 Kunci Counter Nota (FOR UPDATE)\nGenerate TRX-CODE-YYYYMMDD-0001"]
    
    LockCounter --> InsertTrx["📝 Catat Transaksi, Subtotal, Diskon & Payment Method"]
    InsertTrx --> CheckItems{"🔍 Periksa Tipe Item Belanja"}
    
    CheckItems -- Produk Skincare --> SubStock["📦 Potong Stok Fisik Produk\ndi Cabang Terkait"]
    CheckItems -- Kupon Paket --> GenCoupon["🎟️ Terbitkan Kupon Digital Pasien\n(Masa Berlaku 1 Tahun)"]
    CheckItems -- Treatment Medis --> RecSOAP["🩺 Hubungkan ke Rekam Medis SOAP\n& Hitung Komisi Terapis"]

    SubStock --> Finalize
    GenCoupon --> Finalize
    RecSOAP --> Finalize

    Finalize{"❓ Apakah Semua Langkah Lulus Tanpa Error?"}
    Finalize -- Ya --> Success["✅ Commit Transaksi & Cetak Struk Nota Lunas 🧾"]
    Finalize -- Ada Error / Internet Putus --> Rollback["🔄 Rollback 100%\n(Batalkan Semua Langkah, Data Uang & Stok Tetap Utuh)"]
```

---

## 🔒 Bab 6: Keamanan, Satpam RLS & Pencegahan Kecurangan

1. **Satpam Pembatas Cabang (Row Level Security / RLS)**:
   - Staf Kasir Cabang Banjar tidak bisa melihat nota transaksi atau rekam medis Cabang Tasikmalaya.
2. **Proteksi Bentrok Jam Terapis (`trg_check_therapist_overlap`)**:
   - Database menolak pembuatan reservasi baru jika terapis yang dipilih sudah menangani pasien lain di jam yang sama.
3. **Privasi Foto Medis Pasien**:
   - Foto disimpan di *Private Bucket* dan diakses menggunakan **Signed URLs (berlaku 1 jam)**. Foto tidak bisa diintip publik.
4. **Pencegahan Kecurangan Kasir (Fraud Prevention)**:
   - Akun Kasir dilarang menghapus (*DELETE*) nota transaksi yang sudah lunas. Hak hapus nota dikunci khusus untuk akun **Owner**.

---

## 💼 Bab 7: Panduan Operasional & Pemeliharaan untuk Owner

1. **Backup Data Manual Rutin**:
   - Unduh salinan data full dari menu **Pengaturan → Backup & Restore Database** minimal 1x seminggu.
2. **Pengambilan Keputusan Bisnis (Data-Driven)**:
   - Manfaatkan menu **Laporan Treatment** & **Laporan Terapis** untuk melihat menu paling laku dan kontribusi omset per terapis.
3. **Kesiapan Peluncuran Web (Deployment)**:
   - Aplikasi siap di-online-kan menggunakan **Vercel** (gratis) + domain kustom pilihan Anda (misal `app.ayumibeautyhouse.com`).

---

> **Aplikasi Ayumi Beauty House adalah aset digital modern yang rapi, aman, akurat, dan siap menemani kesuksesan ekspansi bisnis klinik kecantikan Anda!** 🚀
