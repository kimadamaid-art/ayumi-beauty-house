-- Hapus data pasien dari halaman profil pasien.
--
-- Aturan (dicek di database, bukan hanya di browser):
--   * Hanya owner, atau admin untuk pasien di cabangnya sendiri.
--   * Pasien yang sudah punya riwayat (nota/transaksi, rekam treatment, kupon paket,
--     atau pemakaian sesi kupon) TIDAK bisa dihapus. Riwayat ini dipakai laporan
--     omzet & komisi yang sudah dicocokkan dengan GD Cashier, dan nota dikunci.
--     Jadi yang bisa dihapus: pasien salah input / dobel / belum pernah transaksi.
--   * Ikut terhapus: jadwal (beserta treatment jadwalnya), antrean & log follow-up CRM,
--     dan foto pasien tersebut.
--   * Setiap penghapusan dicatat di audit_logs (hanya bisa dibaca owner).
--
-- Melihat catatan penghapusan pasien (owner, di SQL Editor):
--   SELECT a.created_at AT TIME ZONE 'Asia/Jakarta' AS waktu_wib, u.full_name AS oleh,
--          a.old_data->>'deleted_by_role' AS peran, a.old_data->>'branch_name' AS cabang,
--          a.old_data->'patient'->>'full_name' AS pasien, a.old_data->'patient'->>'whatsapp' AS wa
--   FROM public.audit_logs a LEFT JOIN public.users u ON u.id = a.performed_by
--   WHERE a.table_name = 'patients' AND a.action = 'DELETE'
--   ORDER BY a.created_at DESC;
--
-- Pembatalan fitur: DROP FUNCTION public.delete_patient(uuid);


CREATE OR REPLACE FUNCTION public.delete_patient(p_patient_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role      text;
    v_branch    uuid;
    v_patient   public.patients%ROWTYPE;
    v_tx        int;
    v_records   int;
    v_coupons   int;
    v_usage     int;
    v_reasons   text[] := '{}';
BEGIN
    SELECT u.role::text, u.branch_id INTO v_role, v_branch
    FROM public.users u WHERE u.id = auth.uid();

    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Hanya Owner atau Admin yang dapat menghapus data pasien.';
    END IF;

    SELECT * INTO v_patient FROM public.patients WHERE id = p_patient_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pasien tidak ditemukan atau sudah dihapus.';
    END IF;

    IF v_role <> 'owner' AND v_patient.branch_id IS DISTINCT FROM v_branch THEN
        RAISE EXCEPTION 'Pasien ini terdaftar di cabang lain. Hubungi owner untuk menghapusnya.';
    END IF;

    SELECT count(*) INTO v_tx      FROM public.transactions      WHERE patient_id = p_patient_id;
    SELECT count(*) INTO v_records FROM public.treatment_records WHERE patient_id = p_patient_id;
    SELECT count(*) INTO v_coupons FROM public.patient_coupons   WHERE patient_id = p_patient_id;
    SELECT count(*) INTO v_usage   FROM public.coupon_usage_logs WHERE patient_id = p_patient_id;

    IF v_tx > 0      THEN v_reasons := v_reasons || (v_tx || ' nota transaksi'); END IF;
    IF v_records > 0 THEN v_reasons := v_reasons || (v_records || ' rekam treatment'); END IF;
    IF v_coupons > 0 THEN v_reasons := v_reasons || (v_coupons || ' kupon paket'); END IF;
    IF v_usage > 0   THEN v_reasons := v_reasons || (v_usage || ' pemakaian sesi kupon'); END IF;

    IF array_length(v_reasons, 1) > 0 THEN
        RAISE EXCEPTION 'Pasien ini tidak bisa dihapus karena sudah punya riwayat: %. Riwayat dipakai laporan omzet dan komisi.',
            array_to_string(v_reasons, ', ');
    END IF;

    -- 0. Catatan audit: data pasien sebelum dihapus.
    INSERT INTO public.audit_logs (table_name, record_id, action, performed_by, old_data, reason)
    VALUES (
        'patients',
        p_patient_id,
        'DELETE',
        auth.uid(),
        jsonb_build_object(
            'patient', to_jsonb(v_patient),
            'branch_name', (SELECT b.name FROM public.branches b WHERE b.id = v_patient.branch_id),
            'appointments_deleted', (SELECT count(*) FROM public.appointments WHERE patient_id = p_patient_id),
            'deleted_by_role', v_role
        ),
        'Data pasien dihapus dari profil pasien'
    );

    -- 1. Data pendukung yang tidak bernilai keuangan.
    DELETE FROM public.followup_logs  WHERE patient_id = p_patient_id;
    DELETE FROM public.followup_queue WHERE patient_id = p_patient_id;
    DELETE FROM public.patient_photos WHERE patient_id = p_patient_id;
    DELETE FROM public.appointment_treatments
    WHERE appointment_id IN (SELECT id FROM public.appointments WHERE patient_id = p_patient_id);
    DELETE FROM public.appointments   WHERE patient_id = p_patient_id;

    -- 2. Pasiennya.
    DELETE FROM public.patients WHERE id = p_patient_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_patient(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_patient(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_patient(uuid) TO authenticated;

-- Agar fungsi baru langsung bisa dipanggil dari aplikasi.
NOTIFY pgrst, 'reload schema';

-- VALIDASI (jalankan terpisah): harus muncul 1 baris, security_definer = true.
-- SELECT proname, prosecdef AS security_definer FROM pg_proc WHERE proname = 'delete_patient';
