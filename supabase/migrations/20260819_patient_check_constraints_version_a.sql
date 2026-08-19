-- ==============================================================================
-- VERSI A: CHECK CONSTRAINTS UNTUK DATABASE DENGAN DATA UJI (NOT VALID)
-- ==============================================================================
-- KAPAN DIPAKAI:
-- Skrip ini dirancang dengan klausa 'NOT VALID' agar dapat dipasang pada database
-- yang masih berisi data uji/dummy tanpa memicu kegagalan evaluasi pada 3.961 baris lama.
-- PostgreSQL hanya akan menegakkan aturan ini untuk baris BARU atau baris yang di-UPDATE.
-- ==============================================================================

-- 1. Validasi Nama Lengkap Minimal 3 Karakter (setelah di-trim)
ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_full_name_length 
CHECK (length(trim(full_name)) >= 3) NOT VALID;

-- 2. Validasi Format WhatsApp E.164 (10-15 Digit, Jika diawali 62 wajib 628)
ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_whatsapp_e164 
CHECK (
    whatsapp ~ '^[1-9][0-9]{9,14}$'
    AND (whatsapp !~ '^62' OR whatsapp ~ '^628')
) NOT VALID;

-- 3. Validasi Tanggal Lahir (Batas Statis Aman untuk pg_dump & pg_restore)
ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_birth_date_bounds 
CHECK (
    birth_date IS NULL OR (
        birth_date > DATE '1900-01-01' 
        AND birth_date < DATE '2030-01-01'
    )
) NOT VALID;

-- 4. Validasi Field Teks Opsional (Menerima NULL, String Kosong '', atau Teks >= 5 Karakter)
ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_address_length 
CHECK (address IS NULL OR trim(address) = '' OR length(trim(address)) >= 5) NOT VALID;

ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_medical_notes_length 
CHECK (medical_notes IS NULL OR trim(medical_notes) = '' OR length(trim(medical_notes)) >= 5) NOT VALID;

ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_allergies_length 
CHECK (allergies IS NULL OR trim(allergies) = '' OR length(trim(allergies)) >= 5) NOT VALID;

ALTER TABLE public.patients 
ADD CONSTRAINT check_patients_notes_length 
CHECK (notes IS NULL OR trim(notes) = '' OR length(trim(notes)) >= 5) NOT VALID;
