# 🔍 CHECKLIST AUDIT SISTEM — AYUMI BEAUTY HOUSE

> **Tujuan dokumen ini:** memberi Anda daftar pertanyaan konkret untuk diajukan ke developer, lengkap dengan **jawaban yang seharusnya** dan **tanda bahaya** — supaya Anda bisa menilai sendiri tanpa harus paham kodenya.

**Tanggal audit:** `______________`
**Diaudit oleh:** `______________`
**Versi sistem / commit:** `______________`

---

## 📌 Cara Menggunakan

1. Bawa dokumen ini ke sesi meeting dengan developer.
2. Untuk setiap item, tanyakan pertanyaannya, lalu catat jawabannya di kolom **Catatan**.
3. Bandingkan jawaban dengan kolom **Jawaban Ideal**. Kalau jawaban mendekati kolom **🚨 Tanda Bahaya**, itu perlu tindakan.
4. Bagian **Lampiran SQL** bisa Anda jalankan sendiri di Supabase → SQL Editor (semua query bersifat *read-only*, aman, tidak mengubah data).

### Skala Prioritas

| Kode | Arti | Batas Waktu |
|:---|:---|:---|
| 🔴 **P0** | Kritis — risiko kehilangan data atau kehilangan kendali bisnis | Minggu ini |
| 🟠 **P1** | Penting — akan jadi mahal/sulit kalau ditunda | 1–3 bulan |
| 🟡 **P2** | Optimasi — pemeliharaan jangka panjang | 6 bulan |

---

# BAGIAN A — 🔴 KEPEMILIKAN & AKSES (P0)

> Ini bagian paling penting dan paling sering diabaikan. Tidak ada hubungannya dengan teknologi — ini soal siapa yang memegang kunci aset digital Anda.

| # | Pertanyaan ke Developer | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| A1 | Akun Supabase ini terdaftar atas email siapa? | Email milik Anda / email perusahaan | Email pribadi developer |
| A2 | Siapa yang berstatus **Owner** di Supabase Organization? | Anda | Developer, atau Anda hanya "Member"/"Developer" |
| A3 | Source code disimpan di mana? Apakah saya punya akses? | GitHub/GitLab, repo milik akun Anda, Anda punya akses admin | Di laptop developer saja, atau repo pribadi developer |
| A4 | Akun Vercel (hosting) atas nama siapa? | Anda / perusahaan | Developer |
| A5 | Domain `ayumibeautyhouse.com` didaftarkan atas nama siapa? | Anda / perusahaan | Developer atau pihak ketiga |
| A6 | Kalau developer berhenti besok, apa saja yang harus diserahkan? | Ada daftar tertulis kredensial + dokumen serah terima | "Nanti kita urus" |
| A7 | Di mana semua password/API key disimpan? | Password manager bersama (Bitwarden/1Password) | WhatsApp, catatan HP, file `.txt` |

**Tindakan minimal:** Buat satu dokumen berisi seluruh daftar akses (Supabase, GitHub, Vercel, domain, email) dan pastikan **Anda tercatat sebagai Owner di semuanya**. Developer cukup diberi status Admin/Collaborator, bukan Owner.

```
Catatan hasil audit Bagian A:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN B — 🔴 BACKUP & PEMULIHAN BENCANA (P0)

> Dokumen master Anda saat ini menyebut *"unduh backup manual 1× seminggu"*. Itu terlalu rapuh untuk data rekam medis.

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| B1 | Supabase kita pakai tier apa? | Pro atau lebih tinggi | Free tier |
| B2 | Apakah **automated daily backup** aktif? | Ya, aktif | "Kita backup manual saja" |
| B3 | Apakah **Point-in-Time Recovery (PITR)** aktif? | Ya | Tidak tahu / tidak aktif |
| B4 | Apakah ada backup yang disimpan **di luar Supabase**? | Ya, `pg_dump` terjadwal ke Google Drive / storage lain | Tidak ada |
| B5 | Kapan terakhir kali backup **diuji restore**? | Ada catatan tanggal uji restore | Belum pernah diuji |
| B6 | Kalau database terhapus total jam 14:00, berapa lama sampai sistem jalan lagi? | Ada angka konkret (misal: 2 jam) | "Belum pernah kepikiran" |
| B7 | Foto medis di Storage ikut ter-backup? | Ya, ada mekanisme terpisah | Tidak — ini sangat umum terlewat |

> ⚠️ **Poin B5 adalah yang paling sering gagal.** Backup yang tidak pernah diuji restore = backup yang tidak bisa dipercaya. Jadwalkan uji restore ke database kosong **minimal 1× setahun**.

> ⚠️ **Poin B7 juga sering luput.** Backup database TIDAK menyertakan file di Supabase Storage. Foto *before/after* pasien butuh strategi backup sendiri.

```
Catatan hasil audit Bagian B:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN C — 🔴 INTEGRITAS & KUALITAS DATA (P0)

