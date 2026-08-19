-- ==============================================================================
-- MIGRASI B: ISOLASI CABANG TRANSACTIONS & TRANSACTION_ITEMS (TIER 2)
-- ==============================================================================
BEGIN;

-- 1. Isolasi Cabang pada public.transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_select ON public.transactions;
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;

CREATE POLICY transactions_select ON public.transactions
    FOR SELECT TO authenticated
    USING (
        (SELECT public.is_owner()) OR branch_id = (SELECT public.current_user_branch())
    );

CREATE POLICY transactions_insert ON public.transactions
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.is_owner()) OR branch_id = (SELECT public.current_user_branch())
    );

CREATE POLICY transactions_update ON public.transactions
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.is_owner()) OR branch_id = (SELECT public.current_user_branch())
    )
    WITH CHECK (
        (SELECT public.is_owner()) OR branch_id = (SELECT public.current_user_branch())
    );


-- 2. Isolasi Cabang pada public.transaction_items (Bungkus subquery agar efisien)
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_items_select ON public.transaction_items;
DROP POLICY IF EXISTS transaction_items_insert ON public.transaction_items;

CREATE POLICY transaction_items_select ON public.transaction_items
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_items.transaction_id
              AND ((SELECT public.is_owner()) OR t.branch_id = (SELECT public.current_user_branch()))
        )
    );

CREATE POLICY transaction_items_insert ON public.transaction_items
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_items.transaction_id
              AND ((SELECT public.is_owner()) OR t.branch_id = (SELECT public.current_user_branch()))
        )
    );

COMMIT;
