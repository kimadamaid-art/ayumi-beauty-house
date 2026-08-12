-- ====================================================================
-- MIGRATION: Tabel Audit Histori Penugasan Cabang Staf (user_branch_assignments)
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.user_branch_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.user_branch_assignments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view branch assignment history
DROP POLICY IF EXISTS "Allow authenticated SELECT on user_branch_assignments" ON public.user_branch_assignments;
CREATE POLICY "Allow authenticated SELECT on user_branch_assignments"
ON public.user_branch_assignments FOR SELECT
TO authenticated
USING (true);

-- Allow owner and admin to insert/update branch assignment history
DROP POLICY IF EXISTS "Allow owner/admin INSERT on user_branch_assignments" ON public.user_branch_assignments;
CREATE POLICY "Allow owner/admin INSERT on user_branch_assignments"
ON public.user_branch_assignments FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role IN ('owner', 'admin')
    )
);

DROP POLICY IF EXISTS "Allow owner/admin UPDATE on user_branch_assignments" ON public.user_branch_assignments;
CREATE POLICY "Allow owner/admin UPDATE on user_branch_assignments"
ON public.user_branch_assignments FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role IN ('owner', 'admin')
    )
);
