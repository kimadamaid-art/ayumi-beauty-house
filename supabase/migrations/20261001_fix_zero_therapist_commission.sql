-- Betulkan tindakan terapis yang tersimpan dengan komisi 0% tanpa sengaja.
--
-- Komisi 0% bisa masuk lewat beberapa jalur di kasir & input terapis (pelaksana sempat
-- dipilih "Worker" lalu diganti terapis, tambah dari riwayat pasien, rekam lama yang dibuka
-- ulang). Kodenya sudah diperbaiki (resolveItemCommission di kasir, therapistCommission di
-- input terapis); file ini membetulkan data yang terlanjur tersimpan.
-- Ditemukan 1 Okt 2026: IPL Acne & Repair pasien "sufi" (Nisa, 1 Okt 17:23), master 5%.
--
-- Cakupan: item rekam treatment yang dikerjakan user ber-role terapis, harga > 0, komisi
-- 0/kosong, bukan infus / [WORKER], dan bukan rekam migrasi GD Cashier (yang punya aturan
-- sendiri). Persen diisi dari master treatment; bila master 0/kosong, 5%.
-- Nilai lama disimpan di _backup_20261001_zero_commission. Aman dijalankan dua kali.
-- Pembatalan: 20261001_fix_zero_therapist_commission_ROLLBACK.sql


-- 0. PRATINJAU (tidak mengubah data):
--
-- SELECT tr.treatment_date, p.full_name AS pasien, u.full_name AS terapis, t.name AS treatment,
--        tri.price_at_time, tri.commission_percent AS komisi_sekarang,
--        CASE WHEN coalesce(t.commission_percent, 0) > 0 THEN t.commission_percent ELSE 5 END AS komisi_baru
-- FROM public.treatment_record_items tri
-- JOIN public.treatment_records tr ON tr.id = tri.treatment_record_id
-- JOIN public.treatments t ON t.id = tri.treatment_id
-- JOIN public.users u ON u.id = tr.performed_by AND u.role = 'therapist'
-- LEFT JOIN public.patients p ON p.id = tr.patient_id
-- WHERE coalesce(tri.commission_percent, 0) = 0
--   AND tri.price_at_time > 0
--   AND coalesce(tri.notes, '') NOT ILIKE '%[WORKER]%'
--   AND coalesce(tr.result_notes, '') NOT ILIKE 'Migrasi GD Cashier%'
--   AND (t.name || ' ' || coalesce(tri.notes, '')) !~* '(infused|\minfus\M)'
-- ORDER BY tr.treatment_date;


BEGIN;

CREATE TABLE IF NOT EXISTS public._backup_20261001_zero_commission (
    id uuid PRIMARY KEY,
    commission_percent numeric,
    backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._backup_20261001_zero_commission ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE _zero_commission ON COMMIT DROP AS
SELECT tri.id,
       CASE WHEN coalesce(t.commission_percent, 0) > 0 THEN t.commission_percent ELSE 5 END AS komisi_baru
FROM public.treatment_record_items tri
JOIN public.treatment_records tr ON tr.id = tri.treatment_record_id
JOIN public.treatments t ON t.id = tri.treatment_id
JOIN public.users u ON u.id = tr.performed_by AND u.role = 'therapist'
WHERE coalesce(tri.commission_percent, 0) = 0
  AND tri.price_at_time > 0
  AND coalesce(tri.notes, '') NOT ILIKE '%[WORKER]%'
  AND coalesce(tr.result_notes, '') NOT ILIKE 'Migrasi GD Cashier%'
  AND (t.name || ' ' || coalesce(tri.notes, '')) !~* '(infused|\minfus\M)';

INSERT INTO public._backup_20261001_zero_commission (id, commission_percent)
SELECT tri.id, tri.commission_percent
FROM public.treatment_record_items tri
JOIN _zero_commission z ON z.id = tri.id
ON CONFLICT (id) DO NOTHING;

UPDATE public.treatment_record_items tri
SET commission_percent = z.komisi_baru
FROM _zero_commission z
WHERE tri.id = z.id
  AND coalesce(tri.commission_percent, 0) = 0;

COMMIT;


-- VALIDASI: jalankan lagi query PRATINJAU, hasilnya harus kosong.
