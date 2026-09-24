-- Upah worker: pencatatan tenaga non-terapis (infus dan sejenisnya) dalam bentuk
-- nominal rupiah, terpisah dari komisi terapis yang berbentuk persen.
--
-- Migrasi ini hanya MENAMBAH: satu tabel baru dan tiga kolom baru.
-- Tidak ada DROP, TRUNCATE, atau perubahan pada kolom yang sudah ada,
-- sehingga data dan perhitungan yang berjalan sekarang tidak tersentuh.

-- 1. Daftar worker. Worker tidak punya akun login; ini murni data pencatatan
--    yang dikelola owner. Lintas cabang, jadi tidak ada branch_id.
CREATE TABLE IF NOT EXISTS public.workers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name   VARCHAR(150) NOT NULL,
    phone       VARCHAR(30),
    notes       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

-- Izin dibuat sama persis dengan pola tabel treatments yang sudah berjalan.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workers' AND policyname='Allow SELECT for Owner, Admin, and Therapist on workers') THEN
        CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on workers"
            ON public.workers FOR SELECT TO authenticated
            USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role::text = ANY (ARRAY['owner','admin','therapist'])));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workers' AND policyname='Allow INSERT for Owner and Admin on workers') THEN
        CREATE POLICY "Allow INSERT for Owner and Admin on workers"
            ON public.workers FOR INSERT TO authenticated
            WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role::text = ANY (ARRAY['owner','admin'])));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workers' AND policyname='Allow UPDATE for Owner and Admin on workers') THEN
        CREATE POLICY "Allow UPDATE for Owner and Admin on workers"
            ON public.workers FOR UPDATE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role::text = ANY (ARRAY['owner','admin'])))
            WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role::text = ANY (ARRAY['owner','admin'])));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workers' AND policyname='Allow DELETE for Owner on workers') THEN
        CREATE POLICY "Allow DELETE for Owner on workers"
            ON public.workers FOR DELETE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role::text = 'owner'));
    END IF;
END $$;

-- Pengguna yang belum login tidak berkepentingan dengan daftar worker,
-- sama seperti tabel patients yang aksesnya sudah dicabut dari anon.
REVOKE ALL ON public.workers FROM anon;

-- 2. Nominal upah worker per treatment. Default 0 berarti treatment itu tidak
--    melibatkan worker, sehingga seluruh treatment yang ada sekarang tidak
--    berubah perilakunya sampai owner mengisi angkanya sendiri.
ALTER TABLE public.treatments
    ADD COLUMN IF NOT EXISTS worker_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 3. Jejak per tindakan: siapa worker-nya dan berapa upahnya SAAT ITU.
--    Nominal disalin ke sini seperti halnya price_at_time dan commission_percent,
--    supaya perubahan tarif di kemudian hari tidak mengubah laporan bulan lalu.
ALTER TABLE public.treatment_record_items
    ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.workers(id),
    ADD COLUMN IF NOT EXISTS worker_fee_at_time NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_treatment_record_items_worker_id
    ON public.treatment_record_items (worker_id);
