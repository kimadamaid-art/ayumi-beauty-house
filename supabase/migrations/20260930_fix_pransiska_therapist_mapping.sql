-- Hubungkan tindakan migrasi GD Cashier cabang Banjar ke terapis Pransiska.
--
-- Akun terapis Banjar (id 1f6fc388-a765-4ef7-b6dc-88769bcbb68c) bernama
-- 'Fransiska', sedangkan nota GD Cashier menulis 'Pransiska Tanzilurohmah'.
-- Pencocokan nama di scripts/migrate-banjar-tasik.mjs gagal, sehingga:
--   - treatment_records.performed_by = NULL, dan
--   - treatment_record_items.commission_percent = 0 (script mengenolkan komisi
--     item yang terapisnya tidak ditemukan).
-- Akibatnya tindakannya masuk banner "Tindakan Tanpa Terapis" di Laporan
-- Terapis dan komisinya tidak terhitung. Mengisi performed_by saja tidak cukup:
-- komisi item juga harus dikembalikan ke persen treatment-nya.
--
-- Langkah:
--   0. PRATINJAU (jalankan dulu, tanpa mengubah apa pun).
--   1. Simpan nilai lama ke tabel cadangan (dipakai file ROLLBACK).
--   2. Ganti nama akun menjadi 'Pransiska Tanzilurohmah'.
--   3. Isi performed_by pada rekam Banjar yang masih NULL dan punya item Pransiska.
--   4. Kembalikan commission_percent item Pransiska di rekam tersebut ke persen
--      treatment-nya (0 atau kosong dianggap 5%, sama seperti script migrasi).
--      Item infus/worker tetap 0.
--
-- Rekam yang sudah punya terapis lain tidak disentuh. Kalau dijalankan dua kali,
-- jalan kedua tidak mengubah apa pun.
-- Pembatalan: 20260930_fix_pransiska_therapist_mapping_ROLLBACK.sql


-- ============================================================================
-- 0. PRATINJAU — jalankan blok ini sendiri dulu dan periksa angkanya.
-- ============================================================================
-- Rekam yang akan diisi performed_by, per bulan:
--
-- SELECT to_char(tr.treatment_date, 'YYYY-MM') AS bulan,
--        count(DISTINCT tr.id)                  AS rekam,
--        count(tri.id)                          AS item_pransiska,
--        sum(tri.price_at_time)                 AS nilai_item
-- FROM public.treatment_records tr
-- JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
-- WHERE tr.branch_id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'
--   AND tr.performed_by IS NULL
--   AND (tri.notes ILIKE '%pransiska%' OR tri.notes ILIKE '%fransiska%' OR tri.notes ILIKE '%tanzil%')
-- GROUP BY 1 ORDER BY 1;
--
-- Item Pransiska yang ada di rekam milik terapis LAIN (tidak diubah skrip ini;
-- periksa manual kalau hasilnya tidak kosong):
--
-- SELECT tr.id, tr.treatment_date, u.full_name AS terapis_rekam, tri.notes
-- FROM public.treatment_records tr
-- JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
-- JOIN public.users u ON u.id = tr.performed_by
-- WHERE tr.branch_id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'
--   AND tr.performed_by <> '1f6fc388-a765-4ef7-b6dc-88769bcbb68c'
--   AND (tri.notes ILIKE '%pransiska%' OR tri.notes ILIKE '%fransiska%' OR tri.notes ILIKE '%tanzil%');


BEGIN;

-- 1. Cadangan nilai lama -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_20260930_pransiska_users AS
    SELECT id, full_name FROM public.users
    WHERE id = '1f6fc388-a765-4ef7-b6dc-88769bcbb68c';

CREATE TABLE IF NOT EXISTS public._backup_20260930_pransiska_records AS
    SELECT DISTINCT tr.id, tr.performed_by
    FROM public.treatment_records tr
    JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
    WHERE tr.branch_id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'
      AND tr.performed_by IS NULL
      AND (tri.notes ILIKE '%pransiska%' OR tri.notes ILIKE '%fransiska%' OR tri.notes ILIKE '%tanzil%');