> Anda sudah menemukan satu masalah nyata: baris `transaction_items` dengan `item_type = 'treatment'` tapi `product_id` **dan** `treatment_id` sama-sama NULL. Artinya penjualan itu tidak terbaca laporan produk dan stok tidak terpotong.

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| C1 | Apakah kasir masih bisa **mengetik manual** nama item, atau wajib pilih dari katalog? | Wajib pilih dari katalog (dropdown/search) | Masih bisa ketik bebas |
| C2 | Adakah `CHECK constraint` yang mencegah baris "yatim" seperti itu? | Ada | Tidak ada — hanya divalidasi di frontend |
| C3 | Berapa banyak baris bermasalah yang sudah terlanjur ada? | Ada angka pasti (jalankan Query 5 di lampiran) | Tidak tahu |
| C4 | Apakah semua Foreign Key benar-benar dideklarasikan di database? | Ya | "Relasi diatur di kode aplikasi saja" |
| C5 | Apakah ada kolom uang yang bertipe `float`/`double`? | Tidak — harus `numeric` / `bigint` | Ada `float` → risiko selisih pembulatan rupiah |
| C6 | Apakah stok produk bisa jadi minus? | Tidak, dicegah constraint `stock >= 0` | Bisa minus |
| C7 | Kalau transaksi dihapus, apa yang terjadi ke `transaction_items`? | `ON DELETE CASCADE` atau dilarang hapus sama sekali | Baris anak jadi yatim |

### 💊 Resep Perbaikan untuk C2

Minta developer menambahkan constraint berikut. Perhatikan `NOT VALID` — artinya constraint hanya berlaku untuk baris **baru**, sehingga data lama yang terlanjur salah tidak menghambat, tapi kesalahan tidak akan bertambah lagi:

```sql
ALTER TABLE transaction_items
ADD CONSTRAINT chk_item_reference CHECK (
     (item_type = 'product'   AND product_id   IS NOT NULL)
  OR (item_type = 'treatment' AND treatment_id IS NOT NULL)
  OR (item_type = 'coupon'    AND coupon_package_id IS NOT NULL)
) NOT VALID;
```

*(Sesuaikan nama kolom `coupon_package_id` dengan skema asli Anda.)*

> **Kenapa ini mendesak?** Volume `transaction_items` Anda tumbuh ~100.000 baris/tahun. Setelah 2–3 tahun, baris bermasalah tidak bisa lagi diperbaiki — tidak ada yang ingat item mana merujuk produk mana. **Perbaiki sekarang, bukan nanti.**

