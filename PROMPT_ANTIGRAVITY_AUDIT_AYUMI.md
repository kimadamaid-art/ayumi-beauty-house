# 🤖 PROMPT ANTIGRAVITY — AUDIT SISTEM AYUMI BEAUTY HOUSE

> **Fungsi dokumen ini:** kumpulan prompt siap salin-tempel untuk dijalankan di Antigravity, agar AI agent membaca codebase Anda dan mengisi sendiri sebagian besar jawaban di file `AUDIT_CHECKLIST_SISTEM_AYUMI.md`.
>
> **Cara pakai:** jalankan **satu prompt per sesi**, berurutan. Jangan gabung semuanya sekaligus — hasilnya akan dangkal dan agent cenderung melewatkan detail.

---

## ⚠️ ATURAN MAIN — BACA SEBELUM MULAI

Ini penting karena Antigravity bisa **mengubah file Anda**, bukan cuma membaca.

| Aturan | Alasan |
|:---|:---|
| **1. Prompt 1–6 bersifat READ-ONLY.** Kalau agent menawarkan mengubah file, tolak dulu. | Audit harus selesai lebih dulu sebelum perbaikan. Kalau perbaikan dicampur ke audit, Anda kehilangan gambaran utuh. |
| **2. Pastikan semua pekerjaan sudah di-`commit` ke Git sebelum mulai.** | Kalau ada yang salah, Anda bisa kembali ke kondisi semula. |
| **3. Untuk perbaikan (Prompt 7+), buat branch baru.** | Jangan sentuh branch `main` yang sedang dipakai kasir. |
| **4. JANGAN pernah tempel `service_role key` / password ke kolom chat.** | Isi chat bisa tersimpan di layanan pihak ketiga. Kalau agent butuh, cukup beri tahu **nama variabelnya**, bukan nilainya. |
| **5. Perubahan skema database jangan langsung dijalankan di produksi.** | Minta agent menulis file `.sql`, review dulu, baru jalankan manual di Supabase SQL Editor. |
| **6. Setiap output audit disimpan sebagai file `.md` di folder `docs/audit/`.** | Agar ada jejak dan bisa dibandingkan pada audit berikutnya. |

### Persiapan Awal

1. Buka project Ayumi di Antigravity.
2. Salin file `MASTER_PANDUAN_SISTEM_AYUMI.md` dan `AUDIT_CHECKLIST_SISTEM_AYUMI.md` ke dalam folder project (misal di `docs/`), supaya agent bisa membacanya sebagai konteks.
3. Buat folder kosong `docs/audit/`.
4. Jalankan **Query 7** dari lampiran checklist di Supabase SQL Editor, simpan hasilnya sebagai `docs/audit/00-daftar-tabel-live.md`. Ini penting — agent tidak bisa mengakses database Anda, jadi ia butuh gambaran skema dari Anda.

---

# 🔹 PROMPT 0 — Pemetaan Awal Codebase

> Jalankan ini pertama. Tujuannya membuat agent paham struktur project sebelum diminta menilai apa pun.

```
Kamu adalah senior software architect yang sedang melakukan audit teknis pada
sistem ERP klinik kecantikan multi-cabang bernama Ayumi Beauty House.

Stack: Next.js 16 + React 19 + Tailwind CSS v4, backend Supabase (PostgreSQL,
Auth, Storage). 4 cabang fisik: Banjar, Tasikmalaya, Pangandaran, Ciamis.

TUGAS KAMU SEKARANG HANYA MEMBACA DAN MEMETAKAN. JANGAN UBAH FILE APA PUN.

Lakukan:
1. Telusuri seluruh struktur folder project ini.
2. Identifikasi:
   - Di mana lokasi konfigurasi Supabase client
   - Daftar halaman/route utama beserta fungsinya
   - Di mana logika transaksi kasir berada
   - Di mana logika upload foto medis berada
   - Di mana logika laporan/reporting berada
   - Apakah ada folder migrations / SQL
   - Library pihak ketiga apa saja yang dipakai (dari package.json)
3. Catat setiap file yang berukuran tidak wajar (>500 baris) — ini kandidat
   masalah maintainability.

OUTPUT:
Tulis hasilnya ke file baru `docs/audit/01-peta-codebase.md` dengan format:
- Ringkasan struktur project (tree, maksimal 3 level)
- Tabel: Area Fungsional | File/Folder Terkait | Catatan
- Daftar dependency utama beserta versinya
- Daftar file >500 baris
- Bagian "Hal yang belum saya pahami" — sebutkan apa saja yang tidak bisa kamu
  simpulkan hanya dari kode, dan perlu saya konfirmasi

Gunakan Bahasa Indonesia. Jangan berspekulasi — kalau tidak menemukan sesuatu,
tulis "tidak ditemukan" dan jangan mengarang.
```

