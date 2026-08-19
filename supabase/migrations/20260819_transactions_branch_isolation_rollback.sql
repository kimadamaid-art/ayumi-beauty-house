-- ==============================================================================
-- ROLLBACK MIGRASI B: ISOLASI CABANG TRANSACTIONS & TRANSACTION_ITEMS
-- ==============================================================================
BEGIN;

-- 1. Kembalikan policy transactions ke versi terbuka (USING true)
DROP POLICY IF EXISTS transactions_select ON public.transactions;
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;

CREATE POLICY transactions_select ON public.transactions
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY transactions_insert ON public.transactions
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY transactions_update ON public.transactions
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

-- 2. Kembalikan policy transaction_items ke versi terbuka
DROP POLICY IF EXISTS transaction_items_select ON public.transaction_items;
DROP POLICY IF EXISTS transaction_items_insert ON public.transaction_items;

CREATE POLICY transaction_items_select ON public.transaction_items
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY transaction_items_insert ON public.transaction_items
    FOR INSERT TO authenticated
    WITH CHECK (true);

COMMIT;