```
Catatan hasil audit Bagian C:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN D — 🟠 KEAMANAN (P0/P1)

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| D1 | Apakah **SEMUA** tabel di schema `public` sudah `ENABLE ROW LEVEL SECURITY`? | Ya, 100% (jalankan Query 1) | Ada tabel tanpa RLS |
| D2 | Apakah setiap tabel ber-RLS punya minimal 1 policy? | Ya (jalankan Query 2) | RLS aktif tapi 0 policy = tabel terkunci total, atau sebaliknya |
| D3 | Apakah `service_role key` pernah dipakai di sisi frontend/browser? | **Tidak pernah** | Ada → siapa pun bisa baca seluruh database |
| D4 | Kunci apa yang dipakai di `lib/supabaseClient.js`? | Hanya `anon` / `publishable` key | `service_role` / `secret` key |
| D5 | Apakah ada file `.env` yang ikut ter-*commit* ke Git? | Tidak, ada di `.gitignore` | Ada |
| D6 | Bucket foto medis benar-benar **Private**? | Ya, akses via Signed URL saja | Public bucket |
| D7 | Berapa lama masa berlaku Signed URL foto? | ≤ 1 jam | Berhari-hari / tidak dibatasi |
| D8 | Apakah policy Storage juga membatasi per cabang? | Ya | Semua staf bisa akses foto semua cabang |
| D9 | Apakah ada audit log siapa mengubah/menghapus apa? | Ada tabel `audit_log` atau sejenisnya | Tidak ada jejak |
| D10 | Bagaimana penanganan staf resign — akunnya diapakan? | Dinonaktifkan (bukan dihapus, agar riwayat utuh) | Dibiarkan aktif |

> ⚠️ **D3 dan D4 adalah pemeriksaan terpenting di bagian ini.** `service_role key` melewati seluruh RLS. Kalau kunci itu pernah masuk ke kode frontend, seluruh perlindungan cabang di Bab 6 dokumen master Anda praktis tidak berfungsi.

```
Catatan hasil audit Bagian D:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN E — 🟠 PERFORMA & INDEX (P1)

> Kabar baik: puluhan ribu pasien **bukan** skala yang menakutkan untuk PostgreSQL. Tapi itu hanya berlaku kalau index-nya benar.

### Proyeksi Volume Data 10 Tahun (4 cabang)

| Tabel | Per Tahun | 10 Tahun |
|:---|---:|---:|
| `patients` | ~4.000 | ~40.000 |
| `transactions` | ~40.000 | ~400.000 |
| `transaction_items` | ~100.000 | ~1.000.000 |
| `treatment_records` | ~30.000 | ~300.000 |
| **Total kasar** | | **~2 juta baris** |

PostgreSQL rutin menangani ratusan juta baris. **2 juta baris itu kecil** — selama ada index.

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| E1 | Apakah semua Foreign Key sudah punya index? | Ya (jalankan Query 3) | Ada FK tanpa index |
| E2 | Apakah kolom tanggal (`created_at`, `transaction_date`) punya index? | Ya | Tidak → laporan bulanan akan melambat |
| E3 | Adakah index gabungan `(branch_id, tanggal)` untuk laporan per cabang? | Ada | Tidak ada |
| E4 | Berapa lama laporan bulanan diproses saat ini? | < 2 detik | > 5 detik → akan makin parah |
| E5 | Apakah laporan mengambil semua data lalu dihitung di browser? | Tidak — dihitung di database (SQL/RPC/View) | Ya → akan crash di HP kasir saat data besar |
| E6 | Apakah daftar pasien/transaksi pakai pagination? | Ya | Load semua sekaligus |
| E7 | Rencana untuk data > 5 tahun? | Ada rencana arsip/partisi | Belum dipikirkan |

> 💡 **E5 adalah jebakan paling umum.** Aplikasi terasa cepat sekarang karena datanya masih sedikit. Kalau perhitungan laporan dilakukan di browser, aplikasi akan berhenti berfungsi di iPad kasir sekitar tahun ke-3 — dan penyebabnya akan sulit didiagnosis.

