-- Membatalkan 20260930_fix_fera_fitria_prp_coupon.sql dari tabel cadangannya.

BEGIN;

UPDATE public.patient_coupon_items pci
SET total_sessions = b.total_sessions,
    used_sessions = b.used_sessions,
    remaining_sessions = b.remaining_sessions,
    status = b.status
FROM public._backup_20260930_fera_prp_coupon b
WHERE pci.id = b.id;

COMMIT;

-- Setelah dipastikan benar, cadangan boleh dihapus:
-- DROP TABLE public._backup_20260930_fera_prp_coupon;
