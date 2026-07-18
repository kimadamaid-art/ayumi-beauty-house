-- ====================================================================
-- MIGRATION: Tambah Kolom Komisi Terapis ke Tabel Treatments & Treatment Record Items
-- ====================================================================

-- 1. Tambah kolom commission_percent ke tabel public.treatments
ALTER TABLE public.treatments 
ADD COLUMN IF NOT EXISTS commission_percent NUMERIC DEFAULT 0;

-- 2. Tambah kolom commission_percent ke tabel public.treatment_record_items
ALTER TABLE public.treatment_record_items 
ADD COLUMN IF NOT EXISTS commission_percent NUMERIC DEFAULT 0;

-- 3. Update data lama jika perlu (default 0 sudah diset)
-- Kolom baru ini aman digunakan langsung
