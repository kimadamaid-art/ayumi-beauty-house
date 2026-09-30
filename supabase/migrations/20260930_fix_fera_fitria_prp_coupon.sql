-- Kupon PRP 3X milik Fera Fitria (Banjar, WA 6281221219393, beli 3 Okt 2025).
--
-- Di GD Cashier penjualan paket pukul 12:41 di-VOID lalu dijual ulang pukul 14:21
-- dengan diskon berbeda, tetapi GD tidak menghapus 3 sesi dari penjualan yang
-- di-void. Hasilnya 6 sesi dengan tanggal sama, dan script migrasi menggabungkannya
-- menjadi satu kupon 3/6. Klaim 12:42 juga diulang pukul 14:23.
--
-- Dikonfirmasi owner (30 Sep 2026): PRP sudah dilakukan 2 kali, sisa 1 sesi.
-- Perubahan: total 6 -> 3, terpakai 3 -> 2, sisa 3 -> 1.
--
-- Pengaman: hanya berubah kalau angkanya masih 6/3/3 (belum ada klaim baru dari
-- aplikasi). Kalau hasil validasi tidak berubah, periksa dulu angkanya.
-- Pembatalan: 20260930_fix_fera_fitria_prp_coupon_ROLLBACK.sql


-- 0. PRATINJAU — harus tepat 1 baris: total 6, terpakai 3, sisa 3.
--
-- SELECT pci.id, p.full_name, pc.notes, pc.purchased_at, pc.expired_at, pc.status,
--        pci.total_sessions, pci.used_sessions, pci.remaining_sessions, pci.status AS item_status
-- FROM public.patient_coupon_items pci
-- JOIN public.patient_coupons pc ON pc.id = pci.patient_coupon_id
-- JOIN public.patients p ON p.id = pc.patient_id
-- WHERE p.whatsapp = '6281221219393'
--   AND pc.notes ILIKE 'PRP 3X'
--   AND pc.purchased_at::date = '2025-10-03';


BEGIN;

CREATE TABLE IF NOT EXISTS public._backup_20260930_fera_prp_coupon AS
    SELECT pci.id, pci.total_sessions, pci.used_sessions, pci.remaining_sessions, pci.status
    FROM public.patient_coupon_items pci
    JOIN public.patient_coupons pc ON pc.id = pci.patient_coupon_id
    JOIN public.patients p ON p.id = pc.patient_id
    WHERE p.whatsapp = '6281221219393'
      AND pc.notes ILIKE 'PRP 3X'
      AND pc.purchased_at::date = '2025-10-03'
      AND pci.total_sessions = 6 AND pci.used_sessions = 3 AND pci.remaining_sessions = 3;

ALTER TABLE public._backup_20260930_fera_prp_coupon ENABLE ROW LEVEL SECURITY;

UPDATE public.patient_coupon_items pci
SET total_sessions = 3,
    used_sessions = 2,
    remaining_sessions = 1,
    status = 'active'
WHERE pci.id IN (SELECT id FROM public._backup_20260930_fera_prp_coupon)
  AND pci.total_sessions = 6 AND pci.used_sessions = 3 AND pci.remaining_sessions = 3;

COMMIT;


-- VALIDASI — jalankan lagi query PRATINJAU: harus total 3, terpakai 2, sisa 1.
