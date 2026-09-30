-- Koreksi lanjutan kupon PRP 3X Fera Fitria (Banjar, WA 6281221219393, beli 3 Okt 2025).
--
-- 20260930_fix_fera_fitria_prp_coupon.sql mengubah kupon ini menjadi total 3,
-- terpakai 2, sisa 1. Owner kemudian memastikan dari data GD Cashier bahwa sisa
-- yang benar adalah 2 sesi.
-- Perubahan: terpakai 2 -> 1, sisa 1 -> 2 (total tetap 3).
--
-- Pengaman: hanya berubah kalau angkanya masih 3/2/1 (belum ada klaim baru dari
-- aplikasi). Kalau hasil validasi tidak berubah, periksa dulu angkanya.
-- Pembatalan (kembali ke 3/2/1):
--   UPDATE public.patient_coupon_items SET used_sessions = 2, remaining_sessions = 1
--   WHERE id IN (SELECT id FROM public._backup_20260930_fera_prp_coupon);


-- 0. PRATINJAU — harus tepat 1 baris: total 3, terpakai 2, sisa 1.
--
-- SELECT pci.id, p.full_name, pc.notes, pc.expired_at,
--        pci.total_sessions, pci.used_sessions, pci.remaining_sessions, pci.status
-- FROM public.patient_coupon_items pci
-- JOIN public.patient_coupons pc ON pc.id = pci.patient_coupon_id
-- JOIN public.patients p ON p.id = pc.patient_id
-- WHERE p.whatsapp = '6281221219393'
--   AND pc.notes ILIKE 'PRP 3X'
--   AND pc.purchased_at::date = '2025-10-03';


BEGIN;

UPDATE public.patient_coupon_items pci
SET used_sessions = 1,
    remaining_sessions = 2,
    status = 'active'
WHERE pci.id IN (SELECT id FROM public._backup_20260930_fera_prp_coupon)
  AND pci.total_sessions = 3 AND pci.used_sessions = 2 AND pci.remaining_sessions = 1;

COMMIT;


-- VALIDASI — jalankan lagi query PRATINJAU: harus total 3, terpakai 1, sisa 2.
