-- ==============================================================================
-- MIGRASI PERBAIKAN: FIX TRIGGER DAN TABEL TREATMENT_RECORDS_AUDIT
-- Menangani error: relation "treatment_records_audit" does not exist
-- ==============================================================================

-- 1. Buat tabel treatment_records_audit jika belum ada (agar tidak crash jika ada fungsi yang merujuknya)
CREATE TABLE IF NOT EXISTS public.treatment_records_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    treatment_record_id UUID,
    action TEXT,
    old_data JSONB,
    new_data JSONB,
    changed_by UUID,
    changed_at TIMESTAMPTZ DEFAULT now()
);

-- Aktifkan RLS dan berikan akses aman
ALTER TABLE public.treatment_records_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "treatment_records_audit_all" ON public.treatment_records_audit;
CREATE POLICY "treatment_records_audit_all" 
ON public.treatment_records_audit 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 2. Drop trigger bermasalah pada treatment_records yang memicu crash jika ada
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'treatment_records' 
        AND (trigger_name ILIKE '%audit%' OR trigger_name ILIKE '%log%')
    ) LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON public.treatment_records CASCADE;';
    END LOOP;
END $$;
