-- ====================================================================
-- ROLLBACK FASE 2 / TIER 1: KEMBALIKAN KE KONDISI AWAL (VERBATIM EKSISTING)
-- ====================================================================

BEGIN;

-- 1. DROP POLICY TIER 1 LEBIH DULU SEBELUM MENGHAPUS FUNGSI PENDUKUNGNYA
DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;

-- 2. KEMBALIKAN POLICY SELECT KE KONDISI AWAL (Perilaku Global Eksisting)
CREATE POLICY "users_select" ON public.users 
FOR SELECT TO authenticated 
USING (true);

-- 3. KEMBALIKAN POLICY UPDATE KE KONDISI AWAL
CREATE POLICY "users_update" ON public.users 
FOR UPDATE TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND (role = 'owner' OR id = users.id))
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND (role = 'owner' OR id = users.id))
);

-- 4. DROP TRIGGER TERLEBIH DULU
DROP TRIGGER IF EXISTS trg_protect_user_sensitive_columns ON public.users;

-- 5. BARU SETELAH ITU DROP FUNGSI-FUNGSINYA SECARA BERSIH
DROP FUNCTION IF EXISTS public.protect_user_sensitive_columns();
DROP FUNCTION IF EXISTS public.is_owner();
DROP FUNCTION IF EXISTS public.current_user_branch();
DROP FUNCTION IF EXISTS public.current_user_role();

COMMIT;
