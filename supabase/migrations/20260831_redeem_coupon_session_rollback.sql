-- Pembatalan 20260831_redeem_coupon_session.sql
--
-- Jalankan ini HANYA setelah aplikasi dikembalikan ke versi yang memotong sesi
-- kupon dari sisi klien. Kalau fungsi dihapus sementara aplikasi masih
-- memanggilnya, penukaran kupon di kasir akan gagal.

DROP FUNCTION IF EXISTS public.redeem_coupon_session(UUID, UUID, INT, UUID, UUID, UUID, TEXT);
