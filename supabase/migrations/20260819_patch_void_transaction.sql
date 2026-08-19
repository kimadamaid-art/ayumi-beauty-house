-- ==============================================================================
-- MIGRASI PATCH: PERBAIKAN VOID TRANSAKSI & PROTEKSI IMMUTABILITY
-- File: supabase/migrations/20260819_patch_void_transaction.sql
-- ==============================================================================
BEGIN;

-- 1. Tambahkan kolom relasi dan penanda void pada coupon_usage_logs (Additive & Aman)
ALTER TABLE public.coupon_usage_logs ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.transactions(id);
ALTER TABLE public.coupon_usage_logs ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE public.coupon_usage_logs ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.users(id);

-- 2. Timpa Fungsi & Trigger Immutability dengan Perbandingan Null-Safe (IS DISTINCT FROM)
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

    -- B. Daftar Putih (Whitelist) Kolom yang Boleh Diubah dengan Perbandingan Null-Safe:
    IF NEW.total IS DISTINCT FROM OLD.total 
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal 
       OR NEW.discount IS DISTINCT FROM OLD.discount 
       OR NEW.discount_type IS DISTINCT FROM OLD.discount_type 
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.transaction_number IS DISTINCT FROM OLD.transaction_number
    THEN
        RAISE EXCEPTION 'Kolom finansial, cabang, pasien, kasir, tanggal, dan nomor transaksi bersifat IMMUTABLE (Terkunci).';
    END IF;

    -- C. Catat Audit Log jika terjadi perubahan payment_method, notes, atau treatment_record_id
    -- CATATAN: Lewatkan pencatatan jika transisi status adalah pembatalan (NEW.payment_status = 'void')
    -- karena RPC void_transaction sudah mencatat entri 'VOID' tersendiri.
    IF NEW.payment_status <> 'void' AND (
       NEW.payment_method IS DISTINCT FROM OLD.payment_method 
       OR NEW.notes IS DISTINCT FROM OLD.notes 
       OR NEW.treatment_record_id IS DISTINCT FROM OLD.treatment_record_id
    ) THEN
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

-- 3. Timpa RPC void_transaction (Preserve Riwayat Kupon, Penandaan Non-Destruktif)
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

    SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaksi tidak ditemukan.';
    END IF;

    IF v_tx.payment_status = 'void' THEN
        RAISE EXCEPTION 'Transaksi ini sudah berstatus VOID sebelumnya.';
    END IF;

    -- A. Cek Pembelian Kupon pada Transaksi Ini
    FOR v_pc IN SELECT * FROM public.patient_coupons WHERE transaction_id = p_transaction_id LOOP
        SELECT EXISTS (
            SELECT 1 FROM public.patient_coupon_items 
            WHERE patient_coupon_id = v_pc.id AND used_sessions > 0
        ) INTO v_has_used_coupon;

        IF v_has_used_coupon THEN
            RAISE EXCEPTION 'Tidak dapat membatalkan transaksi: Pasien sudah menggunakan sesi kupon ini. Hubungi Owner untuk penyelesaian manual.';
        END IF;

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

    -- C. Kembalikan Sesi Kupon yang Ditukar & Beri Penanda voided_at (Tanpa Hapus Baris)
    FOR v_pci IN 
        SELECT cul.id AS log_id, cul.patient_coupon_item_id, pci.used_sessions, pci.remaining_sessions
        FROM public.coupon_usage_logs cul
        JOIN public.patient_coupon_items pci ON pci.id = cul.patient_coupon_item_id
        WHERE cul.voided_at IS NULL 
          AND (
              cul.transaction_id = p_transaction_id
              OR (cul.notes LIKE '%' || SUBSTRING(p_transaction_id::TEXT, 1, 8) || '%')
          )
    LOOP
        -- Kembalikan kuota sesi kupon
        UPDATE public.patient_coupon_items
        SET used_sessions = GREATEST(0, used_sessions - 1),
            remaining_sessions = remaining_sessions + 1,
            status = 'active'
        WHERE id = v_pci.patient_coupon_item_id;

        -- Tandai log sebagai void tanpa menghapus datanya (Audit Trail Utuh)
        UPDATE public.coupon_usage_logs
        SET voided_at = timezone('utc'::text, now()),
            voided_by = v_caller_id,
            notes = COALESCE(notes, '') || ' [VOID: ' || p_reason || ']'
        WHERE id = v_pci.log_id;
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

    -- E. Catat ke audit_logs (Tunggal & Akurat)
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

COMMIT;
