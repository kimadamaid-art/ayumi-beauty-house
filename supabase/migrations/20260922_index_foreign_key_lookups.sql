-- Index untuk foreign key yang sering dicari tetapi belum ter-index.
--
-- Postgres tidak membuat index untuk kolom foreign key secara otomatis. Kolom-kolom
-- di bawah dipakai sebagai syarat pencarian (.eq) dan penggabungan tabel di halaman
-- yang sering dibuka, sehingga tanpa index setiap pencarian memindai seluruh tabel.
--
-- File ini HANYA menambah index. Tidak ada tabel, kolom, maupun data yang diubah,
-- dan tidak ada yang dihapus. Aman dijalankan berulang kali (IF NOT EXISTS).
--
-- Index yang sudah ada di migrasi sebelumnya sengaja tidak diulang di sini --
-- antara lain idx_transactions_branch_created, idx_transactions_patient_id,
-- idx_treatment_records_patient, idx_patient_coupon_items_coupon_id dan
-- idx_patient_photos_record.
--
-- Sebelum menjalankan, periksa apakah index setara sudah dibuat lewat dashboard
-- dengan nama lain (index kembar hanya memboroskan ruang dan memperlambat tulis):
--
--   SELECT tablename, indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename IN ('treatment_records', 'transactions', 'coupon_usage_logs')
--   ORDER BY tablename, indexname;
--
-- Pada ukuran data sekarang (ribuan baris) pembuatan index selesai dalam hitungan
-- milidetik, jadi kunci tabel selama proses tidak terasa oleh pengguna.

-- Input tindakan terapis dan dashboard terapis mencari rekam medis milik sebuah jadwal.
CREATE INDEX IF NOT EXISTS idx_treatment_records_appointment
    ON public.treatment_records (appointment_id);

-- Kasir dan halaman rekam medis menggabungkan transaksi dengan rekam medisnya.
CREATE INDEX IF NOT EXISTS idx_transactions_treatment_record
    ON public.transactions (treatment_record_id);

-- Kasir memeriksa kupon yang sudah dipotong untuk sebuah rekam medis; menghapus
-- rekam medis atau jadwal mengembalikan sesi kupon melalui pencarian yang sama.
CREATE INDEX IF NOT EXISTS idx_coupon_usage_logs_treatment_record
    ON public.coupon_usage_logs (treatment_record_id);

-- Penukaran dan pengembalian sesi kupon mencari riwayat berdasarkan sesi kuponnya.
CREATE INDEX IF NOT EXISTS idx_coupon_usage_logs_coupon_item
    ON public.coupon_usage_logs (patient_coupon_item_id);