```
Catatan hasil audit Bagian E:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN F — 🟠 STORAGE FOTO MEDIS & BIAYA (P1)

> **Ini bottleneck sesungguhnya, bukan jumlah pasien.**

### Simulasi Biaya

| Skenario | Ukuran/Foto | 30.000 treatment × 4 foto | Per Tahun | 5 Tahun |
|:---|---:|---:|---:|---:|
| **Tanpa kompresi** | ~4 MB | 120.000 foto | **~480 GB** | **~2,4 TB** |
| **Dengan kompresi** | ~300 KB | 120.000 foto | **~36 GB** | **~180 GB** |

**Penghematan: 13×.** Belum termasuk biaya *bandwidth* — setiap kali foto dibuka lewat Signed URL, itu dihitung transfer keluar dan sering jadi kejutan tagihan tersendiri.

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| F1 | Apakah foto dikompresi **sebelum** diupload? | Ya, di sisi client | Upload mentah dari kamera |
| F2 | Resolusi maksimal setelah kompresi? | ~1600px sisi terpanjang | Resolusi asli kamera |
| F3 | Format yang disimpan? | WebP (kualitas ~80) | JPEG mentah / PNG |
| F4 | Berapa GB Storage terpakai saat ini? | Ada angka (cek dashboard Supabase) | Tidak tahu |
| F5 | Berapa tagihan Supabase bulan lalu, dan tren 6 bulan? | Ada catatan | Tidak dipantau |
| F6 | Ada thumbnail terpisah untuk tampilan daftar? | Ya | Memuat foto full-size di daftar |

> 🎯 **Rekomendasi berdampak tertinggi di seluruh audit ini:** aktifkan kompresi client-side (resize 1600px + WebP q80). Satu perubahan kode, hemat belasan kali lipat biaya storage selama umur sistem, tanpa kehilangan detail klinis yang berarti.

```
Catatan hasil audit Bagian F:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN G — 🟠 ATOMISITAS TRANSAKSI (P1)

> Bab 5 dokumen master Anda menjanjikan alur *All-or-Nothing*. Bagian ini memverifikasi janji itu benar-benar diterapkan.

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| G1 | Apakah proses bayar dijalankan dalam **satu** fungsi RPC/PostgreSQL? | Ya, satu `FUNCTION` | Beberapa `INSERT` terpisah dari frontend |
| G2 | Kalau potong stok gagal di tengah, apakah nota ikut batal? | Ya, rollback penuh | Nota tersimpan tapi stok tidak terpotong |
| G3 | Bagaimana nomor nota digenerate? | `FOR UPDATE` lock atau `SEQUENCE` | `SELECT MAX(...)+1` → berisiko nomor kembar |
| G4 | Apa yang terjadi kalau kasir klik "Bayar" dua kali cepat? | Ada proteksi idempotensi / tombol terkunci | Nota ganda |
| G5 | Kalau internet putus saat submit, apa yang terjadi? | Tidak ada data separuh jadi | Data separuh tersimpan |
| G6 | Apakah pemakaian kupon dan pemotongan sesi juga atomis? | Ya | Terpisah → sesi bisa terpotong tanpa transaksi |

> 💡 **Cara menguji G4 tanpa developer:** di jam sepi, lakukan transaksi uji dan klik "Bayar" dua kali secepat mungkin. Kalau muncul dua nota, itu bug yang perlu segera diperbaiki. Jangan lupa hapus data uji setelahnya.

