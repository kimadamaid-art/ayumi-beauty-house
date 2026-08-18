-- ==============================================================================
-- AYUMI BEAUTY HOUSE - SECURITY HARDENING & RLS ENFORCEMENT
-- Mengamankan Tabel Patients, Users, dan Isolasi Multi-Cabang
-- Tanggal: 18 Agustus 2026
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. AMANKAN TABEL PATIENTS (Perbaikan F-01 & F-02: Critical)
-- ------------------------------------------------------------------------------

-- Pastikan RLS Aktif dan FORCE pada tabel patients
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;

-- Hapus policy lama yang mungkin terlalu permisif (jika ada)
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.patients;
DROP POLICY IF EXISTS "Public patients are viewable by everyone." ON public.patients;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.patients;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.patients;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.patients;
DROP POLICY IF EXISTS "patients_branch_select" ON public.patients;
DROP POLICY IF EXISTS "patients_branch_insert" ON public.patients;
DROP POLICY IF EXISTS "patients_branch_update" ON public.patients;
DROP POLICY IF EXISTS "patients_branch_delete" ON public.patients;

-- Policy SELECT:
-- 1. Owner dapat melihat pasien dari seluruh cabang
-- 2. Admin & Terapis dapat melihat pasien di cabang tempat mereka ditugaskan (atau pasien global jika branch_id null)
CREATE POLICY "patients_select_policy" ON public.patients
FOR SELECT TO authenticated
USING (
    -- Owner memiliki akses global
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'owner'
    )
    OR
    -- Admin / Terapis / Staf melihat pasien di cabangnya
    branch_id IN (
        SELECT branch_id FROM public.users 
        WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
    OR
    branch_id IS NULL
);

-- Policy INSERT:
-- Hanya authenticated user (Owner, Admin, Kasir, Terapis) yang dapat mendaftarkan pasien
CREATE POLICY "patients_insert_policy" ON public.patients
FOR INSERT TO authenticated
WITH CHECK (
    -- Owner bebas insert ke cabang mana pun
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'owner'
    )
    OR
    -- Staf/Admin/Terapis hanya boleh insert pasien ke cabangnya sendiri
    branch_id IN (
        SELECT branch_id FROM public.users 
        WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
    OR
    branch_id IS NULL
);

-- Policy UPDATE:
-- Hanya authenticated user yang boleh mengupdate data pasien
CREATE POLICY "patients_update_policy" ON public.patients
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'owner'
    )
    OR
    branch_id IN (
        SELECT branch_id FROM public.users 
        WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
    OR
    branch_id IS NULL
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'owner'
    )
    OR
    branch_id IN (
        SELECT branch_id FROM public.users 
        WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
    OR
    branch_id IS NULL
);

-- Policy DELETE:
-- Hanya Owner yang boleh menghapus data pasien permanen
CREATE POLICY "patients_delete_policy" ON public.patients
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = auth.uid() AND role = 'owner'
    )
);


-- ------------------------------------------------------------------------------
-- 2. AMANKAN TABEL USERS & CEGAH PRIVILEGE ESCALATION (Perbaikan F-04)
-- ------------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- Hapus policy lama jika ada
DROP POLICY IF EXISTS "Users can view users" ON public.users;
DROP POLICY IF EXISTS "Users can update users" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;

-- Policy SELECT users:
-- Semua authenticated user dapat membaca daftar nama staf/terapis untuk dropdown penugasan
CREATE POLICY "users_select_policy" ON public.users
FOR SELECT TO authenticated
USING (true);

-- Policy UPDATE users:
-- 1. Owner bebas mengupdate staf, role, dan cabang
-- 2. Non-owner HANYA boleh mengupdate data profilnya sendiri (TIDAK BOLEH mengubah role atau branch_id)
CREATE POLICY "users_update_policy" ON public.users
FOR UPDATE TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner')
    OR id = auth.uid()
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner')
    OR (
        id = auth.uid()
        -- Pastikan role dan branch_id tidak dimanipulasi oleh non-owner
        AND role = (SELECT role FROM public.users WHERE id = auth.uid())
        AND (branch_id IS NOT DISTINCT FROM (SELECT branch_id FROM public.users WHERE id = auth.uid()))
    )
);


-- ------------------------------------------------------------------------------
-- 3. AUDIT & PASTIKAN SELURUH TABEL LAINNYA MEMILIKI RLS AKTIF
-- ------------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treatment_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.appointment_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.patient_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.patient_coupon_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treatment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
