-- Membatalkan 20261001_allow_void_unlink_treatment_record.sql: kedua fungsi dikembalikan
-- ke versi sebelumnya (nota VOID terkunci penuh; cancel_pending_bill menolak tagihan yang
-- terhubung ke nota VOID). Tagihan yang sudah terhapus tidak kembali.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_transaction_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_pending_bill(p_treatment_record_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role      text;
    v_branch    uuid;
    v_record    public.treatment_records%ROWTYPE;
    v_log       record;
BEGIN
    SELECT u.role::text, u.branch_id INTO v_role, v_branch
    FROM public.users u WHERE u.id = auth.uid();

    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'kasir') THEN
        RAISE EXCEPTION 'Hanya Owner, Admin, atau Kasir yang dapat membatalkan tagihan tindakan.';
    END IF;

    SELECT * INTO v_record FROM public.treatment_records WHERE id = p_treatment_record_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tagihan tidak ditemukan atau sudah dihapus.';
    END IF;

    IF v_role <> 'owner' AND v_record.branch_id IS DISTINCT FROM v_branch THEN
        RAISE EXCEPTION 'Tagihan ini milik cabang lain.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.treatment_record_id = p_treatment_record_id AND t.payment_status = 'paid'
    ) THEN
        RAISE EXCEPTION 'Tagihan ini sudah dibayar dan tidak bisa dihapus dari kasir.';
    END IF;

    -- Nota VOID dikunci trigger protect_transaction_immutable, termasuk kolom
    -- treatment_record_id-nya, sehingga rekam yang dirujuknya tidak bisa dihapus.
    IF EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.treatment_record_id = p_treatment_record_id AND t.payment_status = 'void'
    ) THEN
        RAISE EXCEPTION 'Tagihan ini terhubung ke nota yang sudah di-VOID, jadi tidak bisa dihapus dari kasir. Hubungi owner.';
    END IF;

    -- 0. Catatan audit: siapa, kapan, dan isi tagihan sebelum dihapus. Hanya owner yang
    --    bisa membaca audit_logs (policy audit_logs_select).
    INSERT INTO public.audit_logs (table_name, record_id, action, performed_by, old_data, reason)
    VALUES (
        'treatment_records',
        p_treatment_record_id,
        'DELETE',
        auth.uid(),
        jsonb_build_object(
            'treatment_record', to_jsonb(v_record),
            'patient_name', (SELECT p.full_name FROM public.patients p WHERE p.id = v_record.patient_id),
            'branch_name', (SELECT b.name FROM public.branches b WHERE b.id = v_record.branch_id),
            'items', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'treatment', t.name,
                    'price_at_time', tri.price_at_time,
                    'notes', tri.notes
                ))
                FROM public.treatment_record_items tri
                LEFT JOIN public.treatments t ON t.id = tri.treatment_id
                WHERE tri.treatment_record_id = p_treatment_record_id
            ), '[]'::jsonb),
            'coupon_sessions_returned', (
                SELECT count(*) FROM public.coupon_usage_logs
                WHERE treatment_record_id = p_treatment_record_id
            ),
            'unpaid_transactions', coalesce((
                SELECT jsonb_agg(t.transaction_number)
                FROM public.transactions t
                WHERE t.treatment_record_id = p_treatment_record_id
            ), '[]'::jsonb),
            'deleted_by_role', v_role
        ),
        'Tagihan tindakan dibatalkan dari kasir'
    );

    -- 1. Kembalikan sesi kupon yang dipakai tindakan ini.
    FOR v_log IN
        SELECT id, patient_coupon_item_id FROM public.coupon_usage_logs
        WHERE treatment_record_id = p_treatment_record_id
    LOOP
        IF v_log.patient_coupon_item_id IS NOT NULL THEN
            UPDATE public.patient_coupon_items
            SET used_sessions = greatest(0, coalesce(used_sessions, 1) - 1),
                remaining_sessions = least(coalesce(total_sessions, remaining_sessions + 1), coalesce(remaining_sessions, 0) + 1),
                status = 'active'
            WHERE id = v_log.patient_coupon_item_id;

            UPDATE public.patient_coupons pc
            SET status = 'active'
            FROM public.patient_coupon_items pci
            WHERE pci.id = v_log.patient_coupon_item_id AND pc.id = pci.patient_coupon_id;
        END IF;
    END LOOP;
    DELETE FROM public.coupon_usage_logs WHERE treatment_record_id = p_treatment_record_id;

    -- 2. Antrean follow-up (log kontaknya tetap disimpan, hanya dilepas dari antrean),
    --    foto klinis, dan nota belum lunas yang merujuk rekam ini.
    UPDATE public.followup_logs SET followup_queue_id = NULL
    WHERE followup_queue_id IN (
        SELECT id FROM public.followup_queue WHERE treatment_record_id = p_treatment_record_id
    );
    DELETE FROM public.followup_queue WHERE treatment_record_id = p_treatment_record_id;
    DELETE FROM public.patient_photos WHERE treatment_record_id = p_treatment_record_id;
    UPDATE public.transactions SET treatment_record_id = NULL
    WHERE treatment_record_id = p_treatment_record_id;

    -- 3. Batalkan appointment terkait.
    IF v_record.appointment_id IS NOT NULL THEN
        UPDATE public.appointments
        SET status = 'cancelled', updated_at = now()
        WHERE id = v_record.appointment_id;
    END IF;

    -- 4. Hapus rekam treatment; item tindakannya ikut terhapus (ON DELETE CASCADE).
    DELETE FROM public.treatment_records WHERE id = p_treatment_record_id;
END;
$$;

COMMIT;
