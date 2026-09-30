-- Membatalkan 20261001_backfill_transaction_item_prices.sql dari tabel cadangannya.
-- Dijalankan di SQL Editor (trigger item nota hanya mengizinkan perubahan dari sini).

BEGIN;

UPDATE public.transaction_items ti
SET original_price = b.original_price,
    discount_percent = b.discount_percent
FROM public._backup_20261001_trx_item_prices b
WHERE ti.id = b.id;

COMMIT;

-- Setelah dipastikan benar, cadangan boleh dihapus:
-- DROP TABLE public._backup_20261001_trx_item_prices;
