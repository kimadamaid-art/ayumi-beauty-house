# 🗺️ 01 — Peta Codebase & Arsitektur Sistem Ayumi Beauty House

> **Status Audit:** Tahap 0 — Pemetaan Awal Codebase (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Aplikasi:** Ayumi Beauty House ERP (Klinik Kecantikan Multi-Cabang: Banjar, Tasikmalaya, Pangandaran, Ciamis)  
> **Tech Stack:** Next.js 16.2.9 (App Router) + React 19.2.4 + Tailwind CSS v4, Backend: Supabase (PostgreSQL, Auth, Storage)

---

## 1. Ringkasan Struktur Project (Tree Level 1–3)

```text
ayumi-beauty-house/
├── app/                              # Next.js App Router (Halaman, Layout & API Routes)
│   ├── api/                          # Server-side API Endpoints (Next.js Route Handlers)
│   │   ├── therapist/                # API Khusus Terapis (patient-history, patient-lookup)
│   │   └── users/                    # API Manajemen User Auth & Database (CRUD User)
│   ├── appointments/                 # Manajemen Jadwal Janji Temu (List, New, Detail, Edit)
│   ├── coupons/                      # Manajemen Paket Kupon Perawatan (List, New, Detail)
│   ├── crm/                          # CRM & Follow-up Pasien (Antrean WhatsApp, Reminder)
│   ├── dashboard/                    # Dashboard Utama Eksekutif / Owner / Kasir
│   ├── kasir/                        # Modul Kasir POS, Pembayaran, Checkout, & Riwayat
│   ├── login/                        # Halaman Login Multi-Role
│   ├── patients/                     # Database Master Pasien & Rekam Profil Klinis
│   ├── reports/                      # Laporan Finansial & Performa (Terapis & Treatment)
│   ├── settings/                     # Pengaturan (Cabang, User, Produk, Stok, Treatment, Backup)
│   ├── therapist/                    # Portal Khusus User Terapis (Dashboard, Jadwal, Input SOAP)
│   ├── transactions/                 # Rekapitulasi & Riwayat Transaksi Finansial
│   ├── treatment-records/            # Rekam Medis (EMR/SOAP) & Foto Klinis Pasien
│   ├── ClientLayout.js               # Wrapper UI Client (Sidebar, Header, Auth Guard)
│   ├── globals.css                   # Desain Sistem Global Tailwind CSS v4 & Tema Ayumi
│   ├── layout.tsx                    # Root Layout HTML & Font Setup
│   └── page.tsx                      # Root Entrypoint (Redirect otomatis ke /dashboard /login)
├── components/                       # Komponen UI Reusable
│   ├── ui/                           # Komponen Atom & Modal (CameraCaptureModal, TherapistModal, dll)
│   ├── DateRangePicker.js            # Komponen Kalender Pemilih Rentang Tanggal
│   ├── GlobalHeader.js               # Header Navigasi Atas, Profil, & Notifikasi
│   └── GlobalSidebar.js              # Sidebar Navigasi Berdasarkan Role User
├── docs/                             # Dokumentasi Sistem & Laporan Audit
│   └── audit/                        # Hasil Temuan Audit Teknis Bertahap
├── lib/                              # Helper, Konfigurasi, & Utility
│   ├── errorMessages.js              # Translator Pesan Error Supabase ke Bahasa Indonesia Awam
│   ├── supabase.js                   # Client Legacy Supabase
│   └── supabaseClient.js             # Singleton Supabase Client Utama (Browser Client)
├── migrations_archive/               # Arsip 21 File Skrip Migrasi SQL Database Supabase
├── public/                           # Aset Statis (Logo Ayumi, Ikon SVG)
├── scratch/                          # Skrip Utility & Pengujian Internal
├── middleware.js                     # Next.js Proxy/Middleware untuk Proteksi Sesi Auth & Cookie
├── package.json                      # Daftar Dependensi & Skrip Node.js
└── tsconfig.json                     # Konfigurasi TypeScript
```

---

## 2. Tabel Pemetaan Area Fungsional

| Area Fungsional | File / Folder Terkait | Deskripsi & Catatan Arsitektur |
| :--- | :--- | :--- |
| **Konfigurasi Supabase Client** | `lib/supabaseClient.js`<br>`lib/supabase.js`<br>`middleware.js`<br>`app/api/**/route.js` | Client-side menggunakan `createClient` dari `@supabase/supabase-js` dengan `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Server-side / Route Handlers menggunakan `createServerClient` dan `SUPABASE_SERVICE_ROLE_KEY` untuk bypass RLS lintas cabang. |
| **Autentikasi & Otorisasi** | `app/login/page.js`<br>`middleware.js`<br>`app/ClientLayout.js`<br>`app/api/users/route.js` | Login via Supabase Auth. Role disimpan di tabel `public.users` (`owner`, `admin`, `therapist`, `cashier`). Middleware menyaring proteksi cookie rute. |
| **Kasir & Point of Sale (POS)** | `app/kasir/page.js`<br>`app/kasir/history/page.js`<br>`app/kasir/transactions/[id]/page.js`<br>`app/transactions/page.js` | Modul kasir utama (`app/kasir/page.js`) menangani keranjang belanja multi-item (produk, treatment, paket kupon), redeem kupon, diskon, split payment, dan pencetakan invoice/struk thermal. |
| **Rekam Medis (SOAP) & Foto Klinis** | `app/treatment-records/page.js`<br>`app/treatment-records/new/page.js`<br>`app/treatment-records/[id]/page.js`<br>`app/treatment-records/[id]/edit/page.js`<br>`components/ui/CameraCaptureModal.js` | Input SOAP medis (*Subjective, Objective, Assessment, Plan*), riwayat tindakan, dan unggah foto before/after (depan, kiri, kanan) dengan akses live camera WebRTC ke Supabase Storage bucket `patient-photos`. |
| **Portal Khusus Terapis** | `app/therapist/dashboard/page.js`<br>`app/therapist/appointments/page.js`<br>`app/therapist/treatment-input/[appointmentId]/page.js`<br>`components/ui/TherapistPatientHistoryModal.js` | Antarmuka mobile-friendly untuk terapis: klaim pasien antrean, input SOAP tindakan, kalkulator komisi harian, dan popup riwayat medis pasien (*dengan nomor kontak WhatsApp disembunyikan*). |
| **Jadwal & Antrean Janji Temu** | `app/appointments/page.js`<br>`app/appointments/new/page.js`<br>`app/appointments/[id]/page.js`<br>`app/appointments/[id]/edit/page.js` | Manajemen appointment per cabang, timeline slot jam, penugasan terapis, status kedatangan (*booked, arrived, therapist_ready, in_treatment, completed, cancelled*). |
| **CRM & Follow-Up Pasien** | `app/crm/page.js`<br>`app/crm/layout.js` | Otomasi antrean follow-up kepuasan H+3 tindakan, pengingat treatment ulang H+14/H+30, ucapan ulang tahun pasien, dan integrasi template pesan WhatsApp Web API. |
| **Paket Kupon Perawatan** | `app/coupons/page.js`<br>`app/coupons/packages/new/page.js`<br>`app/coupons/packages/[id]/page.js` | Pengelolaan paket bundling perawatan multi-sesi, pelacakan sisa kuota sesi per pasien, log pemakaian kupon, dan status kupon aktif/habis/expired. |
| **Laporan & Reporting Finansial** | `app/reports/therapists/page.js`<br>`app/reports/therapists/[id]/page.js`<br>`app/reports/treatments/page.js`<br>`app/reports/treatments/[id]/page.js`<br>`app/dashboard/page.js` | Agregasi omset penjualan, laporan komisi terapis, laporan volume treatment terlaris, visualisasi grafik Recharts, serta ekspor data ke format Excel (`xlsx`) dan PDF (`jspdf` + `html2canvas`). |
| **Master Data & Pengaturan** | `app/settings/branches/page.js`<br>`app/settings/users/page.js`<br>`app/settings/products/page.js`<br>`app/settings/product-stock/page.js`<br>`app/settings/treatments/page.js`<br>`app/settings/treatment-categories/page.js`<br>`app/settings/backup/page.js` | CRUD cabang klinik, staf/user, master produk, kontrol stok per cabang, kategori & tarif treatment, target bulanan cabang, dan backup/restore skema JSON. |
| **Migrasi & Skrip SQL Database** | `migrations_archive/` (21 file SQL) | Kumpulan skrip DDL/DML, fungsi RPC checkout atomis (`process_checkout_rpc.sql`), trigger overlap terapis, dan kebijakan RLS Supabase. |

---

## 3. Daftar Dependency Utama (package.json)

### Production Dependencies
| Library / Package | Versi | Fungsi dalam Sistem |
| :--- | :--- | :--- |
| `next` | `16.2.9` | Framework React App Router & Server Engine |
| `react` | `19.2.4` | UI Library |
| `react-dom` | `19.2.4` | DOM Rendering Engine |
| `@supabase/supabase-js` | `^2.108.1` | Supabase Client SDK (PostgreSQL Query, Auth, Storage) |
| `@supabase/auth-helpers-nextjs` | `^0.15.0` | Server-side / Middleware Auth Session Cookie Adapter |
| `recharts` | `^3.8.1` | Library Visualisasi Grafik Laporan & Analytics Dashboard |
| `xlsx` | `^0.18.5` | Export data tabel ke spreadsheet Excel (`.xlsx`) |
| `jspdf` | `^4.2.1` | Generator dokumen PDF untuk cetak laporan & invoice |
| `html2canvas` | `^1.4.1` | Render DOM HTML ke canvas image untuk PDF export |
| `react-hot-toast` | `^2.6.0` | Notifikasi toast banner interaktif |
| `react-tailwindcss-datepicker` | `^2.0.0` | Komponen kalender interaktif |
| `pg` | `^8.21.0` | Driver Node-Postgres (utility backend) |

### Dev Dependencies
| Library / Package | Versi | Fungsi dalam Sistem |
| :--- | :--- | :--- |
| `tailwindcss` | `^4` | Utility-first Styling Engine (Tailwind v4) |
| `@tailwindcss/postcss` | `^4` | PostCSS plugin Tailwind v4 |
| `typescript` | `^5` | Type Definitions |
| `eslint` & `eslint-config-next` | `^9` / `16.2.9` | Linting & Code Quality |

---

## 4. Daftar File Berukuran Tidak Wajar (>500 Baris)

Terdapat **22 file sumber** yang memiliki ukuran lebih dari 500 baris. File-file ini merupakan file monolitik (*God Components*) yang memadukan UI, state management, validasi, kalkulasi bisnis, dan query Supabase sekaligus dalam satu file, sehingga menjadi **kandidat utama risiko maintainability, potensi regresi bug, dan perlambatan performa rendering**:

| No | File Path | Jumlah Baris | Kompleksitas / Tanggung Jawab yang Tergabung |
| :---: | :--- | :---: | :--- |
| 1 | `app/transactions/page.js` | **2.859** | Riwayat transaksi, filter multi-cabang, kalkulasi summary omset, modal detail, print invoice thermal, ekspor excel. |
| 2 | `app/dashboard/page.js` | **2.015** | Dashboard eksekutif: KPI cards, multi-branch summary, filter tanggal, grafik Recharts, target bulanan, appointment timeline, recent logs. |
| 3 | `app/kasir/page.js` | **1.721** | Modul POS Kasir: Katalog item, cart state, pemotongan stok, redeem kupon, diskon, split payment, form pasien baru, cetak struk. |
| 4 | `app/crm/page.js` | **1.491** | Tabulasi CRM: Follow-up H+3, Recall H+14/H+30, Ulang Tahun, kirim WhatsApp Web link, update status antrean follow-up. |
| 5 | `app/appointments/page.js` | **1.231** | Kalender & tabel appointment, filter status, filter cabang, modal booking cepat, integrasi treatment list, claim terapis. |
| 6 | `app/treatment-records/new/page.js` | **1.034** | Form SOAP baru, pemilihan treatment, input keluhan, upload 3 foto medis, kamera live capture, validasi kupon, integrasi followup queue. |
| 7 | `app/patients/[id]/page.js` | **953** | Profil pasien lengkap, riwayat SOAP, galeri foto before/after, riwayat kupon, riwayat transaksi, edit profil. |
| 8 | `app/therapist/dashboard/page.js` | **887** | Kalender kerja terapis harian, klaim pasien, rekap komisi periodik, rincian komisi per treatment, tabel appointment. |
| 9 | `app/treatment-records/[id]/edit/page.js` | **863** | Form edit SOAP medis, pergantian foto klinis, recalculation item treatment, rollback kupon lama. |
| 10 | `app/reports/therapists/page.js` | **844** | Rekap performa seluruh terapis, kalkulasi omset per terapis, komisi per cabang, filter tanggal, visualisasi bar chart. |
| 11 | `app/therapist/treatment-input/[appointmentId]/page.js` | **839** | Form SOAP khusus terapis, pemilihan treatment, kupon paket, capture foto kamera, sinkronisasi rekam medis. |
| 12 | `app/coupons/page.js` | **794** | Master katalog paket kupon, daftar kupon terjual per pasien, sisa kuota sesi, tracking masa aktif kupon. |
| 13 | `app/treatment-records/[id]/page.js` | **779** | Tampilan detail rekam medis SOAP, perbandingan foto before/after, rincian tindakan dan biaya, print rekam medis. |
| 14 | `app/reports/treatments/[id]/page.js` | **779** | Detail laporan treatment spesifik: tren penjualan, demografi pasien, terapis pelaksana, filter rentang waktu. |
| 15 | `app/settings/products/page.js` | **694** | Master produk skincare, modal CRUD, kategori produk, harga beli/jual, pengaturan alert minimum stok. |
| 16 | `app/therapist/appointments/page.js` | **690** | Tab jadwal appointment terapis vs tab riwayat selesai, kalkulasi komisi terapis, modal riwayat pasien. |
| 17 | `app/reports/treatments/page.js` | **679** | Laporan agregasi seluruh treatment klinik: volume tindakan, kontribusi omset per kategori, ekspor Excel/PDF. |
| 18 | `app/patients/page.js` | **642** | Tabel master database pasien, pencarian instan nama/WA, pagination, filter cabang asal pasien. |
| 19 | `app/appointments/[id]/page.js` | **579** | Detail janji temu, status kedatangan, catatan klinis terkait, tombol redirect ke kasir / input SOAP. |
| 20 | `app/settings/treatments/page.js` | **555** | Master layanan treatment, pengaturan persentase komisi terapis, estimasi durasi, kategori treatment. |
| 21 | `app/reports/therapists/[id]/page.js` | **552** | Laporan detail individual terapis: daftar tindakan yang dikerjakan, komisi per item, filter cabang & tanggal. |
| 22 | `app/kasir/transactions/[id]/page.js` | **518** | Tampilan nota/invoice resmi pasca transaksi, tombol reprint struk thermal, detail payment method. |

---

## 5. Hal yang Belum Dapat Disimpulkan (Perlu Konfirmasi)

Berikut adalah beberapa aspek arsitektur yang **tidak dapat disimpulkan 100% hanya dari pembacaan kode frontend** dan membutuhkan verifikasi/konfirmasi lebih lanjut pada audit tahap berikutnya:

1. **Status Aktif RPC `process_checkout` di Database Produksi**:
   - Di `migrations_archive/process_checkout_rpc.sql` terdapat fungsi database RPC PostgreSQL untuk transaksi atomis. Namun, di `app/kasir/page.js` sebagian alur checkout tampak masih melakukan query berurutan dari JavaScript client (`transactions` insert -> `transaction_items` insert -> `product_stock` update -> `patient_coupons` update). Perlu dikonfirmasi apakah checkout saat ini menggunakan RPC database atau multi-step JavaScript client.
2. **Konfigurasi Bucket Supabase Storage (`patient-photos`)**:
   - Kode memanggil `supabase.storage.from('patient-photos')`. Dari kode tidak terlihat apakah bucket diset **Public** atau **Private** di Supabase Dashboard, serta apakah RLS Storage membatasi akses baca antar cabang.
3. **Mekanisme Otomasi Cron Job Background**:
   - Terdapat skrip `scratch/cron_reminders.js` untuk reminder CRM WhatsApp. Perlu dikonfirmasi apakah cron job ini berjalan di Supabase Edge Functions, Vercel Cron, server eksternal, atau saat ini masih ditrigger manual dari browser staf.
4. **Volume Data Real-time & Pertumbuhan Database**:
   - Jumlah baris data aktual di tabel `transactions`, `transaction_items`, dan `treatment_records` di server Supabase live perlu dicocokkan pada Prompt 2 untuk mengukur titik kritis performa index.
