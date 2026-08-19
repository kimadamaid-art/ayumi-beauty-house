-- ==============================================================================
-- ROLLBACK MIGRASI PATCH: 20260819_patch_void_transaction_rollback.sql
-- ==============================================================================
BEGIN;

-- Mengembalikan fungsi ke versi Migrasi A awal jika diperlukan
-- (Kolom additive pada coupon_usage_logs dibiarkan karena aman dan tidak merusak)

COMMIT;