---

# 🔹 PROMPT 1 — Audit Keamanan (Prioritas Tertinggi)

> Ini menjawab **Bagian D** checklist. Jalankan setelah Prompt 0 selesai.

```
Lanjutkan audit sistem Ayumi Beauty House. Baca dulu `docs/audit/01-peta-codebase.md`
sebagai konteks.

TUGAS: AUDIT KEAMANAN. MODE READ-ONLY — JANGAN UBAH FILE APA PUN.

Periksa hal-hal berikut satu per satu, dan untuk setiap temuan sebutkan
nama file dan nomor barisnya:

A. KEBOCORAN KREDENSIAL
   1. Cari seluruh penggunaan environment variable Supabase. Pastikan yang
      dipakai di sisi client HANYA anon/publishable key.
   2. Cari apakah service_role key atau secret key pernah muncul di kode yang
      dieksekusi di browser. Ini temuan KRITIS kalau ada.
   3. Cek apakah ada variabel rahasia yang diberi prefix NEXT_PUBLIC_ —
      prefix itu membuatnya terekspos ke browser.
   4. Periksa .gitignore: apakah .env, .env.local sudah diabaikan?
   5. Cari hardcoded credential, API key, atau password di dalam kode.
      JANGAN tampilkan nilainya di output — cukup sebutkan lokasinya.

B. KETERGANTUNGAN PADA VALIDASI FRONTEND
   6. Identifikasi operasi yang keamanannya hanya bergantung pada logika
      frontend (misal: tombol disembunyikan berdasarkan role, tapi query-nya
      tidak dibatasi). Jelaskan kenapa itu tidak cukup.
   7. Cari query yang memfilter branch_id hanya dari sisi JavaScript, bukan
      mengandalkan RLS di database.

C. STORAGE FOTO MEDIS
   8. Temukan kode akses Supabase Storage. Apakah bucket-nya private?
   9. Berapa masa berlaku (expiry) Signed URL yang dipakai?
   10. Apakah ada URL foto yang disimpan permanen di database? Kalau ya,
       apakah itu public URL? Itu temuan serius.

D. OTENTIKASI & OTORISASI
   11. Bagaimana role user diperiksa? Di frontend saja atau juga di database?
   12. Apakah ada route/halaman yang tidak dilindungi middleware auth?
   13. Bagaimana penanganan session expired?

OUTPUT:
Tulis ke `docs/audit/02-audit-keamanan.md` dengan struktur:

## Ringkasan Eksekutif
(3-5 kalimat, bahasa awam, untuk pemilik bisnis non-teknis)

## Tabel Temuan
| No | Temuan | Tingkat (KRITIS/TINGGI/SEDANG/RENDAH) | Lokasi File:Baris | Dampak Bisnis | Rekomendasi |

## Detail Setiap Temuan KRITIS & TINGGI
(jelaskan skenario konkret bagaimana masalah ini bisa merugikan klinik)

## Yang Sudah Benar
(sebutkan juga praktik yang sudah bagus, jangan hanya kritik)

## Tidak Bisa Diverifikasi dari Kode
(hal yang butuh pengecekan langsung di Supabase Dashboard)

ATURAN PENTING:
- Jangan pernah menampilkan nilai kredensial apa pun di output.
- "Dampak Bisnis" harus ditulis dalam bahasa yang dimengerti pemilik klinik,
  bukan jargon teknis. Contoh yang baik: "staf cabang Banjar bisa melihat
  omset cabang Tasikmalaya".
- Kalau tidak menemukan masalah pada suatu poin, tulis eksplisit "aman" —
  jangan diam-diam dilewati.
```

