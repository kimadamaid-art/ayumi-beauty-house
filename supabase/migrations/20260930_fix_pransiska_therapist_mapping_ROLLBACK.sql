-- Membatalkan 20260930_fix_pransiska_therapist_mapping.sql memakai tabel cadangan
-- yang dibuat skrip itu. Setelah dipastikan benar, tabel cadangan boleh dihapus
-- (lihat bagian bawah).

BEGIN;

UPDATE public.users u
SET full_name = b.full_name
FROM public._backup_20260930_pransiska_users b
WHERE u.id = b.id;

UPDATE public.treatment_records tr
SET performed_by = b.performed_by
FROM public._backup_20260930_pransiska_records b
WHERE tr.id = b.id;

UPDATE public.treatment_record_items tri
SET commission_percent = b.commission_percent
FROM public._backup_20260930_pransiska_items b
WHERE tri.id = b.id;

COMMIT;

-- Hapus cadangan setelah perbaikan dipastikan benar (JANGAN sebelum itu):
-- DROP TABLE public._backup_20260930_pransiska_users;
-- DROP TABLE public._backup_20260930_pransiska_records;
-- DROP TABLE public._backup_20260930_pransiska_items;