```
Catatan hasil audit Bagian G:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN H — 🟠 KEPATUHAN REGULASI (P1)

> ⚖️ **Catatan penting:** saya bukan ahli hukum, dan aturan bisa berubah. Bagian ini adalah daftar hal yang perlu dikonfirmasi ke konsultan hukum kesehatan atau konsultan kepatuhan — bukan nasihat hukum.

Dua kerangka regulasi yang relevan untuk klinik yang menyimpan rekam medis elektronik di Indonesia:

- **Ketentuan Kemenkes tentang Rekam Medis Elektronik** — mencakup kewajiban masa simpan minimal, keamanan akses, dan jejak audit.
- **UU No. 27/2022 tentang Pelindungan Data Pribadi (UU PDP)** — data kesehatan tergolong **data pribadi bersifat spesifik**, dengan kewajiban yang lebih ketat dibanding data biasa.

| # | Hal yang Perlu Dikonfirmasi | Kenapa Relevan |
|:--|:---|:---|
| H1 | Berapa lama rekam medis wajib disimpan? Apakah sistem mendukung? | Menentukan strategi arsip data lama |
| H2 | Di negara mana server Supabase kita berada? | UU PDP mengatur transfer data ke luar negeri |
| H3 | Adakah formulir persetujuan (*informed consent*) pasien untuk foto *before/after*? | Foto adalah data pribadi spesifik |
| H4 | Apakah ada mekanisme kalau pasien minta datanya dihapus? | UU PDP memberi hak tersebut kepada subjek data |
| H5 | Adakah jejak audit siapa membuka rekam medis siapa? | Umumnya diwajibkan untuk RME |
| H6 | Adakah prosedur kalau terjadi kebocoran data? | UU PDP mengatur kewajiban notifikasi |

> Karena Anda merancang sistem untuk jangka panjang, jauh lebih murah memikirkan ini sekarang daripada setelah punya 50.000 rekam medis.

```
Catatan hasil audit Bagian H:
_________________________________________________________________
_________________________________________________________________
```

---

# BAGIAN I — 🟡 DOKUMENTASI & PEMELIHARAAN (P2)

| # | Pertanyaan | ✅ Jawaban Ideal | 🚨 Tanda Bahaya |
|:--|:---|:---|:---|
| I1 | Dokumen master menyebut **18 tabel**, database live punya **~25 tabel + 2 view**. Mana yang benar? | Dokumen diperbarui sesuai kondisi live | Dibiarkan tidak sinkron |
| I2 | Apakah perubahan skema dicatat sebagai file migrasi? | Ya, ada folder `migrations/` | Diubah manual lewat dashboard |
| I3 | Ada environment terpisah untuk uji coba? | Ada staging/development | Ngoding langsung di database produksi |
| I4 | Bagaimana rencana upgrade Next.js? | Ada jadwal berkala | "Nanti kalau rusak baru diurus" |
| I5 | Apakah ada monitoring error otomatis? | Ada (Sentry / Vercel Logs) | Baru tahu error kalau kasir telepon |
| I6 | Berapa jam/bulan dialokasikan untuk pemeliharaan? | Ada angka & kontrak jelas | Tidak ada — model "sekali bangun lalu lupa" |

> 💡 **I1 adalah gejala klasik:** dokumentasi dibuat sekali lalu ditinggalkan. Kalau developer berhenti dan dokumentasi meleset 40%, penggantinya harus membongkar sistem dari nol — dan Anda yang membayar waktu itu.

> 💡 **I4 — siklus Next.js:** rilis mayor hampir setiap tahun dengan perubahan yang tidak selalu mulus. Aplikasi bisnis yang dibiarkan 3–4 tahun tanpa upgrade akan sulit dan mahal dimigrasi.

```
Catatan hasil audit Bagian I:
_________________________________________________________________
_________________________________________________________________
```

---

# 📊 LEMBAR RINGKASAN HASIL AUDIT

| Bagian | Prioritas | Total Item | ✅ Aman | ⚠️ Perlu Perbaikan | 🚨 Kritis |
|:---|:---:|---:|---:|---:|---:|
| A — Kepemilikan & Akses | 🔴 P0 | 7 | | | |
| B — Backup & Pemulihan | 🔴 P0 | 7 | | | |
| C — Integritas Data | 🔴 P0 | 7 | | | |
| D — Keamanan | 🟠 P0/P1 | 10 | | | |
| E — Performa & Index | 🟠 P1 | 7 | | | |
| F — Storage & Biaya | 🟠 P1 | 6 | | | |
| G — Atomisitas | 🟠 P1 | 6 | | | |
| H — Kepatuhan | 🟠 P1 | 6 | | | |
| I — Dokumentasi | 🟡 P2 | 6 | | | |
| **TOTAL** | | **62** | | | |

### 3 Tindakan Prioritas Hasil Audit

1. `_______________________________________________` — PIC: `________` — Target: `________`
2. `_______________________________________________` — PIC: `________` — Target: `________`
3. `_______________________________________________` — PIC: `________` — Target: `________`

---

# 📎 LAMPIRAN — QUERY SQL AUDIT MANDIRI

> Jalankan di **Supabase Dashboard → SQL Editor**. Semua query di bawah bersifat **read-only** — hanya membaca, tidak mengubah apa pun. Aman dijalankan di database produksi.

### Query 1 — Tabel mana yang belum diaktifkan RLS-nya?

```sql
SELECT tablename AS tabel,
       CASE WHEN rowsecurity THEN '✅ Aktif' ELSE '🚨 TIDAK AKTIF' END AS status_rls
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity ASC, tablename;
```
**Yang dicari:** semua baris harus `✅ Aktif`. Setiap `🚨` berarti tabel itu terbuka.

---

### Query 2 — Tabel ber-RLS tapi tanpa policy (terkunci total)

```sql
SELECT t.tablename AS tabel,
       COALESCE(p.jml, 0) AS jumlah_policy
