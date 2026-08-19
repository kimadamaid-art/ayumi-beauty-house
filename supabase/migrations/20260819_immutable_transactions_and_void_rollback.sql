-- ==============================================================================
-- ROLLBACK MIGRASI A: IMMUTABLE TRANSACTION LEDGER, AUDIT LOGS, & VOID RPC
-- ==============================================================================
BEGIN;

-- 1. DROP POLICY baru pada transaction_items dan audit_logs
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS transaction_items_select ON public.transaction_items;
DROP POLICY IF EXISTS transaction_items_insert ON public.transaction_items;

-- 2. CREATE POLICY versi lama (ALL / USING true)
CREATE POLICY transaction_items_all ON public.transaction_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- Kembalikan policy DELETE transactions khusus owner (versi awal)
CREATE POLICY transactions_delete ON public.transactions
    FOR DELETE TO authenticated
    USING ((SELECT public.is_owner()));

-- 3. DROP TRIGGER pada transactions dan transaction_items
DROP TRIGGER IF EXISTS trg_protect_transaction_immutable ON public.transactions;
DROP TRIGGER IF EXISTS trg_protect_transaction_items_immutable ON public.transaction_items;

-- 4. DROP FUNCTION
DROP FUNCTION IF EXISTS public.void_transaction(UUID, TEXT);
DROP FUNCTION IF EXISTS public.protect_transaction_items_immutable();
DROP FUNCTION IF EXISTS public.protect_transaction_immutable();

-- 5. DROP TABLE audit_logs
DROP TABLE IF EXISTS public.audit_logs;

COMMIT;
