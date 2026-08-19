-- ====================================================================
-- FASE 2 / TIER 1: SECURITY HARDENING FONDASI & USERS
-- ====================================================================

BEGIN;

-- 1. HELPER FUNCTIONS (STABLE, SECURITY DEFINER - Mencegah Infinite Recursion)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text AS $$
DECLARE
    v_role text;
BEGIN
    SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
    RETURN v_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.current_user_branch()
RETURNS uuid AS $$
DECLARE
    v_branch uuid;
BEGIN
    SELECT branch_id INTO v_branch FROM public.users WHERE id = auth.uid();
    RETURN v_branch;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean AS $$
BEGIN
    RETURN (public.current_user_role() = 'owner');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;


-- 2. TRIGGER ANTI-ESKALASI ROLE & KOLOM SENSITIF
CREATE OR REPLACE FUNCTION public.protect_user_sensitive_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- CATATAN KEAMANAN:
    -- Jalur "auth.uid() IS NULL" di bawah ini aman HANYA karena policy RLS users_update
    -- bertarget "TO authenticated", sehingga request anonim dari luar tidak pernah sampai ke trigger.
    -- Kondisi ini khusus untuk mengizinkan Service Role (Backend API/Next.js) yang tidak membawa auth.uid().
    IF auth.uid() IS NULL OR (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Jika pemanggil login bukan owner, tolak keras modifikasi role, branch_id, is_active, dan email
    IF NOT public.is_owner() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Akses Ditolak: Anda tidak diizinkan mengubah role pengguna.';
        END IF;
        IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
            RAISE EXCEPTION 'Akses Ditolak: Anda tidak diizinkan mengubah cabang pengguna.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Akses Ditolak: Anda tidak diizinkan mengubah status aktif pengguna.';
        END IF;
        IF NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Akses Ditolak: Perubahan email hanya dapat dilakukan oleh Owner.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_protect_user_sensitive_columns ON public.users;
CREATE TRIGGER trg_protect_user_sensitive_columns
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_user_sensitive_columns();


-- 3. POLICIES TABEL USERS (BEBAS REKURSI)
DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
USING (
    public.is_owner()
    OR id = auth.uid()
    OR branch_id = (SELECT public.current_user_branch())
    OR role = 'therapist'
);

DROP POLICY IF EXISTS "users_update" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;
CREATE POLICY "users_update" ON public.users FOR UPDATE TO authenticated
USING (
    public.is_owner() OR id = auth.uid()
)
WITH CHECK (
    public.is_owner() OR id = auth.uid()
);

COMMIT;