CREATE TABLE IF NOT EXISTS public._backup_20260930_pransiska_items AS
    SELECT tri.id, tri.commission_percent
    FROM public.treatment_record_items tri
    WHERE tri.treatment_record_id IN (SELECT id FROM public._backup_20260930_pransiska_records)
      AND (tri.notes ILIKE '%pransiska%' OR tri.notes ILIKE '%fransiska%' OR tri.notes ILIKE '%tanzil%');

-- Tabel cadangan hanya untuk SQL Editor, bukan untuk aplikasi.
ALTER TABLE public._backup_20260930_pransiska_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_20260930_pransiska_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_20260930_pransiska_items   ENABLE ROW LEVEL SECURITY;

-- 2. Nama akun -----------------------------------------------------------------
UPDATE public.users
SET full_name = 'Pransiska Tanzilurohmah'
WHERE id = '1f6fc388-a765-4ef7-b6dc-88769bcbb68c';

-- 3. Terapis pada rekam treatment ------------------------------------------------
UPDATE public.treatment_records tr
SET performed_by = '1f6fc388-a765-4ef7-b6dc-88769bcbb68c'
WHERE tr.id IN (SELECT id FROM public._backup_20260930_pransiska_records)
  AND tr.performed_by IS NULL;

-- 4. Persen komisi item ----------------------------------------------------------
-- Aturan infus sama dengan isInfusionTreatment() di lib/commissionUtils.js.
UPDATE public.treatment_record_items tri
SET commission_percent = COALESCE(NULLIF(t.commission_percent, 0), 5)
FROM public.treatments t
WHERE t.id = tri.treatment_id
  AND tri.id IN (SELECT id FROM public._backup_20260930_pransiska_items)
  AND COALESCE(tri.commission_percent, 0) = 0
  AND NOT (
        (lower(coalesce(t.name, '') || ' ' || coalesce(tri.notes, '')) ~ '(infused|\minfus\M|\[worker\])')
    AND lower(coalesce(t.name, '') || ' ' || coalesce(tri.notes, '')) NOT LIKE '%oxy infus%'
  );

COMMIT;


-- ============================================================================
-- VALIDASI setelah COMMIT
-- ============================================================================
-- a) Tidak boleh ada lagi item Pransiska di rekam Banjar tanpa terapis (hasil 0):
--
-- SELECT count(*)
-- FROM public.treatment_records tr
-- JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
-- WHERE tr.branch_id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'
--   AND tr.performed_by IS NULL
--   AND (tri.notes ILIKE '%pransiska%' OR tri.notes ILIKE '%fransiska%' OR tri.notes ILIKE '%tanzil%');
--
-- b) Isi banner "Tanpa Terapis" Banjar September 2026 — seharusnya hanya
--    infus/worker (Infused Whitening, Acne Kill, Injection Vit C, dst.):
--
-- SELECT coalesce(t.name, tri.notes) AS tindakan, count(*) AS jumlah, sum(tri.price_at_time) AS nilai
-- FROM public.treatment_records tr
-- JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
-- LEFT JOIN public.treatments t ON t.id = tri.treatment_id
-- WHERE tr.branch_id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'
--   AND tr.treatment_date BETWEEN '2026-09-01' AND '2026-09-30'
--   AND tr.performed_by IS NULL
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- c) Tindakan dan persen komisi Pransiska September 2026:
--
-- SELECT count(*) AS tindakan, sum(tri.price_at_time) AS nilai,
--        min(tri.commission_percent) AS komisi_min, max(tri.commission_percent) AS komisi_max
-- FROM public.treatment_records tr
-- JOIN public.treatment_record_items tri ON tri.treatment_record_id = tr.id
-- WHERE tr.performed_by = '1f6fc388-a765-4ef7-b6dc-88769bcbb68c'
--   AND tr.treatment_date BETWEEN '2026-09-01' AND '2026-09-30';
