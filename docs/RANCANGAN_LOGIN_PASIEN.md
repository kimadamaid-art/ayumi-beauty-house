# Rancangan Keamanan: Login Pasien (Portal Riwayat & Foto)

Status: rancangan, belum dikerjakan. Disusun 2 Okt 2026 dari pemeriksaan kode, migrasi
`supabase/migrations/`, schema dump 22 Sep (`scripts/migration/schema_dump.sql`), dan uji
akses tanpa login ke database produksi.

Tujuan fitur: pasien bisa login dan melihat **riwayat transaksi** serta **foto before–after**
miliknya sendiri. Syarat mutlak: pasien **tidak pernah** bisa melihat atau mengubah data pasien lain,
dan cara kerja staf (owner, admin, terapis) tidak berubah.

---

## 1. Kondisi keamanan saat ini

| Aspek | Temuan | Status |
|---|---|---|
| Akses tanpa login (kunci publik/anon) | 14 tabel inti diuji: semua tertutup (0 baris / ditolak) | ✅ Aman |
| Akses pengguna login | Banyak aturan RLS `USING (true)`: siapa pun yang login boleh membaca semua baris | ⚠️ Aman **hanya** selama yang bisa login cuma staf |
| Foto pasien | Bucket `patient-photos` **publik**; alamat file memuat 2 UUID acak (`<uuid>/<uuid>/foto_depan.webp`) | ⚠️ Tidak bisa ditebak, tapi tautan yang tersebar bisa dibuka siapa pun |

Aturan `true` menurut schema dump 22 Sep (perlu dipastikan di database live, lihat §6):

- `patients`: SELECT, INSERT, UPDATE
- `patient_photos`: ALL (dua aturan)
- `transaction_items`: SELECT, INSERT
- `treatment_record_items`: SELECT, ALL
- `treatment_records`: INSERT, UPDATE
- `patient_coupons`: SELECT, INSERT, UPDATE; `patient_coupon_items`: SELECT, ALL
- `treatment_records_audit`: ALL; `notifications`: INSERT
- `branches`, `coupon_packages`, `products`, `user_branch_assignments`: SELECT

Di PostgreSQL, beberapa aturan untuk tabel yang sama digabung dengan **ATAU**: satu aturan `true`
membuka seluruh tabel, walaupun ada aturan lain yang ketat (misalnya pengetatan `patients` di
`migrations/security_hardening_rls_patients.sql`).

**Kesimpulan:** bila akun pasien dibuat sekarang, pasien itu secara teknis bisa membaca, dan untuk
beberapa tabel mengubah, data seluruh pasien lewat kunci publik aplikasi. Portal pasien **tidak boleh**
diluncurkan sebelum Langkah A selesai.

---

## 2. Prinsip rancangan

1. **Akun pasien terpisah dari staf.** Pasien tidak pernah punya baris di tabel `users` (tabel itu
   khusus staf dan menjadi dasar semua cek peran).
2. **Tautan akun ↔ pasien di tabel sendiri** `patient_accounts (auth_user_id, patient_id)`, diisi
   hanya oleh server (service role) setelah verifikasi nomor WhatsApp.
3. **Pasien hanya membaca, tidak pernah menulis.**
4. **Pasien membaca lewat fungsi khusus (RPC), bukan tabel langsung.** Fungsi mengembalikan kolom yang
   aman saja. Kolom internal seperti komisi terapis, upah worker, catatan kasir, harga modal, dan
   audit tidak pernah ikut.
5. **Default tertutup.** Semua aturan tabel diubah dari "siapa pun yang login" menjadi "staf aktif".

---

## 3. Langkah A: Perketat aturan staf (WAJIB lebih dulu)

Fungsi bantu baru:

```sql
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = true)
$$;
```

Setiap aturan `USING (true)` / `WITH CHECK (true)` di §1 diganti `USING (public.is_staff())` /
`WITH CHECK (public.is_staff())`. Aturan cabang yang sudah ada (owner / `current_user_branch()`)
tidak diubah.

Dampak ke staf: **tidak ada**. Saat ini semua yang bisa login adalah staf aktif, jadi `is_staff()`
bernilai sama dengan `true` bagi mereka. Yang berubah hanya: akun yang bukan staf (calon pasien)
tidak lagi lolos.

Uji wajib sebelum produksi: jalankan di proyek staging, login sebagai owner, admin, dan terapis,
lalu buka kasir, transaksi, rekam medis, CRM, kupon, dan laporan. Hasilnya harus sama persis.

## 4. Langkah B: Akun & akses pasien