---

# 🔹 PROMPT 2 — Audit Skema Database, Index & Integritas Data

> Menjawab **Bagian C dan E** checklist. Agent tidak bisa mengakses database Anda langsung, jadi siapkan dulu bahan dari Supabase.

**Persiapan:** jalankan Query 1, 3, 4, 5, 7 dan 8 dari lampiran checklist di Supabase SQL Editor, lalu salin hasilnya ke satu file `docs/audit/00-hasil-query-supabase.md`.

```
Lanjutkan audit sistem Ayumi Beauty House.

Baca file berikut sebagai bahan:
- `docs/audit/00-hasil-query-supabase.md` (hasil query langsung dari database live)
- `docs/MASTER_PANDUAN_SISTEM_AYUMI.md` (dokumentasi lama, kemungkinan sudah usang)
- Seluruh file .sql di project ini (kalau ada)

TUGAS: AUDIT SKEMA DATABASE & INTEGRITAS DATA. READ-ONLY.

Analisis:

A. KESENJANGAN DOKUMENTASI
   1. Dokumen master menyebut 18 tabel. Bandingkan dengan daftar tabel live.
      Buat tabel: tabel mana yang belum terdokumentasi, dan tebak fungsinya
      berdasarkan penggunaannya di kode.

B. MASALAH INTEGRITAS DATA YANG SUDAH DIKETAHUI
   2. Sudah teridentifikasi masalah: sebagian baris `transaction_items` punya
      item_type = 'treatment' tapi product_id DAN treatment_id sama-sama NULL,
      sehingga penjualan tidak terbaca laporan produk dan stok tidak terpotong.
      Telusuri di kode: bagaimana baris seperti itu bisa tercipta? Cari form
      kasir dan periksa apakah nama item masih bisa diketik manual, bukan
      dipilih dari katalog.
   3. Usulkan perbaikan berlapis:
      - Perbaikan di frontend (validasi input)
      - Perbaikan di database (CHECK constraint, gunakan NOT VALID agar data
        lama tidak menghambat)
      - Rencana pembersihan data lama yang terlanjur salah
   4. Cari pola serupa di tabel lain — kolom relasi yang boleh NULL padahal
      seharusnya wajib.

C. INDEX & PERFORMA
   5. Berdasarkan hasil Query 3 (FK tanpa index), buat daftar CREATE INDEX
      yang direkomendasikan, diurutkan dari yang paling berdampak.
   6. Baca semua kode query laporan. Untuk setiap laporan, identifikasi kolom
      apa yang dipakai untuk filter dan sorting, lalu usulkan index gabungan
      yang sesuai (misal: branch_id + tanggal).
   7. Proyeksikan: dengan pertumbuhan ~100.000 baris transaction_items per
      tahun, query mana yang akan pertama kali melambat, dan pada volume berapa?

D. TIPE DATA
   8. Periksa apakah ada kolom nilai uang yang bertipe float/double —
      ini menyebabkan selisih pembulatan rupiah. Seharusnya numeric.
   9. Periksa penanganan zona waktu pada kolom tanggal (WIB / UTC).

OUTPUT:
Tulis ke `docs/audit/03-audit-database.md`:

## Ringkasan Eksekutif (bahasa awam)
## Tabel Tidak Terdokumentasi
## Analisis Akar Masalah `transaction_items`
   - Bagaimana bisa terjadi (dengan referensi file:baris)
   - Resep perbaikan berlapis
## Rekomendasi Index (tabel: index | alasan | dampak perkiraan | prioritas)
## Risiko Performa Jangka Panjang
## Masalah Tipe Data

Sertakan juga file `docs/audit/03a-perbaikan-database.sql` berisi seluruh
DDL yang direkomendasikan, dengan komentar penjelasan di setiap perintah,
dan peringatan di bagian atas file bahwa ini HARUS di-review manual dan
dijalankan di staging dulu, bukan langsung di produksi.

Gunakan Bahasa Indonesia. Jangan mengarang nama kolom — kalau tidak yakin,
tulis placeholder dan tandai dengan komentar TODO.
```

