-- ==============================================================================
-- MIGRASI: Tambah Kolom Klinis & Kontraindikasi pada treatment_records
-- ==============================================================================

ALTER TABLE public.treatment_records
ADD COLUMN IF NOT EXISTS skin_type TEXT,
ADD COLUMN IF NOT EXISTS contraindications TEXT,
ADD COLUMN IF NOT EXISTS medical_history TEXT,
ADD COLUMN IF NOT EXISTS client_skincare_routine TEXT;

-- Update komentar kolom untuk dokumentasi
COMMENT ON COLUMN public.treatment_records.skin_type IS 'Jenis kulit pasien saat konsultasi (Normal, Kering, Berminyak, Kombinasi, Sensitif, Acne-prone, Aging)';
COMMENT ON COLUMN public.treatment_records.contraindications IS 'Kontraindikasi klinis (Kehamilan, Alergi bahan/obat, Pemakaian Retinoid aktif, Keloid, dll)';
COMMENT ON COLUMN public.treatment_records.medical_history IS 'Sejarah/riwayat medis dan pengobatan pasien';
COMMENT ON COLUMN public.treatment_records.client_skincare_routine IS 'Perawatan/skincare harian yang sedang dipakai klien di rumah';
