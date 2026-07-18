-- ====================================================================
-- MIGRATION: Aktifkan RLS & Buat Policy Keamanan Supabase
-- Tabel/View yang dimodifikasi:
--   1. public.appointment_treatments (Tabel)
--   2. public.treatment_categories (Tabel)
--   3. public.treatment_record_items (Tabel)
--   4. public.treatments (Tabel)
--   5. public.dashboard_today_view (View/Tabel)
--   6. public.patient_status_view (View/Tabel)
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. AKTIFKAN ROW LEVEL SECURITY (RLS)
-- --------------------------------------------------------------------
ALTER TABLE public.appointment_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;

-- Catatan Penting untuk View:
-- PostgreSQL secara native tidak mendukung RLS langsung pada VIEW. View akan 
-- otomatis mewarisi RLS dari tabel-tabel underlying (dasar) yang dikueri.
-- Jika objek di bawah ini adalah TABEL atau MATERIALIZED VIEW yang ingin diproteksi langsung:
-- (Hapus tanda komentar '--' di bawah jika Supabase mengizinkan atau jika ini didefinisikan sebagai tabel)
-- ALTER TABLE public.dashboard_today_view ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.patient_status_view ENABLE ROW LEVEL SECURITY;


-- --------------------------------------------------------------------
-- 2. POLICY UNTUK TABEL: public.appointment_treatments
--    - Owner: SELECT, INSERT, UPDATE, DELETE (Full Access)
--    - Admin: SELECT, INSERT, UPDATE (No DELETE)
--    - Therapist: SELECT saja (Read Only)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
DROP POLICY IF EXISTS "Allow SELECT for Owner, Admin, and Therapist on appointment_treatments" ON public.appointment_treatments;
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on appointment_treatments"
ON public.appointment_treatments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
DROP POLICY IF EXISTS "Allow INSERT for Owner and Admin on appointment_treatments" ON public.appointment_treatments;
CREATE POLICY "Allow INSERT for Owner and Admin on appointment_treatments"
ON public.appointment_treatments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
DROP POLICY IF EXISTS "Allow UPDATE for Owner and Admin on appointment_treatments" ON public.appointment_treatments;
CREATE POLICY "Allow UPDATE for Owner and Admin on appointment_treatments"
ON public.appointment_treatments FOR UPDATE TO authenticated
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

-- Policy: DELETE (Owner Only)
DROP POLICY IF EXISTS "Allow DELETE for Owner on appointment_treatments" ON public.appointment_treatments;
CREATE POLICY "Allow DELETE for Owner on appointment_treatments"
ON public.appointment_treatments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'owner'
  )
);


-- --------------------------------------------------------------------
-- 3. POLICY UNTUK TABEL: public.treatment_categories
--    - Owner: SELECT, INSERT, UPDATE, DELETE (Full Access)
--    - Admin: SELECT, INSERT, UPDATE (No DELETE)
--    - Therapist: SELECT saja (Read Only)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
DROP POLICY IF EXISTS "Allow SELECT for Owner, Admin, and Therapist on treatment_categories" ON public.treatment_categories;
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on treatment_categories"
ON public.treatment_categories FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
DROP POLICY IF EXISTS "Allow INSERT for Owner and Admin on treatment_categories" ON public.treatment_categories;
CREATE POLICY "Allow INSERT for Owner and Admin on treatment_categories"
ON public.treatment_categories FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
DROP POLICY IF EXISTS "Allow UPDATE for Owner and Admin on treatment_categories" ON public.treatment_categories;
CREATE POLICY "Allow UPDATE for Owner and Admin on treatment_categories"
ON public.treatment_categories FOR UPDATE TO authenticated
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

-- Policy: DELETE (Owner Only)
DROP POLICY IF EXISTS "Allow DELETE for Owner on treatment_categories" ON public.treatment_categories;
CREATE POLICY "Allow DELETE for Owner on treatment_categories"
ON public.treatment_categories FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'owner'
  )
);