---

# 🔹 PROMPT 3 — Audit Storage Foto Medis & Efisiensi Biaya

> Menjawab **Bagian F** checklist. Ini prompt dengan potensi penghematan biaya terbesar.

```
Lanjutkan audit sistem Ayumi Beauty House.

KONTEKS BISNIS:
Klinik ini menyimpan foto before/after pasien di Supabase Storage. Estimasi
30.000 treatment per tahun × 4 foto. Tanpa kompresi (foto ~4MB dari kamera HP),
itu ~480 GB per tahun — sekitar 2,4 TB dalam 5 tahun. Dengan kompresi yang
tepat (~300KB per foto), angkanya turun jadi ~36 GB per tahun. Selisihnya
13 kali lipat, dan itu belum termasuk biaya bandwidth setiap foto dibuka.

TUGAS: AUDIT PIPELINE FOTO MEDIS. READ-ONLY.

Periksa:
1. Temukan seluruh kode upload gambar. Telusuri alurnya dari input file
   sampai tersimpan di Storage.
2. Apakah ada kompresi atau resize sebelum upload? Kalau ada, berapa
   parameternya (dimensi maksimal, kualitas, format)?
3. Format apa yang disimpan — JPEG, PNG, atau WebP?
4. Apakah ada pembuatan thumbnail terpisah untuk tampilan daftar?
5. Apakah halaman daftar rekam medis memuat foto ukuran penuh? Kalau ya,
   hitung: berapa MB yang diunduh iPad kasir saat membuka satu halaman daftar?
6. Apakah ada batas ukuran file yang divalidasi sebelum upload?
7. Bagaimana penanganan kalau upload gagal di tengah — apakah ada file
   yatim yang tertinggal di Storage tanpa referensi di database?
8. Apakah foto lama pernah dibersihkan/diarsipkan, atau menumpuk selamanya?

OUTPUT:
Tulis ke `docs/audit/04-audit-storage.md`:

## Ringkasan Eksekutif
## Alur Upload Saat Ini (diagram alur sederhana dalam teks)
## Temuan
| No | Temuan | Lokasi | Dampak Biaya | Rekomendasi |
## Simulasi Penghematan
   Buat tabel perbandingan biaya 1/3/5 tahun antara kondisi sekarang vs
   setelah optimasi. Gunakan asumsi volume di atas dan sebutkan asumsinya
   secara eksplisit.
## Rencana Implementasi Kompresi
   Tulis rekomendasi teknis konkret: library apa, di titik mana dalam kode,
   parameter apa (target: sisi terpanjang 1600px, WebP kualitas 80).
   Sertakan contoh kode, TAPI JANGAN LANGSUNG TERAPKAN KE FILE.
## Catatan Kualitas Medis
   Beri catatan jujur: pada parameter yang direkomendasikan, detail klinis
   apa yang mungkin hilang? Apakah ada jenis foto yang sebaiknya dikecualikan
   dari kompresi agresif?

Gunakan Bahasa Indonesia. Sebutkan asumsi biaya secara eksplisit dan tandai
bahwa harga Supabase bisa berubah — angka ini estimasi, bukan kepastian.
```

---

# 🔹 PROMPT 4 — Audit Atomisitas Transaksi Kasir

> Menjawab **Bagian G** checklist. Ini memverifikasi apakah janji "all-or-nothing" di dokumen master benar-benar terpenuhi.

