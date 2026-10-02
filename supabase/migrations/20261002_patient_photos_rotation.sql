-- Posisi (putaran) foto klinis pasien, agar foto yang terbalik/miring bisa diluruskan
-- dari aplikasi tanpa mengubah file aslinya. Nilai: 0, 90, 180, 270 derajat searah jarum jam.
-- Foto lama otomatis 0 (tampil seperti sekarang).
--
-- Pembatalan: ALTER TABLE public.patient_photos DROP COLUMN rotation;

ALTER TABLE public.patient_photos
    ADD COLUMN IF NOT EXISTS rotation smallint NOT NULL DEFAULT 0;

ALTER TABLE public.patient_photos DROP CONSTRAINT IF EXISTS patient_photos_rotation_check;
ALTER TABLE public.patient_photos
    ADD CONSTRAINT patient_photos_rotation_check CHECK (rotation IN (0, 90, 180, 270));

-- Agar kolom baru langsung dikenali aplikasi.
NOTIFY pgrst, 'reload schema';

-- VALIDASI (jalankan terpisah): harus muncul 1 baris "rotation | smallint | 0".
-- SELECT column_name, data_type, column_default FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'patient_photos' AND column_name = 'rotation';
