-- Hapus tagihan tindakan (rekam treatment yang belum dibayar) dari kasir, sekaligus.
--
-- Masalah: tombol hapus tagihan di kasir menghapus datanya langkah demi langkah dari
-- browser. Item tindakan boleh dihapus siapa saja, tetapi rekam treatment-nya hanya
-- boleh dihapus owner (policy treatment_records_delete). Untuk admin, item terhapus
-- lalu penghapusan rekam ditolak diam-diam, sehingga tagihan tersisa "Rp 0, 0
-- Treatment" dan tidak bisa dihapus lagi. Bahkan owner bisa gagal bila rekam masih
-- dirujuk antrean follow-up yang punya log, atau foto klinis.
--
-- Fungsi ini mengerjakan semua langkah dalam satu transaksi: kalau satu langkah gagal,
-- tidak ada yang berubah. Aturan yang sama dengan tombol di kasir:
--   * Hanya owner, admin, atau kasir. Selain owner hanya untuk cabangnya sendiri.
--   * Tagihan yang sudah punya nota lunas tidak bisa dihapus.
--   * Sesi kupon yang dipakai dikembalikan ke pasien.
--   * Appointment terkait dibatalkan.
--   * Nota belum lunas yang merujuk rekam ini dilepas (treatment_record_id = NULL).
--   * Setiap penghapusan dicatat di audit_logs (hanya bisa dibaca owner).
--
-- Melihat catatan penghapusan tagihan (owner, di SQL Editor):
--   SELECT a.created_at AT TIME ZONE 'Asia/Jakarta' AS waktu_wib, u.full_name AS oleh,
--          a.old_data->>'deleted_by_role' AS peran, a.old_data->>'branch_name' AS cabang,
--          a.old_data->>'patient_name' AS pasien, a.old_data->'items' AS tindakan
--   FROM public.audit_logs a LEFT JOIN public.users u ON u.id = a.performed_by
--   WHERE a.table_name = 'treatment_records' AND a.action = 'DELETE'
--   ORDER BY a.created_at DESC;
--
-- Juga membersihkan tagihan "Rp 0, 0 Treatment" yang tertinggal akibat masalah lama.
--
-- Pembatalan: 20261001_cancel_pending_bill_ROLLBACK.sql


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

REVOKE ALL ON FUNCTION public.cancel_pending_bill(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_pending_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_pending_bill(uuid) TO authenticated;
