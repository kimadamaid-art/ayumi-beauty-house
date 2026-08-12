-- ====================================================================
-- MIGRATION: SECURITY DEFINER Helper Functions & RLS Database Enforcement
-- ====================================================================

-- 1. Helper Function: Get Current User Role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS VARCHAR AS $$
DECLARE
    u_role VARCHAR;
BEGIN
    SELECT role INTO u_role FROM public.users WHERE id = auth.uid() LIMIT 1;
    RETURN u_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Helper Function: Get Current User Active Branch ID
CREATE OR REPLACE FUNCTION public.get_current_user_branch_id()
RETURNS UUID AS $$
DECLARE
    u_branch_id UUID;
BEGIN
    SELECT branch_id INTO u_branch_id FROM public.users WHERE id = auth.uid() LIMIT 1;
    RETURN u_branch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Lock down Tabel `users`
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view policy" ON public.users;
DROP POLICY IF EXISTS "Allow SELECT for authenticated users on users" ON public.users;
DROP POLICY IF EXISTS "Allow SELECT on users" ON public.users;

CREATE POLICY "Users view policy"
ON public.users FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR public.get_current_user_role() IN ('owner', 'admin')
    OR role IN ('owner', 'admin')
);

-- 4. Secure Tabel `branches`
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public SELECT on branches" ON public.branches;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.branches;
DROP POLICY IF EXISTS "Branches viewable by authenticated users" ON public.branches;

CREATE POLICY "Branches viewable by authenticated users"
ON public.branches FOR SELECT
TO authenticated
USING (true);

-- 5. Secure Tabel `patients`
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients branch isolation" ON public.patients;
CREATE POLICY "Patients branch isolation"
ON public.patients FOR SELECT
TO authenticated
USING (
    public.get_current_user_role() = 'owner'
    OR branch_id IS NULL
    OR branch_id = public.get_current_user_branch_id()
);

-- 6. Secure Tabel `appointments`
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Appointments branch isolation" ON public.appointments;
CREATE POLICY "Appointments branch isolation"
ON public.appointments FOR SELECT
TO authenticated
USING (
    public.get_current_user_role() = 'owner'
    OR branch_id IS NULL
    OR branch_id = public.get_current_user_branch_id()
    OR therapist_id = auth.uid()
);

-- 7. Secure Tabel `treatment_records`
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Treatment records branch isolation" ON public.treatment_records;
CREATE POLICY "Treatment records branch isolation"
ON public.treatment_records FOR SELECT
TO authenticated
USING (
    public.get_current_user_role() = 'owner'
    OR branch_id IS NULL
    OR branch_id = public.get_current_user_branch_id()
    OR performed_by = auth.uid()
);

-- 8. Secure Tabel `transactions`
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Transactions branch isolation" ON public.transactions;
CREATE POLICY "Transactions branch isolation"
ON public.transactions FOR SELECT
TO authenticated
USING (
    public.get_current_user_role() = 'owner'
    OR branch_id IS NULL
    OR branch_id = public.get_current_user_branch_id()
);
