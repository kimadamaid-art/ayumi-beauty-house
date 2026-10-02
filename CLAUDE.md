# Ayumi Beauty House — Project Context & Guide for Claude Code

## 1. Project Overview & Architecture
- **App Type**: SaaS Manajemen Klinik Kecantikan multi-cabang (Ayumi Beauty House).
- **Tech Stack**: Next.js 16 (App Router, Turbopack), React 19, Supabase (PostgreSQL), Vanilla CSS / Tailwind utilities.
- **Local Dev Server**: `npm run dev` (Port 3000)
- **Production Build**: `npm run build`
- **Environment**: Configured in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- **Middleware**: `proxy.js` (konvensi Next 16, pengganti `middleware.js`).
- **Lint**: `npm run lint`. Next 16 tidak menjalankan ESLint saat `next build`, jadi build lolos tidak berarti lint bersih. Folder non-aplikasi (`scratch/`, `scripts/`, `migrations*/`, `backups/`, `data_dump/`) diabaikan di `eslint.config.mjs`.
- **Migrasi database**: yang berlaku ada di `supabase/migrations/` (berawalan tanggal, kebanyakan berpasangan dengan file `_ROLLBACK`). `migrations_archive/` dan `migrations/` di root adalah arsip lama dan bisa bertentangan dengan skema sekarang; jangan dijadikan acuan.

---

## 2. Multi-Branch Configuration
Klinik beroperasi di 4 cabang:
1. **Ayumi Ciamis**: `6bc44a26-f7f3-4ea7-8902-a2c48e27b598`
2. **Ayumi Tasikmalaya**: `964eaa28-e905-430a-b3da-38e48dcbb813`
3. **Ayumi Banjar**: `c4f02158-921a-4f8b-a4bc-5a98394dc35e`
4. **Ayumi Pangandaran**: `d61e80db-303f-4dde-b17d-2c1d445a0495`

### Role & Branch Access Rules:
- **`owner`**: Akses global (`branch_id = null`), memiliki dropdown filter cabang ("Semua Cabang" atau pilih cabang tertentu) di modul CRM, Kasir, Dashboard, dan Laporan.
- **`admin`**: Terikat ke satu cabang (`branch_id = UUID cabang`). Semua query database (Kasir, Antrean CRM, Pasien, Transaksi) harus ter-filter ke cabang miliknya secara otomatis.
- **`therapist`**: Terikat ke cabang, input rekam medis dan komisi terapis.
- **Worker** (mis. petugas infus) bukan akun login; disimpan di tabel `workers` dan dikelola di `/settings/workers`.

---

## 3. Database Constraints & Important Gotchas
- **`followup_queue` & `followup_logs`**:
  - Kolom `branch_id` wajib terisi. Jangan pernah meng-insert `null` (selalu berikan fallback ke `item.branch_id || patient.branch_id || userBranchId`).
  - Check constraint `followup_type` **berbeda per tabel**:
    - `followup_queue`: `'treatment_reminder'`, `'birthday'`, `'manual'`. Tipe tahap seperti `followup_2minggu`/`3minggu`/`1bulan`, `dormant_reminder`, `custom_reminder` ditolak (error `23514`). Bukti: per 2 Okt 2026 tabel ini hanya berisi `treatment_reminder` dan `birthday`, padahal 653 rekam medis sejak 1 Sep mencoba menyisipkan tipe tahap.
    - `followup_logs` (migrasi `20261001_crm_treatment_targets.sql`): `'treatment_reminder'`, `'birthday'`, `'dormant_reactivation'`, `'manual'`, `'treatment_specific'`. Tabel ini juga punya kolom `treatment_id` (boleh kosong).
  - Sub-tipe pesan disimpan sebagai prefix `notes` (e.g. `[followup_2minggu] Catatan...`), seperti yang dilakukan `app/crm/page.js` saat menulis log.
  - **Bug yang diketahui (belum diperbaiki)**: `app/treatment-records/new/page.js` dan `app/treatment-records/[id]/edit/page.js` menyisipkan antrean dengan tipe `followup_2minggu`/`3minggu`/`1bulan`, sehingga selalu gagal dan error-nya hanya di-`console.warn`. Halaman edit juga menghapus antrean lama rekam medis itu lebih dulu, jadi antreannya hilang. Form "Tambah Follow Up Manual" di CRM menawarkan tipe yang ditolak dan hanya `treatment_reminder` yang berhasil.
- **`transaction_items`**:
  - Hindari baris yatim (orphan rows). Pastikan `product_id` atau `treatment_id` valid.
- **Supabase Limit**:
  - Supabase membatasi 1.000 baris per query tanpa paginasi. Gunakan helper `fetchAllPaginated(buildQuery)` dari `lib/fetchAllPaginated.js` untuk query bulk seperti pasien atau rekam medis.

---

## 4. Status Pengerjaan Terakhir (Recent Updates)
Catatan ini potret per akhir Sep/awal Okt 2026; angka bisa sudah berubah, cek database sebelum mengandalkannya.

1. **Pembersihan Tagihan Menunggu Kasir (GD Cashier Migration Sync)**:
   - **Cabang Banjar**: Berhasil memetakan 19 transaksi migrasi ke rekam medis riil dan menghapus rekam medis dummy duplikat. Sisa 1 tagihan menunggu riil (Hilman Yufa, 24 Sep).
   - **Cabang Tasikmalaya**: Berhasil mencocokkan 23 transaksi migrasi dengan file Excel GD Cashier (`Ayumi_Tasikmalaya_Migrasi_2026-09-29.xlsx`), menghapus dummy duplikat. Sisa 2 tagihan riil belum bayar (Mamah Teh Wela & Hilman Yufa, 16 Sep).
   - **Kasir Auto-Heal**: `app/kasir/page.js` dilengkapi fungsi auto-heal untuk transaksi migrasi tanpa perlu intervensi manual.
2. **Modul CRM per Cabang (`app/crm/page.js`)**:
   - Follow-up queue telah di-generate untuk cabang aktif (per 2 Okt 2026: Banjar 1.336, Tasikmalaya 936, Ciamis 416; Pangandaran belum ada antrean).
   - Tab "Target Treatment" (`components/crm/TreatmentTargetTab.js`) memakai RPC `crm_treatment_targets` dan menulis log bertipe `treatment_specific`.
   - Ditambahkan 4 kartu metrik KPI cepat per cabang: *Perlu Dihubungi Hari Ini*, *7 Hari Mendatang*, *Ulang Tahun Pekan Ini*, *Pasien Dormant (>90 Hari)*.
   - Filter query dan badge indikator cabang khusus Admin Cabang (`📍 Ayumi Banjar`, dll.).
   - Template pesan WhatsApp otomatis menyematkan nama cabang kliniknya.
3. **Dashboard Omzet & Analisis Cabang (`app/dashboard/page.js`)**:
   - Rincian omzet kotor, diskon, dan bersih per cabang sudah sinkron dengan nota GD Cashier.
   - Analisis performa cabang ditangani di `lib/dashboardInsights.js` dan `lib/revenueBreakdown.js`.
4. **Refactoring Fase 1** (branch `refactor/fase-1`): bersih-bersih import/variabel mati dan konfigurasi lint, tanpa perubahan logika. Fase berikutnya: konsolidasi helper ke `lib/`, lalu memecah halaman besar (`app/kasir/page.js`, `app/dashboard/page.js`, `app/transactions/page.js`) menjadi komponen.