```
Lanjutkan audit sistem Ayumi Beauty House.

KONTEKS:
Dokumentasi sistem (Bab 5) mengklaim proses transaksi kasir bersifat atomis
(all-or-nothing): kalau ada satu langkah gagal, semuanya dibatalkan, sehingga
tidak ada nota tanpa potong stok atau sebaliknya. Tugasmu memverifikasi
apakah klaim ini benar-benar diterapkan di kode.

TUGAS: AUDIT ATOMISITAS & KONSISTENSI TRANSAKSI. READ-ONLY.

Periksa:
1. Temukan seluruh alur proses pembayaran kasir, dari klik tombol Bayar
   sampai struk tercetak.
2. Berapa kali aplikasi memanggil database dalam satu transaksi? Apakah
   satu panggilan RPC, atau beberapa INSERT/UPDATE terpisah?
3. KRITIS: kalau proses potong stok gagal SETELAH nota tersimpan, apa yang
   terjadi? Telusuri jalur error-nya secara spesifik.
4. Bagaimana nomor nota digenerate? Cari pola SELECT MAX()+1 — kalau ada,
   itu berisiko nomor nota kembar saat dua kasir bertransaksi bersamaan.
5. Apakah ada proteksi double-submit (tombol terkunci, flag loading,
   idempotency key)? Apa yang terjadi kalau kasir klik Bayar dua kali cepat?
6. Bagaimana penanganan koneksi internet putus di tengah proses?
7. Apakah pemakaian kupon (pengurangan sisa sesi) berada dalam transaksi
   yang sama dengan pencatatan pembayaran?
8. Apakah perhitungan diskon dan total dilakukan di frontend atau di database?
   Kalau di frontend, itu berarti angkanya bisa dimanipulasi.

OUTPUT:
Tulis ke `docs/audit/05-audit-transaksi.md`:

## Ringkasan Eksekutif
## Alur Transaksi Saat Ini
   (tulis sebagai langkah bernomor, sebutkan file:baris di setiap langkah)
## Verifikasi Klaim Dokumentasi
| Klaim di Dokumen | Status (TERBUKTI/SEBAGIAN/TIDAK TERBUKTI) | Bukti |
## Skenario Kegagalan
   Untuk setiap titik yang bisa gagal, jelaskan: apa yang terjadi pada data,
   dan bagaimana pemilik klinik akan menyadarinya (atau tidak menyadarinya).
   Ini bagian terpenting — tulis se-konkret mungkin.
## Rekomendasi Perbaikan (diurutkan berdasarkan risiko finansial)

Gunakan Bahasa Indonesia. Untuk setiap skenario kegagalan, sebutkan dampak
rupiahnya kalau memungkinkan.
```

---

# 🔹 PROMPT 5 — Audit Performa Jangka Panjang

> Menjawab sisa **Bagian E** checklist — khususnya jebakan "laporan dihitung di browser".

```
Lanjutkan audit sistem Ayumi Beauty House.

KONTEKS PERTUMBUHAN DATA (4 cabang):
- patients: ~4.000/tahun → ~40.000 dalam 10 tahun
- transactions: ~40.000/tahun → ~400.000
- transaction_items: ~100.000/tahun → ~1.000.000
- treatment_records: ~30.000/tahun → ~300.000

Perangkat yang dipakai staf: iPad dan HP, bukan komputer kencang.
Sistem saat ini terasa cepat KARENA datanya masih sedikit. Tugasmu adalah
memprediksi apa yang akan rusak duluan seiring pertumbuhan.

TUGAS: AUDIT PERFORMA & SKALABILITAS. READ-ONLY.

Periksa:
1. JEBAKAN UTAMA: cari query yang mengambil seluruh data lalu diproses di
   browser (pola .select('*') tanpa filter, lalu perhitungan pakai
   reduce/filter/map di JavaScript). Ini akan membuat iPad kasir hang
   sekitar tahun ke-3. Untuk setiap temuan, perkirakan pada jumlah baris
   berapa halaman itu akan mulai bermasalah.
2. Apakah daftar pasien, transaksi, dan rekam medis pakai pagination?
   Atau memuat semuanya sekaligus?
3. Apakah laporan (omset, treatment, terapis) dihitung di database
   (SQL/View/RPC) atau di frontend?
4. Cari pola N+1 query — perulangan yang memanggil database di dalamnya.
5. Apakah ada query tanpa batas rentang tanggal? Query "seluruh riwayat"
   akan makin lambat setiap bulan.
6. Berapa ukuran bundle JavaScript halaman kasir? Apakah ada library berat
   yang bisa di-lazy-load?
7. Apakah ada mekanisme caching untuk data yang jarang berubah
   (daftar produk, daftar treatment, daftar cabang)?

OUTPUT:
Tulis ke `docs/audit/06-audit-performa.md`:

## Ringkasan Eksekutif
## Tabel Prediksi Kegagalan
| Halaman/Fitur | Masalah | Lokasi File | Perkiraan Kapan Bermasalah | Prioritas |
   Kolom "Perkiraan Kapan Bermasalah" diisi estimasi tahun ke berapa,
   berdasarkan proyeksi volume di atas. Sebutkan dasar perhitungannya.
## Detail Setiap Temuan Prioritas Tinggi
## Rekomendasi (dipisah: perbaikan cepat vs perombakan besar)

Gunakan Bahasa Indonesia. Jujur soal ketidakpastian estimasi — tandai mana
yang perkiraan kasar dan mana yang bisa dihitung dengan yakin.
```