FROM pg_tables t
LEFT JOIN (
  SELECT tablename, COUNT(*) AS jml
  FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
) p ON p.tablename = t.tablename
WHERE t.schemaname = 'public' AND t.rowsecurity = true
ORDER BY jumlah_policy ASC;
```
**Yang dicari:** `jumlah_policy = 0` artinya RLS aktif tapi tanpa aturan — tabel jadi tidak bisa diakses siapa pun kecuali `service_role`.

---

### Query 3 — Foreign Key yang belum punya index (penyebab lambat #1)

```sql
SELECT c.conrelid::regclass AS tabel,
       a.attname            AS kolom_fk_tanpa_index
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum
  )
ORDER BY 1, 2;
```
**Yang dicari:** idealnya hasilnya **kosong**. Setiap baris yang muncul adalah kandidat pelambatan di masa depan.

---

### Query 4 — Ukuran tabel terbesar & jumlah baris

```sql
SELECT relname AS tabel,
       n_live_tup AS perkiraan_jumlah_baris,
       pg_size_pretty(pg_total_relation_size(relid)) AS ukuran_total
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```
**Gunanya:** dasar proyeksi pertumbuhan. Jalankan tiap 3 bulan dan catat, agar Anda punya tren nyata.

---

### Query 5 — Menghitung baris `transaction_items` yang bermasalah

```sql
SELECT item_type,
       COUNT(*) AS total_baris,
       COUNT(*) FILTER (
         WHERE product_id IS NULL AND treatment_id IS NULL
       ) AS baris_yatim
FROM transaction_items
GROUP BY item_type
ORDER BY baris_yatim DESC;
```
**Yang dicari:** kolom `baris_yatim` harus 0. Angka di atas 0 = penjualan yang tidak terbaca laporan produk dan stoknya tidak terpotong.

---

### Query 6 — Melihat nilai finansial yang hilang akibat baris yatim

```sql
SELECT DATE_TRUNC('month', t.created_at) AS bulan,
       COUNT(*)          AS jumlah_item_bermasalah,
       SUM(ti.subtotal)  AS nilai_rupiah_tidak_terlacak
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE ti.product_id IS NULL AND ti.treatment_id IS NULL
GROUP BY 1
ORDER BY 1 DESC;
```
**Gunanya:** menerjemahkan masalah teknis menjadi angka rupiah — ini yang akan meyakinkan developer bahwa perbaikannya mendesak.
*(Sesuaikan nama kolom `subtotal` dan `created_at` dengan skema asli Anda.)*

---

### Query 7 — Daftar seluruh tabel & view (untuk memperbarui dokumentasi)

```sql
SELECT table_name AS nama,
       CASE table_type
         WHEN 'BASE TABLE' THEN 'Tabel'
         WHEN 'VIEW'       THEN 'View'
       END AS jenis
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_type, table_name;
```
**Gunanya:** hasil query ini adalah daftar sebenarnya. Bandingkan dengan 18 tabel di dokumen master untuk tahu persis apa yang belum terdokumentasi.

---

### Query 8 — Fungsi RPC yang ada di database

```sql
SELECT routine_name AS nama_fungsi,
       data_type    AS tipe_kembalian
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```
**Gunanya:** memverifikasi klaim "Atomic RPC" di Bab 2 dokumen master. Kalau tidak ada fungsi untuk proses transaksi, berarti prosesnya dijalankan terpisah dari frontend — dan janji *all-or-nothing* belum tentu terpenuhi.

---

## ✅ Penutup

Sistem Anda dibangun di atas fondasi yang tepat — PostgreSQL asli (bukan database tertutup), sehingga data Anda selalu bisa dipindahkan kalau suatu saat perlu. **Yang perlu diurus bukan teknologinya, melainkan disiplin operasional di sekitarnya:** backup otomatis, kompresi foto, constraint kualitas data, dan kepemilikan akses.

Audit ini sebaiknya diulang **setiap 6 bulan**. Simpan hasil setiap sesi agar Anda bisa melihat tren perbaikan dari waktu ke waktu.

**Audit berikutnya dijadwalkan:** `______________`
