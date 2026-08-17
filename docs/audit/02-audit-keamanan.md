# 🛡️ 02 — Laporan Audit Keamanan Sistem Ayumi Beauty House

> **Status Audit:** Tahap 1 — Audit Keamanan (Read-Only)  
> **Tanggal Audit:** 17 Agustus 2026  
> **Auditor:** Senior Software Architect (Antigravity Agent)  
> **Target:** Keamanan Kredensial, Kontrol Akses Multi-Cabang, Storage Foto Medis, & Proteksi API/Route

---

## 1. Ringkasan Eksekutif

Secara umum, arsitektur dasar keamanan sistem Ayumi Beauty House sudah menerapkan prinsip-prinsip modern yang baik: kredensial rahasia (*service_role key*) disimpan aman di environment server dan tidak bocor ke browser publik, file `.env` diabaikan oleh Git, dan dokumen foto medis diakses menggunakan *Signed URL* berjangka waktu 1 jam. 

Namun demikian, terdapat risiko keamanan tingkat **TINGGI** terkait pemisahan data antar cabang fisik: sebagian besar filter cabang dilakukan di sisi frontend JavaScript (bukan murni mengandalkan isolasi Row Level Security / RLS di database). Jika staf yang paham teknis memodifikasi query dari browser (*DevTools*), ada potensi staf cabang tertentu dapat melihat omset atau rekam medis cabang lain. Selain itu, rute API `/api` dikecualikan dari middleware global sehingga setiap endpoint API wajib memverifikasi sesi login secara independen.

---

## 2. Tabel Temuan Keamanan