---

# 🔹 PROMPT 6 — Perbarui Dokumentasi Sistem

> Menjawab **Bagian I** checklist. Dokumen master menyebut 18 tabel, sistem live punya ~25 tabel + 2 view.

```
Lanjutkan pekerjaan pada project Ayumi Beauty House.

TUGAS: MEMPERBARUI DOKUMENTASI SISTEM.

Bahan:
- `docs/MASTER_PANDUAN_SISTEM_AYUMI.md` (dokumen lama, menyebut 18 tabel)
- `docs/audit/00-hasil-query-supabase.md` (kondisi database live sebenarnya)
- Seluruh file audit di `docs/audit/`
- Codebase project ini

Buat dokumen master versi baru yang akurat, dengan ketentuan:

1. Pertahankan gaya dokumen lama: visual, banyak diagram Mermaid, analogi
   dunia nyata klinik (kasir, terapis, stok, rekam medis), Bahasa Indonesia,
   ramah untuk pembaca non-teknis.
2. Perbarui jumlah dan daftar tabel sesuai kondisi live yang sebenarnya.
3. Perbarui ERD Mermaid agar mencakup SEMUA tabel dan view, bukan hanya 18.
4. Untuk setiap tabel baru yang belum ada di dokumen lama, tulis:
   - Fungsinya dalam bahasa awam (analogi "lemari data")
   - Relasinya ke tabel lain
   - Kolom-kolom pentingnya
5. Perbarui daftar versi dependency sesuai package.json yang sebenarnya.
6. Tambahkan bab baru: "Riwayat Perubahan Sistem" dengan tanggal audit ini.
7. Tandai dengan jelas bagian mana yang merupakan KLAIM yang belum
   terverifikasi versus FAKTA yang sudah diverifikasi dari kode/database.
   Ini penting — dokumen lama mencampur keduanya tanpa pembeda.

OUTPUT:
File baru `docs/MASTER_PANDUAN_SISTEM_AYUMI_v2.md`.
JANGAN timpa file lama — biarkan sebagai arsip.

Di akhir dokumen, tambahkan bagian "Yang Masih Perlu Dikonfirmasi" berisi
daftar hal yang tidak bisa kamu pastikan sendiri.

Gunakan Bahasa Indonesia.
```

---

# 🔹 PROMPT 7 — Eksekusi Perbaikan (Hati-hati)

> ⚠️ **Baru jalankan setelah Prompt 1–6 selesai dan Anda sudah membaca semua hasilnya.** Ini satu-satunya prompt yang mengubah kode.

**Sebelum menjalankan:**
```bash
git checkout -b audit/perbaikan-prioritas
```

