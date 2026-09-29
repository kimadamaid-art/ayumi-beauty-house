-- Izinkan jenis notifikasi 'low_stock' dan 'treatment_completed'.
--
-- Aturan notifications_type_check hanya mengizinkan 'patient_arrived',
-- 'therapist_ready', dan 'general'. Padahal aplikasi juga menulis dua jenis lain:
--
--   low_stock           -> stok produk menipis/habis, ke admin dan owner
--   treatment_completed -> terapis selesai tindakan, ke admin/kasir
--
-- Keduanya ditolak database sejak awal, dan karena hasil insert tidak diperiksa,
-- penolakannya tidak terlihat. Di database live tercatat 515 notifikasi
-- patient_arrived dan 172 therapist_ready, tetapi 0 low_stock dan 0
-- treatment_completed. Tampilan lonceng notifikasi (GlobalHeader) sudah siap
-- menampilkan keduanya.
--
-- Perintah di bawah hanya MEMPERLEBAR daftar jenis yang diizinkan: aturan lama
-- dilepas lalu langsung dipasang ulang dengan daftar yang lebih lengkap, dalam
-- satu transaksi. Tidak ada tabel, kolom, maupun baris data yang diubah atau
-- dihapus, dan seluruh notifikasi yang sudah ada tetap memenuhi aturan baru.

BEGIN;

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        (type)::text = ANY (ARRAY[
            'patient_arrived',
            'therapist_ready',
            'general',
            'low_stock',
            'treatment_completed'
        ]::text[])
    );

COMMIT;
