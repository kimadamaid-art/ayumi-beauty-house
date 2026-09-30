-- Koreksi harga asli sesi pertama paket kupon yang terisi harga paket.
--
-- 20261001_backfill_zero_price_item_prices.sql mengambil harga asli item Rp 0 dari rekam
-- treatment. Untuk "PRP (Sesi 1 dari Paket PRP 3x)" (paket dibeli dan sesi pertamanya
-- langsung dipakai), rekam treatment menyimpan harga PAKET (1.347.000) sebagai harga asli,
-- bukan harga satu sesi (449.000). Ditemukan 2 item (Ciamis, 25 & 28 Sep 2026); kotor
-- Ciamis 27-29 Sep jadi 14.140.500, seharusnya 13.242.500.
--
-- Perbaikan: item hasil pengisian ulang tersebut yang harga aslinya melebihi harga master
-- treatment dikembalikan ke harga master. Nilai sebelum koreksi tetap tercatat di
-- _backup_20261001_zero_item_prices (rollback file itu mengembalikan ke 0).


BEGIN;

UPDATE public.transaction_items ti
SET original_price = tr.price
FROM public.treatments tr
WHERE tr.id = ti.treatment_id
  AND ti.id IN (SELECT id FROM public._backup_20261001_zero_item_prices)
  AND tr.price > 0
  AND ti.original_price > tr.price;

COMMIT;


-- VALIDASI 1: tidak boleh ada lagi baris (hasil kosong).
--
-- SELECT t.transaction_number, ti.name, ti.original_price, tr.price
-- FROM public.transaction_items ti
-- JOIN public.transactions t ON t.id = ti.transaction_id
-- JOIN public.treatments tr ON tr.id = ti.treatment_id
-- WHERE t.transaction_number LIKE 'TRX-%' AND ti.item_type = 'treatment'
--   AND tr.price > 0 AND ti.original_price > tr.price;
--
-- VALIDASI 2: kotor Ciamis 27-29 Sep harus 13.242.500.
--
-- SELECT sum(greatest(ti.original_price, ti.price) * greatest(ti.quantity, 1)) AS kotor
-- FROM public.transaction_items ti
-- JOIN public.transactions t ON t.id = ti.transaction_id
-- JOIN public.branches b ON b.id = t.branch_id
-- WHERE b.name = 'Ayumi Ciamis' AND t.payment_status = 'paid'
--   AND t.created_at >= '2026-09-27T00:00:00+07:00' AND t.created_at < '2026-09-30T00:00:00+07:00';
