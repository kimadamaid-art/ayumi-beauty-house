-- Isi harga asli item Rp 0 (sesi kupon & bonus gratis) di nota aplikasi lama.
--
-- Laporan kini mencatat kotor sama seperti GD Cashier: item yang dibayar dengan sesi
-- kupon atau diberikan gratis tetap masuk kotor sebesar harga aslinya, lalu dipotong
-- sebagai "Redeem Kupon" (sesi kupon) atau "Diskon" (bonus). Nota aplikasi lama
-- menyimpan item seperti ini dengan original_price 0, sehingga tidak ikut terhitung.
--
-- Cakupan: item treatment nota TRX-... dengan harga jual 0, subtotal 0, dan
-- original_price 0. Harga asli diambil dari rekam treatment nota itu (tercatat saat
-- transaksi); bila kosong, harga master treatment. discount_percent diisi 100.
-- Harga jual, subtotal, dan total nota tidak berubah; omzet bersih tetap sama.
--
-- Contoh Ciamis 27-29 Sep 2026: 4 item (PRP 449.000 x3, Panda's Eye 150.000) = 1.497.000,
-- sehingga kotor menjadi 13.242.500, sama dengan GD Cashier.
--
-- Nilai lama disimpan di _backup_20261001_zero_item_prices. Kalau dijalankan dua kali,
-- jalan kedua tidak mengubah apa pun.
-- Pembatalan: 20261001_backfill_zero_price_item_prices_ROLLBACK.sql


-- 0. PRATINJAU (tidak mengubah data): jumlah item & nilai per cabang per bulan.
--
-- SELECT b.name AS cabang, to_char(t.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS bulan,
--        count(*) AS item,
--        sum(coalesce(
--            (SELECT max(tri.original_price) FROM public.treatment_record_items tri
--              WHERE tri.treatment_record_id = t.treatment_record_id
--                AND tri.treatment_id = ti.treatment_id AND tri.original_price > 0),
--            tr.price) * greatest(ti.quantity, 1)) AS nilai
-- FROM public.transaction_items ti
-- JOIN public.transactions t ON t.id = ti.transaction_id
-- JOIN public.branches b ON b.id = t.branch_id
-- LEFT JOIN public.treatments tr ON tr.id = ti.treatment_id
-- WHERE t.transaction_number LIKE 'TRX-%'
--   AND ti.item_type = 'treatment'
--   AND ti.price = 0 AND ti.subtotal = 0
--   AND coalesce(ti.original_price, 0) = 0
-- GROUP BY 1, 2 ORDER BY 1, 2;


BEGIN;

CREATE TABLE IF NOT EXISTS public._backup_20261001_zero_item_prices (
    id uuid PRIMARY KEY,
    original_price numeric,
    discount_percent numeric,
    backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._backup_20261001_zero_item_prices ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE _zero_item_prices ON COMMIT DROP AS
SELECT ti.id,
       coalesce(
           (SELECT max(tri.original_price) FROM public.treatment_record_items tri
             WHERE tri.treatment_record_id = t.treatment_record_id
               AND tri.treatment_id = ti.treatment_id AND tri.original_price > 0),
           tr.price) AS harga_asli
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti.transaction_id
LEFT JOIN public.treatments tr ON tr.id = ti.treatment_id
WHERE t.transaction_number LIKE 'TRX-%'
  AND ti.item_type = 'treatment'
  AND ti.price = 0 AND ti.subtotal = 0
  AND coalesce(ti.original_price, 0) = 0;

DELETE FROM _zero_item_prices WHERE coalesce(harga_asli, 0) <= 0;

INSERT INTO public._backup_20261001_zero_item_prices (id, original_price, discount_percent)
SELECT ti.id, ti.original_price, ti.discount_percent
FROM public.transaction_items ti
JOIN _zero_item_prices z ON z.id = ti.id
ON CONFLICT (id) DO NOTHING;

UPDATE public.transaction_items ti
SET original_price = z.harga_asli,
    discount_percent = 100
FROM _zero_item_prices z
WHERE ti.id = z.id
  AND coalesce(ti.original_price, 0) = 0;

COMMIT;


-- VALIDASI Ciamis 27-29 Sep 2026: kotor semua item harus 13.242.500.
--
-- SELECT sum(greatest(ti.original_price, ti.price) * greatest(ti.quantity, 1)) AS kotor
-- FROM public.transaction_items ti
-- JOIN public.transactions t ON t.id = ti.transaction_id
-- JOIN public.branches b ON b.id = t.branch_id
-- WHERE b.name = 'Ayumi Ciamis' AND t.payment_status = 'paid'
--   AND t.created_at >= '2026-09-27T00:00:00+07:00' AND t.created_at < '2026-09-30T00:00:00+07:00';
