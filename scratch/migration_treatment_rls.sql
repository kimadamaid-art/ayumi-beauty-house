-- ====================================================================
-- MIGRATION: Aktifkan RLS & Buat Policy untuk Tabel Treatment
-- Tabel yang dimodifikasi: 
--   1. public.treatment_categories
--   2. public.treatments
--   3. public.treatment_record_items
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. AKTIFKAN ROW LEVEL SECURITY (RLS)
-- --------------------------------------------------------------------
ALTER TABLE public.treatment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_record_items ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- 2. POLICY UNTUK TABEL: public.treatment_categories
--    - Owner & Admin: SELECT, INSERT, UPDATE, DELETE
--    - Therapist: SELECT saja (untuk membaca master kategori)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on treatment_categories"
ON public.treatment_categories
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
CREATE POLICY "Allow INSERT for Owner and Admin on treatment_categories"
ON public.treatment_categories
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
CREATE POLICY "Allow UPDATE for Owner and Admin on treatment_categories"
ON public.treatment_categories
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: DELETE (Owner, Admin)
CREATE POLICY "Allow DELETE for Owner and Admin on treatment_categories"
ON public.treatment_categories
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);


-- --------------------------------------------------------------------
-- 3. POLICY UNTUK TABEL: public.treatments (Master Treatments)
--    - Owner & Admin: SELECT, INSERT, UPDATE, DELETE
--    - Therapist: SELECT saja (untuk membaca master treatment)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on treatments"
ON public.treatments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
CREATE POLICY "Allow INSERT for Owner and Admin on treatments"
ON public.treatments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
CREATE POLICY "Allow UPDATE for Owner and Admin on treatments"
ON public.treatments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: DELETE (Owner, Admin)
CREATE POLICY "Allow DELETE for Owner and Admin on treatments"
ON public.treatments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);


-- --------------------------------------------------------------------
-- 4. POLICY UNTUK TABEL: public.treatment_record_items
--    - Mengikuti permission dari parent-nya di public.treatment_records
--      (Jika user bisa akses record induknya, maka bisa akses item ini)
-- --------------------------------------------------------------------

-- Policy: SELECT (Mengikuti SELECT parent)
CREATE POLICY "Allow SELECT for treatment_record_items based on treatment_records parent"
ON public.treatment_record_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.treatment_records
    WHERE treatment_records.id = treatment_record_items.treatment_record_id
  )
);

-- Policy: INSERT (Mengikuti INSERT parent)
CREATE POLICY "Allow INSERT for treatment_record_items based on treatment_records parent"
ON public.treatment_record_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.treatment_records
    WHERE treatment_records.id = treatment_record_items.treatment_record_id
  )
);

-- Policy: UPDATE (Mengikuti UPDATE parent)
CREATE POLICY "Allow UPDATE for treatment_record_items based on treatment_records parent"
ON public.treatment_record_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.treatment_records
    WHERE treatment_records.id = treatment_record_items.treatment_record_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.treatment_records
    WHERE treatment_records.id = treatment_record_items.treatment_record_id
  )
);

-- Policy: DELETE (Mengikuti DELETE parent)
CREATE POLICY "Allow DELETE for treatment_record_items based on treatment_records parent"
ON public.treatment_record_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.treatment_records
    WHERE treatment_records.id = treatment_record_items.treatment_record_id
  )
);