### 4.1 Tabel tautan
```sql
CREATE TABLE public.patient_accounts (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL REFERENCES public.patients(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;
-- Tanpa aturan apa pun untuk authenticated/anon: hanya service role yang bisa menulis/membaca.

CREATE OR REPLACE FUNCTION public.current_patient_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT patient_id FROM public.patient_accounts WHERE auth_user_id = auth.uid()
$$;
```

### 4.2 Fungsi baca untuk portal (SECURITY DEFINER, read-only)
- `portal_my_profile()`: nama, cabang, tanggal lahir.
- `portal_my_transactions()`: nomor nota, tanggal, cabang, total, metode bayar, daftar item
  (nama, qty, harga, diskon), **hanya `payment_status = 'paid'`**. Tanpa kasir, komisi, atau catatan internal.
- `portal_my_treatments()`: tanggal, treatment, cabang, nama terapis (opsional), rekomendasi.
  Catatan klinis internal (kontraindikasi, catatan SOAP) perlu diputuskan owner boleh tampil atau tidak.
- `portal_my_photos()`: daftar foto per sesi beserta **signed URL** berumur pendek (lihat §5).
- `portal_my_coupons()`: paket aktif dan sisa sesi.

Setiap fungsi diawali `IF public.current_patient_id() IS NULL THEN RAISE EXCEPTION ...` dan
memfilter `WHERE patient_id = public.current_patient_id()`. Pasien tidak mendapat aturan RLS pada
tabel mana pun.

### 4.3 Cara login
| Opsi | Kelebihan | Catatan |
|---|---|---|
| **OTP WhatsApp/SMS** (Supabase Phone Auth) | Pasien sudah punya nomor WA di data | Butuh penyedia pesan (mis. Twilio); ada biaya per OTP |
| Magic link email | Gratis | Banyak pasien belum punya email di data |
| Kode undangan dari klinik | Tanpa biaya pihak ketiga | Admin harus membuatkan kode; pasien lalu pasang kata sandi |

Penautan: nomor login dinormalkan dengan `normalizeIndonesianPhone` lalu dicocokkan dengan
`patients.whatsapp` oleh server. **Satu nomor bisa milik beberapa pasien** (misalnya keluarga).
Owner perlu memutuskan apakah akun ditautkan ke semua pasien bernomor itu atau dipilih manual oleh admin.

### 4.4 Pemisahan halaman
- Portal di rute terpisah, misalnya `/portal/*`, dengan layout sendiri (tanpa sidebar staf).
- `proxy.js` menolak sesi pasien yang membuka halaman staf, dan sebaliknya.
- `ClientLayout` dan `getCachedUser` saat ini mengasumsikan setiap sesi punya baris di `users`.
  Sesi pasien harus diarahkan ke `/portal` sebelum kode itu berjalan.

## 5. Foto before–after

- Ubah bucket `patient-photos` menjadi **privat**.
- Staf: halaman yang sekarang memakai `getPublicUrl` diganti `createSignedUrl` (berlaku misalnya
  1 jam). Perlu diubah di detail rekam medis, galeri pasien, laporan, dan halaman lain yang menampilkan foto.
- Pasien: signed URL hanya dibuat oleh `portal_my_photos()` untuk foto miliknya.
- Kebijakan storage: SELECT hanya untuk `is_staff()`. Pasien tidak membaca storage langsung.

Langkah ini juga menutup risiko tautan foto yang tersebar, walaupun portal belum dibuat.

## 6. Verifikasi sebelum mulai

Jalankan di Supabase SQL Editor (hanya membaca) untuk memastikan daftar aturan di §1 masih berlaku di database live:

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, cmd;
```

## 7. Urutan pengerjaan yang disarankan

1. Siapkan **proyek staging** (salinan skema) untuk menguji perubahan aturan tanpa menyentuh produksi.
2. Langkah A: `is_staff()` dan ganti semua aturan `true`. Uji semua peran staf di staging, lalu produksi.
3. Foto privat + signed URL untuk staf (§5). Uji galeri, rekam medis, dan laporan.
4. `patient_accounts`, `current_patient_id()`, dan fungsi `portal_my_*` (read-only). Uji dengan
   dua akun pasien uji: masing-masing hanya boleh melihat datanya sendiri, dan pemanggilan langsung
   ke tabel harus ditolak.
5. Halaman `/portal` dan alur login.
6. Peluncuran bertahap: satu cabang dulu.

Keputusan owner yang dibutuhkan: metode login (§4.3), penanganan satu nomor untuk banyak pasien,
kolom rekam medis yang boleh dilihat pasien, dan apakah nama terapis ditampilkan.
