-- ==============================================================================
-- MIGRASI A: IMMUTABLE TRANSACTION LEDGER, AUDIT LOGS, & VOID RPC
-- ==============================================================================
BEGIN;

-- 1. Buat Tabel audit_logs (Generik & Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(64) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(16) NOT NULL, -- 'INSERT', 'UPDATE', 'VOID'
    performed_by UUID REFERENCES public.users(id),
    old_data JSONB,
    new_data JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Aktifkan RLS pada audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop policy lama jika ada
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete ON public.audit_logs;

-- SELECT: Hanya Owner yang boleh membaca audit_logs
CREATE POLICY audit_logs_select ON public.audit_logs
    FOR SELECT TO authenticated
    USING ((SELECT public.is_owner()));

-- CATATAN: TIDAK ADA POLICY INSERT, UPDATE, DELETE UNTUK authenticated.
-- Penulisan log 100% dilakukan via Security Definer trigger/RPC.


-- 2. Fungsi & Trigger Immutability pada public.transactions
CREATE OR REPLACE FUNCTION public.protect_transaction_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    -- Bypass untuk service_role / internal backend (misal restore backup)
    IF auth.uid() IS NULL OR (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN NEW;
    END IF;

    v_caller_id := auth.uid();

    -- A. Cegah Perubahan pada Transaksi yang Sudah 'void'
    IF OLD.payment_status = 'void' THEN
        RAISE EXCEPTION 'Transaksi yang sudah dibatalkan (VOID) tidak dapat diubah lagi.';
    END IF;

    -- B. Cegah Transisi Terlarang: void -> paid
    IF OLD.payment_status = 'void' AND NEW.payment_status <> 'void' THEN
        RAISE EXCEPTION 'Transaksi VOID tidak dapat diaktifkan kembali menjadi %.', NEW.payment_status;
    END IF;

    -- C. Daftar Putih (Whitelist) Kolom yang Boleh Diubah:
    -- Kolom terlarang: total, subtotal, discount, discount_type, branch_id, patient_id, cashier_id, created_at, transaction_number
    IF NEW.total <> OLD.total 
       OR NEW.subtotal <> OLD.subtotal 
       OR COALESCE(NEW.discount, 0) <> COALESCE(OLD.discount, 0)
       OR COALESCE(NEW.discount_type, '') <> COALESCE(OLD.discount_type, '')
       OR NEW.branch_id <> OLD.branch_id
       OR COALESCE(NEW.patient_id, '00000000-0000-0000-0000-000000000000'::UUID) <> COALESCE(OLD.patient_id, '00000000-0000-0000-0000-000000000000'::UUID)
       OR COALESCE(NEW.cashier_id, '00000000-0000-0000-0000-000000000000'::UUID) <> COALESCE(OLD.cashier_id, '00000000-0000-0000-0000-000000000000'::UUID)
       OR NEW.created_at <> OLD.created_at
       OR NEW.transaction_number <> OLD.transaction_number
    THEN
        RAISE EXCEPTION 'Kolom finansial, cabang, pasien, kasir, tanggal, dan nomor transaksi bersifat IMMUTABLE (Terkunci).';
    END IF;

    -- D. Catat Audit Log jika terjadi perubahan payment_method, notes, atau treatment_record_id
    IF NEW.payment_method <> OLD.payment_method 
       OR COALESCE(NEW.notes, '') <> COALESCE(OLD.notes, '')
       OR COALESCE(NEW.treatment_record_id, '00000000-0000-0000-0000-000000000000'::UUID) <> COALESCE(OLD.treatment_record_id, '00000000-0000-0000-0000-000000000000'::UUID)
    THEN
        INSERT INTO public.audit_logs (
            table_name,
            record_id,
            action,
            performed_by,
            old_data,
            new_data,
            reason
        ) VALUES (
            'transactions',
            NEW.id,
            'UPDATE',
            v_caller_id,
            jsonb_build_object(
                'payment_method', OLD.payment_method,
                'notes', OLD.notes,
                'treatment_record_id', OLD.treatment_record_id,
                'payment_status', OLD.payment_status
            ),
            jsonb_build_object(
                'payment_method', NEW.payment_method,
                'notes', NEW.notes,
                'treatment_record_id', NEW.treatment_record_id,
                'payment_status', NEW.payment_status
            ),
            'Perubahan data transaksi diizinkan'
        );
    END IF;

    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_transaction_immutable ON public.transactions;
CREATE TRIGGER trg_protect_transaction_immutable
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_transaction_immutable();


-- 3. Fungsi & Trigger Immutability pada public.transaction_items
CREATE OR REPLACE FUNCTION public.protect_transaction_items_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Bypass untuk service_role / internal backend
    IF auth.uid() IS NULL OR (auth.jwt() ->> 'role') = 'service_role' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    -- Tolak seluruh UPDATE dan DELETE pada transaction_items
    RAISE EXCEPTION 'Item transaksi bersifat IMMUTABLE dan tidak boleh diubah atau dihapus.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_transaction_items_immutable ON public.transaction_items;
CREATE TRIGGER trg_protect_transaction_items_immutable
    BEFORE UPDATE OR DELETE ON public.transaction_items
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_transaction_items_immutable();


-- 4. Stored Procedure RPC void_transaction (Idempoten & Lengkap)
CREATE OR REPLACE FUNCTION public.void_transaction(
    p_transaction_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_tx RECORD;
    v_item RECORD;
    v_pc RECORD;
    v_pci RECORD;
    v_has_used_coupon BOOLEAN := FALSE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: Pengguna tidak terotentikasi.';
    END IF;

    -- Ambil data transaksi
    SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaksi tidak ditemukan.';
    END IF;

    -- Cek Idempotensi
    IF v_tx.payment_status = 'void' THEN
        RAISE EXCEPTION 'Transaksi ini sudah berstatus VOID sebelumnya.';
    END IF;

    -- A. Cek Pembelian Kupon pada Transaksi Ini
    FOR v_pc IN SELECT * FROM public.patient_coupons WHERE transaction_id = p_transaction_id LOOP
        -- Cek apakah sudah ada sesi yang terpakai
        SELECT EXISTS (
            SELECT 1 FROM public.patient_coupon_items 
            WHERE patient_coupon_id = v_pc.id AND used_sessions > 0
        ) INTO v_has_used_coupon;

        IF v_has_used_coupon THEN
            RAISE EXCEPTION 'Tidak dapat membatalkan transaksi: Pasien sudah menggunakan sesi kupon ini. Hubungi Owner untuk penyelesaian manual.';
        END IF;

        -- Jika belum ada sesi terpakai, batalkan kuponnya
        UPDATE public.patient_coupons SET status = 'cancelled' WHERE id = v_pc.id;
        UPDATE public.patient_coupon_items SET status = 'cancelled' WHERE patient_coupon_id = v_pc.id;
    END LOOP;

    -- B. Kembalikan Stok Produk Fisik
    FOR v_item IN SELECT * FROM public.transaction_items WHERE transaction_id = p_transaction_id AND item_type = 'product' LOOP
        IF v_item.product_id IS NOT NULL THEN
            UPDATE public.product_stock
            SET quantity = quantity + v_item.quantity
            WHERE product_id = v_item.product_id AND branch_id = v_tx.branch_id;
        END IF;
    END LOOP;

    -- C. Kembalikan Kupon yang Digunakan untuk Klaim (Penukaran Sesi Rp 0)
    -- Jika transaksi ini memiliki log pemotongan kupon di coupon_usage_logs
    FOR v_pci IN 
        SELECT cul.patient_coupon_item_id, cul.id AS log_id, pci.used_sessions, pci.remaining_sessions
        FROM public.coupon_usage_logs cul
        JOIN public.patient_coupon_items pci ON pci.id = cul.patient_coupon_item_id
        WHERE cul.notes LIKE '%' || SUBSTRING(p_transaction_id::TEXT, 1, 8) || '%'
           OR (v_tx.treatment_record_id IS NOT NULL AND cul.treatment_record_id = v_tx.treatment_record_id)
    LOOP
        UPDATE public.patient_coupon_items
        SET used_sessions = GREATEST(0, used_sessions - 1),
            remaining_sessions = remaining_sessions + 1,
            status = 'active'
        WHERE id = v_pci.patient_coupon_item_id;

        DELETE FROM public.coupon_usage_logs WHERE id = v_pci.log_id;
    END LOOP;

    -- D. Update Status Transaksi Menjadi 'void'
    UPDATE public.transactions
    SET payment_status = 'void',
        notes = CASE 
            WHEN notes IS NULL OR notes = '' THEN '[BATAL/VOID: ' || p_reason || ']'
            ELSE notes || ' [BATAL/VOID: ' || p_reason || ']'
        END,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_transaction_id;

    -- E. Catat ke audit_logs
    INSERT INTO public.audit_logs (
        table_name,
        record_id,
        action,
        performed_by,
        old_data,
        new_data,
        reason
    ) VALUES (
        'transactions',
        p_transaction_id,
        'VOID',
        v_caller_id,
        jsonb_build_object('payment_status', 'paid', 'total', v_tx.total),
        jsonb_build_object('payment_status', 'void', 'total', v_tx.total),
        p_reason
    );

    RETURN jsonb_build_object('success', true, 'message', 'Transaksi berhasil dibatalkan (VOID).');
END;
$$;


-- 5. RLS Policies: Hapus Policy DELETE pada transactions & Kunci items
-- Pastikan SELECT transactions tetap terbuka (USING true) untuk Berkas A
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;
-- (Policy DELETE sengaja tidak dibuat ulang agar DELETE ditolak total di database)

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transaction_items_all ON public.transaction_items;
DROP POLICY IF EXISTS transaction_items_update ON public.transaction_items;
DROP POLICY IF EXISTS transaction_items_delete ON public.transaction_items;

-- Pastikan policy SELECT dan INSERT transaction_items ada untuk Berkas A
DROP POLICY IF EXISTS transaction_items_select ON public.transaction_items;
CREATE POLICY transaction_items_select ON public.transaction_items
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS transaction_items_insert ON public.transaction_items;
CREATE POLICY transaction_items_insert ON public.transaction_items
    FOR INSERT TO authenticated
    WITH CHECK (true);

COMMIT;
