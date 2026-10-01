-- Membatalkan 20261001_fix_zero_therapist_commission.sql dari tabel cadangannya.

BEGIN;

UPDATE public.treatment_record_items tri
SET commission_percent = b.commission_percent
FROM public._backup_20261001_zero_commission b
WHERE tri.id = b.id;

COMMIT;

-- Setelah dipastikan benar, cadangan boleh dihapus:
-- DROP TABLE public._backup_20261001_zero_commission;
