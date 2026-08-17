-- ==============================================================================
-- 🚨 DDL PERBAIKAN DATABASE AYUMI BEAUTY HOUSE (VERSI REVISI AKURAT)
-- ==============================================================================
-- Semua perintah di bawah ini aman dijalankan di Supabase SQL Editor.
-- ==============================================================================

-- 1. Constraint agar kasir tidak bisa menyimpan produk/treatment tanpa ID yang valid
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_items_reference') THEN
        ALTER TABLE public.transaction_items
        ADD CONSTRAINT chk_transaction_items_reference CHECK (
            (item_type = 'product'   AND product_id   IS NOT NULL)
         OR (item_type = 'treatment' AND treatment_id IS NOT NULL)
         OR (item_type NOT IN ('product', 'treatment'))
        ) NOT VALID;
    END IF;
END $$;

-- 2. Constraint agar stok produk tidak bisa minus
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_stock_non_negative') THEN
        ALTER TABLE public.product_stock
        ADD CONSTRAINT chk_product_stock_non_negative CHECK (quantity >= 0) NOT VALID;
    END IF;
END $$;

-- 3. Composite Index untuk mempercepat performa laporan transaksi & antrean
CREATE INDEX IF NOT EXISTS idx_transaction_items_tx_id_type ON public.transaction_items (transaction_id, item_type);
CREATE INDEX IF NOT EXISTS idx_transactions_branch_created ON public.transactions (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_records_perf_date ON public.treatment_records (performed_by, treatment_date DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_records_patient_date ON public.treatment_records (patient_id, treatment_date DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_branch_date_time ON public.appointments (branch_id, appointment_date, start_time);
CREATE INDEX IF NOT EXISTS idx_product_stock_branch_prod ON public.product_stock (branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_patients_name_branch ON public.patients (branch_id, full_name);