-- --------------------------------------------------------------------
-- 4. POLICY UNTUK TABEL: public.treatment_record_items
--    - Owner: SELECT, INSERT, UPDATE, DELETE (Full Access)
--    - Admin: SELECT, INSERT, UPDATE (No DELETE)
--    - Therapist: SELECT saja (Read Only)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
DROP POLICY IF EXISTS "Allow SELECT for Owner, Admin, and Therapist on treatment_record_items" ON public.treatment_record_items;
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on treatment_record_items"
ON public.treatment_record_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
DROP POLICY IF EXISTS "Allow INSERT for Owner and Admin on treatment_record_items" ON public.treatment_record_items;
CREATE POLICY "Allow INSERT for Owner and Admin on treatment_record_items"
ON public.treatment_record_items FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
DROP POLICY IF EXISTS "Allow UPDATE for Owner and Admin on treatment_record_items" ON public.treatment_record_items;
CREATE POLICY "Allow UPDATE for Owner and Admin on treatment_record_items"
ON public.treatment_record_items FOR UPDATE TO authenticated
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

-- Policy: DELETE (Owner Only)
DROP POLICY IF EXISTS "Allow DELETE for Owner on treatment_record_items" ON public.treatment_record_items;
CREATE POLICY "Allow DELETE for Owner on treatment_record_items"
ON public.treatment_record_items FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'owner'
  )
);


-- --------------------------------------------------------------------
-- 5. POLICY UNTUK TABEL: public.treatments
--    - Owner: SELECT, INSERT, UPDATE, DELETE (Full Access)
--    - Admin: SELECT, INSERT, UPDATE (No DELETE)
--    - Therapist: SELECT saja (Read Only)
-- --------------------------------------------------------------------

-- Policy: SELECT (Owner, Admin, Therapist)
DROP POLICY IF EXISTS "Allow SELECT for Owner, Admin, and Therapist on treatments" ON public.treatments;
CREATE POLICY "Allow SELECT for Owner, Admin, and Therapist on treatments"
ON public.treatments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin', 'therapist')
  )
);

-- Policy: INSERT (Owner, Admin)
DROP POLICY IF EXISTS "Allow INSERT for Owner and Admin on treatments" ON public.treatments;
CREATE POLICY "Allow INSERT for Owner and Admin on treatments"
ON public.treatments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('owner', 'admin')
  )
);

-- Policy: UPDATE (Owner, Admin)
DROP POLICY IF EXISTS "Allow UPDATE for Owner and Admin on treatments" ON public.treatments;
CREATE POLICY "Allow UPDATE for Owner and Admin on treatments"
ON public.treatments FOR UPDATE TO authenticated
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

-- Policy: DELETE (Owner Only)
DROP POLICY IF EXISTS "Allow DELETE for Owner on treatments" ON public.treatments;
CREATE POLICY "Allow DELETE for Owner on treatments"
ON public.treatments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'owner'
  )
);


-- --------------------------------------------------------------------
-- 6. POLICY UNTUK VIEW (JIKA DIDEPPLOY SEBAGAI TABEL/MATERIALIZED VIEW):
--    - dashboard_today_view
--    - patient_status_view
--    - Semua role yang login (Owner, Admin, Therapist) bisa SELECT
-- --------------------------------------------------------------------

-- Polisi SELECT untuk dashboard_today_view (jika berupa tabel)
-- DROP POLICY IF EXISTS "Allow SELECT for all roles on dashboard_today_view" ON public.dashboard_today_view;
-- CREATE POLICY "Allow SELECT for all roles on dashboard_today_view"
-- ON public.dashboard_today_view FOR SELECT TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.users
--     WHERE users.id = auth.uid()
--     AND users.role IN ('owner', 'admin', 'therapist')
--   )
-- );

-- Polisi SELECT untuk patient_status_view (jika berupa tabel)
-- DROP POLICY IF EXISTS "Allow SELECT for all roles on patient_status_view" ON public.patient_status_view;
-- CREATE POLICY "Allow SELECT for all roles on patient_status_view"
-- ON public.patient_status_view FOR SELECT TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.users
--     WHERE users.id = auth.uid()
--     AND users.role IN ('owner', 'admin', 'therapist')
--   )
-- );
