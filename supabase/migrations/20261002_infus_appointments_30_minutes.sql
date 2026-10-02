-- Jadwal infus oleh worker menjadi 30 menit (jam selesai = jam mulai + 30 menit),
-- agar satu jam bisa diisi dua pasien seperti jadwal GD Cashier.
--
-- Yang diubah: jadwal infus TANPA terapis (dikerjakan worker), sama dengan aturan
-- form Buat/Ubah Jadwal. Infus dikenali seperti di halaman jadwal: nama treatment,
-- kategori treatment, atau catatan jadwal mengandung kata "infus".
-- Jadwal infus yang memakai terapis (infus + treatment) tidak disentuh.
-- Jam mulai tidak berubah. Setelah ini, jam tiap jadwal bisa digeser lewat tombol Ubah.
--
-- Jalankan per bagian di SQL Editor.

-- 1) CEK DULU: jumlah jadwal yang akan diubah, per cabang.
WITH infus AS (
    SELECT a.id
    FROM public.appointments a
    WHERE a.therapist_id IS NULL
      AND a.start_time IS NOT NULL
      AND (
          a.notes ILIKE '%infus%'
          OR EXISTS (
              SELECT 1
              FROM public.appointment_treatments at
              JOIN public.treatments t ON t.id = at.treatment_id
              LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
              WHERE at.appointment_id = a.id
                AND (t.name ILIKE '%infus%' OR tc.name ILIKE '%infus%')
          )
      )
)
SELECT b.name AS cabang,
       count(*) AS jumlah_jadwal_infus,
       count(*) FILTER (WHERE a.end_time IS DISTINCT FROM (a.start_time + interval '30 minutes')::time) AS akan_diubah
FROM public.appointments a
JOIN infus i ON i.id = a.id
LEFT JOIN public.branches b ON b.id = a.branch_id
GROUP BY b.name
ORDER BY b.name;

-- 2) UBAH: jam selesai = jam mulai + 30 menit.
BEGIN;

UPDATE public.appointments a
SET end_time = (a.start_time + interval '30 minutes')::time
WHERE a.therapist_id IS NULL
  AND a.start_time IS NOT NULL
  AND a.end_time IS DISTINCT FROM (a.start_time + interval '30 minutes')::time
  AND (
      a.notes ILIKE '%infus%'
      OR EXISTS (
          SELECT 1
          FROM public.appointment_treatments at
          JOIN public.treatments t ON t.id = at.treatment_id
          LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
          WHERE at.appointment_id = a.id
            AND (t.name ILIKE '%infus%' OR tc.name ILIKE '%infus%')
      )
  );

COMMIT;

-- 3) VALIDASI: jalankan lagi bagian 1). Kolom "akan_diubah" harus 0 di semua cabang.
