-- Membatalkan 20261001_cancel_pending_bill.sql. Tagihan yang sudah dihapus lewat fungsi
-- ini tidak kembali; yang dihapus hanya fungsinya. Setelah rollback, tombol hapus tagihan
-- di kasir tidak berfungsi sampai kode aplikasi dikembalikan ke versi lama.

DROP FUNCTION IF EXISTS public.cancel_pending_bill(uuid);