```
Sekarang kita mulai memperbaiki, bukan lagi mengaudit.

Baca seluruh file di `docs/audit/` untuk konteks.

TUGAS: implementasi perbaikan untuk temuan berikut saja:
[ISI DI SINI — sebutkan 1-3 temuan spesifik dari hasil audit, jangan lebih.
Contoh: "Temuan #3 di 04-audit-storage.md — kompresi gambar sebelum upload"]

ATURAN KERJA:
1. Kerjakan SATU temuan sampai tuntas sebelum pindah ke berikutnya.
   Setelah selesai satu, berhenti dan tunggu saya review.
2. Sebelum mengubah file apa pun, jelaskan dulu:
   - File apa saja yang akan diubah
   - Apa risiko perubahan ini
   - Bagaimana cara saya menguji bahwa perbaikannya berhasil
   Tunggu persetujuan saya sebelum mulai mengedit.
3. Untuk perubahan skema database: JANGAN eksekusi apa pun. Tulis file .sql
   terpisah di `docs/audit/`, saya yang akan menjalankan manual setelah review.
4. Jangan melakukan refactoring di luar cakupan yang saya sebutkan, sekecil
   apa pun godaannya.
5. Jangan mengubah logika perhitungan uang tanpa konfirmasi eksplisit dari saya.
6. Setelah selesai, tulis ringkasan perubahan dan langkah pengujian manual
   yang harus saya lakukan sebelum ini boleh naik ke produksi.

Gunakan Bahasa Indonesia untuk semua penjelasan. Komentar di dalam kode
boleh Bahasa Inggris.
```

---

# 📋 URUTAN & PERKIRAAN WAKTU

| Urutan | Prompt | Menjawab Bagian | Perkiraan Durasi |
|:---:|:---|:---|:---|
| 1 | Prompt 0 — Peta Codebase | (persiapan) | 10–15 menit |
| 2 | Prompt 1 — Keamanan | D | 20–30 menit |
| 3 | Prompt 2 — Database | C, E | 30–40 menit |
| 4 | Prompt 3 — Storage | F | 20–30 menit |
| 5 | Prompt 4 — Transaksi | G | 20–30 menit |
| 6 | Prompt 5 — Performa | E | 20–30 menit |
| 7 | Prompt 6 — Dokumentasi | I | 30–45 menit |
| 8 | Prompt 7 — Perbaikan | (tindak lanjut) | bervariasi |

**Total audit (tanpa perbaikan): sekitar 3 jam.** Sebaiknya dipecah jadi 2–3 sesi, bukan sekali duduk — Anda perlu waktu membaca hasil setiap tahap.

---

# ⚠️ YANG TIDAK BISA DIJAWAB ANTIGRAVITY

Agent hanya membaca kode. Item checklist berikut **tetap harus Anda tanyakan langsung ke developer atau cek sendiri di dashboard**:

| Bagian Checklist | Kenapa Tidak Bisa Diotomatiskan |
|:---|:---|
| **A — Kepemilikan & Akses** | Ini soal akun dan orang, bukan kode. **Ini bagian paling penting dan sepenuhnya tugas Anda.** |
| **B — Backup & Pemulihan** | Perlu cek Supabase Dashboard → Settings → Backups |
| **D1, D2 (status RLS)** | Perlu jalankan Query 1 & 2 di SQL Editor |
| **F4, F5 (biaya aktual)** | Perlu cek Supabase Dashboard → Usage & Billing |
| **H — Kepatuhan Regulasi** | Perlu konsultan hukum, bukan AI |
| **I6 (kontrak pemeliharaan)** | Kesepakatan bisnis dengan developer |

> 💡 **Satu hal yang perlu diingat:** AI agent bisa salah membaca kode dan bisa mengarang temuan yang sebenarnya tidak ada. Perlakukan hasilnya sebagai **draf temuan yang perlu diverifikasi**, bukan sebagai kesimpulan final. Setiap temuan KRITIS sebaiknya Anda konfirmasi ke developer sebelum diambil tindakan.

---

## ✅ Setelah Semua Selesai

1. Buka kembali `AUDIT_CHECKLIST_SISTEM_AYUMI.md` dan isi kolom status berdasarkan hasil audit.
2. Isi lembar ringkasan dan pilih **3 tindakan prioritas**.
3. Jadwalkan meeting dengan developer membawa file hasil audit, bukan sekadar bertanya lisan — dokumen tertulis membuat diskusi jauh lebih produktif.
4. Simpan seluruh folder `docs/audit/` sebagai arsip. **Audit berikutnya: 6 bulan lagi**, agar Anda bisa melihat tren perbaikan.
