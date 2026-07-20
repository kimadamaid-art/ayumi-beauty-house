-- Migrasi: Menambahkan kolom monthly_target ke tabel public.branches jika belum ada
ALTER TABLE public.branches 
ADD COLUMN IF NOT EXISTS monthly_target NUMERIC(15, 2) DEFAULT 0;
