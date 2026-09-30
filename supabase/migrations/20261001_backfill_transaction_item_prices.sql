-- Isi harga asli (original_price) dan diskon (discount_percent) item nota aplikasi yang
-- tersimpan 0 karena process_checkout lama tidak menyimpannya
-- (lihat 20261001_process_checkout_store_item_prices.sql).
--
-- Cakupan: item nota aplikasi (nomor TRX-...), semua cabang dan tanggal, yang harga
-- aslinya kosong/0, harga jualnya > 0, dan harga jualnya di bawah harga asli.
-- Nota migrasi GD Cashier (POTX...) tidak disentuh. Item seharga 0 (sesi kupon, bonus)
-- tidak disentuh, agar tidak terhitung sebagai diskon.
--
-- Sumber harga asli:
--   * Treatment: original_price di treatment_record_items rekam nota itu (tercatat saat
--                transaksi, jadi akurat secara historis); bila kosong, harga master treatment.
--   * Produk:    harga varian dari nama item "Produk (Varian)" dan daftar [VARIANTS:...] di
--                deskripsi produk; bila tidak ada varian, harga master produk.
--   * Kupon:     harga master paket (nama item "Paket Kupon: <nama paket>").
--   Untuk produk & kupon dipakai harga master SAAT INI.
--
-- Harga jual, subtotal, dan total nota TIDAK berubah, jadi omzet bersih tetap sama; yang
-- berubah hanya harga kotor dan diskon di laporan.
--
-- Nilai lama disimpan di _backup_20261001_trx_item_prices. Kalau dijalankan dua kali,
-- jalan kedua tidak mengubah apa pun.
-- Pembatalan: 20261001_backfill_transaction_item_prices_ROLLBACK.sql


-- 0. PRATINJAU (tidak mengubah data): tambahan diskon per cabang per bulan, nota lunas.
--
-- WITH cand AS (
--     SELECT ti.id, t.branch_id, t.created_at, t.payment_status, ti.item_type, ti.quantity, ti.price,
--            CASE ti.item_type
--              WHEN 'treatment' THEN coalesce(
--                  (SELECT max(tri.original_price) FROM public.treatment_record_items tri
--                    WHERE tri.treatment_record_id = t.treatment_record_id
--                      AND tri.treatment_id = ti.treatment_id AND tri.original_price > 0),
--                  tr.price)
--              WHEN 'product' THEN coalesce(
--                  (SELECT (v->>'price')::numeric
--                     FROM jsonb_array_elements(
--                         substring(p.description FROM '\[VARIANTS:(\[.*\])\]')::jsonb) v
--                    WHERE v->>'name' = substring(ti.name FROM '\(([^()]*)\)\s*$')
--                    LIMIT 1),
--                  p.price)
--              WHEN 'coupon' THEN cp.price
--            END AS harga_asli
--     FROM public.transaction_items ti
--     JOIN public.transactions t ON t.id = ti.transaction_id
--     LEFT JOIN public.treatments tr ON ti.item_type = 'treatment' AND tr.id = ti.treatment_id
--     LEFT JOIN public.products p    ON ti.item_type = 'product'   AND p.id  = ti.product_id
--     LEFT JOIN public.coupon_packages cp ON ti.item_type = 'coupon'
--          AND lower(cp.name) = lower(regexp_replace(ti.name, '^Paket Kupon:\s*', ''))
--     WHERE t.transaction_number LIKE 'TRX-%'
--       AND coalesce(ti.original_price, 0) = 0
--       AND ti.price > 0
-- )
-- SELECT b.name AS cabang, to_char(c.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS bulan,
--        c.item_type, count(*) AS item, sum((c.harga_asli - c.price) * c.quantity) AS tambahan_diskon
-- FROM cand c JOIN public.branches b ON b.id = c.branch_id
-- WHERE c.harga_asli > c.price AND c.payment_status = 'paid'
-- GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;


BEGIN;

CREATE TABLE IF NOT EXISTS public._backup_20261001_trx_item_prices (
    id uuid PRIMARY KEY,
    original_price numeric,
    discount_percent numeric,
    backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._backup_20261001_trx_item_prices ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE _new_item_prices ON COMMIT DROP AS
WITH cand AS (
    SELECT ti.id, ti.price,
           CASE ti.item_type
             WHEN 'treatment' THEN coalesce(
                 (SELECT max(tri.original_price) FROM public.treatment_record_items tri
                   WHERE tri.treatment_record_id = t.treatment_record_id
                     AND tri.treatment_id = ti.treatment_id AND tri.original_price > 0),
                 tr.price)
             WHEN 'product' THEN coalesce(
                 (SELECT (v->>'price')::numeric
                    FROM jsonb_array_elements(
                        substring(p.description FROM '\[VARIANTS:(\[.*\])\]')::jsonb) v
                   WHERE v->>'name' = substring(ti.name FROM '\(([^()]*)\)\s*$')
                   LIMIT 1),
                 p.price)
             WHEN 'coupon' THEN cp.price
           END AS harga_asli
    FROM public.transaction_items ti
    JOIN public.transactions t ON t.id = ti.transaction_id
    LEFT JOIN public.treatments tr ON ti.item_type = 'treatment' AND tr.id = ti.treatment_id
    LEFT JOIN public.products p    ON ti.item_type = 'product'   AND p.id  = ti.product_id
    LEFT JOIN public.coupon_packages cp ON ti.item_type = 'coupon'
         AND lower(cp.name) = lower(regexp_replace(ti.name, '^Paket Kupon:\s*', ''))
    WHERE t.transaction_number LIKE 'TRX-%'
      AND coalesce(ti.original_price, 0) = 0
      AND ti.price > 0
)
SELECT id, harga_asli, round((1 - price / harga_asli) * 100, 2) AS diskon_persen
FROM cand
WHERE harga_asli > price;

INSERT INTO public._backup_20261001_trx_item_prices (id, original_price, discount_percent)
SELECT ti.id, ti.original_price, ti.discount_percent
FROM public.transaction_items ti
JOIN _new_item_prices n ON n.id = ti.id
ON CONFLICT (id) DO NOTHING;

UPDATE public.transaction_items ti
SET original_price = n.harga_asli,
    discount_percent = n.diskon_persen
FROM _new_item_prices n
WHERE ti.id = n.id
  AND coalesce(ti.original_price, 0) = 0;

COMMIT;


-- VALIDASI Ciamis 27-29 Sep 2026 (hitungan dari data 1 Okt): tambahan diskon kira-kira
-- treatment 486.000, produk 1.819.500, kupon 270.000.
--
-- SELECT ti.item_type,
--        sum(greatest(ti.original_price, ti.price) * ti.quantity) AS kotor_item,
--        sum((greatest(ti.original_price, ti.price) - ti.price) * ti.quantity) AS diskon_item
-- FROM public.transaction_items ti
-- JOIN public.transactions t ON t.id = ti.transaction_id
-- JOIN public.branches b ON b.id = t.branch_id
-- WHERE b.name = 'Ayumi Ciamis' AND t.payment_status = 'paid' AND ti.price > 0
--   AND t.created_at >= '2026-09-27T00:00:00+07:00' AND t.created_at < '2026-09-30T00:00:00+07:00'
-- GROUP BY 1 ORDER BY 1;
