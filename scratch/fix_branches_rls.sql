-- Script untuk mengamankan tabel branches
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflict
DROP POLICY IF EXISTS "Branches are viewable by all authenticated users" ON public.branches;
DROP POLICY IF EXISTS "Branches are insertable by owner" ON public.branches;
DROP POLICY IF EXISTS "Branches are updatable by owner" ON public.branches;

-- Allow all authenticated users to view branches
CREATE POLICY "Branches are viewable by all authenticated users"
ON public.branches FOR SELECT
TO authenticated
USING (true);

-- Allow only owner to insert branches
CREATE POLICY "Branches are insertable by owner"
ON public.branches FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role = 'owner'
    )
);

-- Allow only owner to update branches
CREATE POLICY "Branches are updatable by owner"
ON public.branches FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role = 'owner'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role = 'owner'
    )
);

-- Allow only owner to delete branches (optional, often branches are soft-deleted via is_active)
CREATE POLICY "Branches are deletable by owner"
ON public.branches FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role = 'owner'
    )
);
