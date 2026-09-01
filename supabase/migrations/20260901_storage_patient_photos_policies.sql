-- ==============================================================================
-- MIGRASI: Kebijakan Keamanan (RLS) Supabase Storage untuk Bucket 'patient-photos'
-- Dan Tabel 'patient_photos'
-- ==============================================================================

-- 1. Konfigurasi Bucket 'patient-photos' (Private, Batas 15MB, Format Gambar)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'patient-photos', 
    'patient-photos', 
    false, 
    15728640, 
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/heic', 'image/heif'];

-- 2. Kebijakan Unggah / Upload Foto (INSERT)
DROP POLICY IF EXISTS "Allow authenticated users to upload patient photos" ON storage.objects;
CREATE POLICY "Allow authenticated users to upload patient photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'patient-photos');

-- 3. Kebijakan Akses / Baca Foto via Signed URL (SELECT)
DROP POLICY IF EXISTS "Allow authenticated users to view patient photos" ON storage.objects;
CREATE POLICY "Allow authenticated users to view patient photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'patient-photos');

-- 4. Kebijakan Perbarui Foto (UPDATE / UPSERT)
DROP POLICY IF EXISTS "Allow authenticated users to update patient photos" ON storage.objects;
CREATE POLICY "Allow authenticated users to update patient photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'patient-photos')
WITH CHECK (bucket_id = 'patient-photos');

-- 5. Kebijakan Hapus Foto (DELETE)
DROP POLICY IF EXISTS "Allow authenticated users to delete patient photos" ON storage.objects;
CREATE POLICY "Allow authenticated users to delete patient photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'patient-photos');

-- 6. Kebijakan RLS Tabel Metadata 'patient_photos'
ALTER TABLE public.patient_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to access patient_photos" ON public.patient_photos;
CREATE POLICY "Allow authenticated users to access patient_photos"
ON public.patient_photos FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