| No | Temuan | Tingkat | Lokasi File : Baris | Dampak Bisnis | Rekomendasi |
|:---:|:---|:---:|:---|:---|:---|
| 1 | **Filter Cabang Bergantung pada Logika Frontend** | **TINGGI** | [`app/transactions/page.js:115-119`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/transactions/page.js#L115-L119)<br>[`app/reports/therapists/page.js:114-116`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/reports/therapists/page.js#L114-L116) | Staf kasir/admin cabang tertentu berpotensi melihat laporan omset dan rekapitulasi transaksi cabang lain jika RLS database tidak diaktifkan secara ketat. | Terapkan RLS policy ketat di PostgreSQL `auth.users` -> `users.branch_id` untuk tabel `transactions`, `treatment_records`, dan `treatment_record_items`. |
| 2 | **Toggle Status User Langsung dari Client-Side** | **TINGGI** | [`app/settings/users/page.js:89-99`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/settings/users/page.js#L89-L99) | Staf non-owner yang memiliki akses jaringan bisa mencoba mengirim perintah update `is_active` ke tabel `users` langsung dari console browser. | Pindahkan fungsi aktivasi/deaktivasi user ke Server-Side API (`/api/users/route.js`) dengan verifikasi role `owner`. |
| 3 | **Pengecualian Rute `/api` dari Middleware Global** | **SEDANG** | [`middleware.js:60`](file:///Users/user/Project%20Saas/ayumi-beauty-house/middleware.js#L60) | Jika developer di masa depan membuat endpoint baru di folder `app/api/` dan lupa menambahkan pengecekan auth manual, endpoint tersebut akan terbuka untuk publik. | Buat helper middleware/auth guard standar untuk semua API handler, atau masukkan `/api` ke middleware verifikasi session token. |
| 4 | **Fallback `getPublicUrl` pada Foto Medis** | **SEDANG** | [`components/ui/TherapistPatientHistoryModal.js:33`](file:///Users/user/Project%20Saas/ayumi-beauty-house/components/ui/TherapistPatientHistoryModal.js#L33) | Jika bucket Storage di Supabase diset ke mode *Public*, URL foto klinis pasien bisa diakses oleh siapa saja yang memiliki tautan tanpa login. | Pastikan bucket `patient-photos` berstatus **Private** dan seluruh akses selalu menggunakan `createSignedUrl` bertempo waktu. |
| 5 | **Otorisasi Role Halaman Hanya di Sisi Klien** | **SEDANG** | [`app/settings/page.js:20-35`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/settings/page.js#L20-L35)<br>[`app/ClientLayout.js:50-70`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/ClientLayout.js#L50-L70) | Pengalihan halaman (*redirect*) non-owner hanya mengandalkan `router.push('/dashboard')` di JavaScript browser. | Jadikan RLS database sebagai benteng pertahanan utama agar data master tetap aman meskipun UI di-bypass. |
| 6 | **Penyimpanan Kredensial Environment Variables** | **AMAN** | [`lib/supabaseClient.js:12-21`](file:///Users/user/Project%20Saas/ayumi-beauty-house/lib/supabaseClient.js#L12-L21)<br>[`.gitignore:34`](file:///Users/user/Project%20Saas/ayumi-beauty-house/.gitignore#L34) | Tidak ada kebocoran kredensial rahasia. Kunci publik aman dipakai di browser, dan `service_role` hanya diakses di backend. | Pertahankan praktik pemisahan variabel environment ini. |
| 7 | **Penggunaan Signed URL Foto Medis di Detail SOAP** | **AMAN** | [`app/treatment-records/[id]/page.js:198-200`](file:///Users/user/Project%20Saas/ayumi-beauty-house/app/treatment-records/%5Bid%5D/page.js#L198-L200) | Foto klinis pasien tidak diekspos melalui tautan permanen, melainkan menggunakan token bertanda tangan yang kedaluwarsa dalam 1 jam (3600 detik). | Praktik yang sangat baik untuk kepatuhan privasi data medis pasien. |

---

## 3. Detail Temuan Tingkat KRITIS & TINGGI

### 🔴 Temuan #1: Filter Cabang Bergantung pada Logika Frontend
- **Lokasi Kode:** `app/transactions/page.js` baris 115–119 dan `app/reports/therapists/page.js` baris 114–116.
- **Skenario Risiko Nyata:**
  Kasir atau staf admin di **Cabang Banjar** membuka halaman riwayat transaksi. Secara visual, dropdown cabang terkunci atau JavaScript memfilter `.eq('branch_id', 'banjar_id')`. Namun, jika kasir tersebut membuka *Chrome Developer Tools -> Console* dan mengeksekusi perintah:
  ```javascript
  const { data } = await supabase.from('transactions').select('*');
  ```
  Jika tabel `transactions` di database Supabase tidak memiliki policy RLS yang membatasi baris berdasarkan `users.branch_id`, maka seluruh data omset dan invoice dari **Cabang Tasikmalaya, Ciamis, dan Pangandaran** akan langsung terbaca oleh kasir tersebut.
- **Dampak Bisnis:** Kebocoran data sensitif omset harian antar cabang dan potensi penyalahgunaan data finansial oleh staf internal.
- **Rekomendasi:** Terapkan Row Level Security (RLS) pada tabel `transactions` dan `treatment_records` di PostgreSQL sehingga database menolak mengembalikan baris cabang lain meskipun query client tidak menyertakan filter `eq('branch_id')`.

---

### 🔴 Temuan #2: Toggle Status User Langsung dari Client-Side
- **Lokasi Kode:** `app/settings/users/page.js` baris 89–99.
- **Skenario Risiko Nyata:**
  Pada fungsi `handleToggleActive`, kode langsung menjalankan query update:
  ```javascript
  supabase.from('users').update({ is_active: !u.is_active }).eq('id', u.id)
  ```
  Sementara operasi penghapusan (`handleDelete`) sudah benar dilewatkan melalui `/api/users` dengan validasi role owner, operasi toggle status aktif user masih dilakukan langsung dari browser. Staf kasir/admin yang mengetahui UUID akun staf lain bisa mematikan/menonaktifkan akun staf lain secara sepihak dari console browser jika RLS tabel `users` tidak membatasi operasi `UPDATE`.
- **Dampak Bisnis:** Staf dapat menonaktifkan akun rekan kerja atau mengaktifkan kembali akun yang telah di-suspend oleh owner.
- **Rekomendasi:** Pindahkan fungsi toggle status aktif akun ke server route handler `app/api/users/route.js` dengan memverifikasi bahwa pengirim request adalah `owner`.

---

## 4. Praktik yang Sudah Benar & Aman

1. **Isolasi Service Role Key**: `SUPABASE_SERVICE_ROLE_KEY` tidak pernah menggunakan prefix `NEXT_PUBLIC_` dan hanya dipanggil di dalam lingkungan server Node.js (`app/api/**/route.js`).
2. **Git Hygiene**: File `.gitignore` telah mengabaikan semua varian `.env*` dan folder pengujian `scratch/`, mencegah kebocoran kredensial ke repository Git publik/privat.
3. **Privasi Nomor WhatsApp Terapis**: Endpoint khusus terapis (`/api/therapist/patient-lookup` dan `/api/therapist/patient-history`) telah menyaring dan membuang field `whatsapp` sebelum data dikirim ke perangkat terapis.
4. **Masa Berlaku Signed URL**: Pengambilan foto medis pada modul rekam medis menggunakan waktu kedaluwarsa 1 jam (`60 * 60`), mencegah tautan foto medis tersebar permanen di internet.
5. **Autentikasi Session Cookie**: Middleware Next.js secara aktif memeriksa token sesi cookie Supabase dan langsung mengarahkan pengunjung tanpa sesi ke halaman `/login`.

---

## 5. Hal yang Perlu Dicek Langsung di Supabase Dashboard

Karena pemeriksaan ini berbasis kode (*read-only*), hal-hal berikut **wajib dicek manual oleh pemilik klinik di Supabase Dashboard**:

1. **Status Row Level Security (RLS) Seluruh Tabel**:
   - Buka menu **Database → Tables** di Supabase Dashboard.
   - Pastikan badge **RLS ENABLED** aktif berwarna hijau pada tabel-tabel sensitif: `transactions`, `transaction_items`, `treatment_records`, `patients`, `users`, dan `product_stock`.
2. **Status Privasi Bucket Storage**:
   - Buka menu **Storage → Buckets**.
   - Pastikan bucket `patient-photos` berstatus **Private** (bukan *Public*).
3. **Konfigurasi Auth Expiry**:
   - Buka **Authentication → Providers & URL Configuration**.
   - Periksa durasi *JWT Expiry Limit* (direkomendasikan 3600 detik / 1 jam dengan auto-refresh).
