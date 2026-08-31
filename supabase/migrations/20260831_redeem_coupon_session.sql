-- Penukaran sesi kupon yang atomik.
--
-- Sebelumnya pemotongan sesi dilakukan dari browser dengan pola baca-lalu-tulis:
-- ambil remaining_sessions, kurangi satu, tulis kembali. Dua kasir yang menukarkan
-- kupon yang sama pada saat bersamaan sama-sama membaca angka lama, lalu sama-sama
-- menulis hasil yang sama -- dua sesi terpakai, satu terpotong.
--
-- Fungsi ini mengunci baris sesi kupon (FOR UPDATE) sebelum membacanya, sehingga
-- permintaan kedua menunggu sampai yang pertama selesai dan membaca angka terbaru.
-- Pola yang sama sudah dipakai process_checkout untuk stok produk.
--
-- SECURITY DEFINER dipakai agar pengecekan peran dilakukan di database, bukan hanya
-- di browser. Karena itu fungsi ini memeriksa sendiri siapa pemanggilnya.

CREATE OR REPLACE FUNCTION public.redeem_coupon_session(
    p_coupon_item_id      UUID,
    p_patient_id          UUID,
    p_quantity            INT  DEFAULT 1,
    p_transaction_id      UUID DEFAULT NULL,
    p_treatment_record_id UUID DEFAULT NULL,
    p_branch_id           UUID DEFAULT NULL,
    p_notes               TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id       UUID;
    v_role          TEXT;
    v_item          public.patient_coupon_items%ROWTYPE;
    v_coupon        public.patient_coupons%ROWTYPE;
    v_new_used      INT;
    v_new_remaining INT;
    v_new_status    TEXT;
    v_all_done      BOOLEAN;
BEGIN
    IF p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION 'Jumlah sesi yang ditukarkan minimal 1.';
    END IF;

    -- 1. Siapa yang memanggil, dan bolehkah dia menukarkan kupon?
    SELECT id, role INTO v_user_id, v_role
    FROM public.users
    WHERE id = auth.uid();

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak dikenali. Silakan masuk ulang.';
    END IF;

    IF v_role NOT IN ('admin', 'owner') THEN
        RAISE EXCEPTION 'Hanya admin atau owner yang dapat menukarkan kupon.';
    END IF;

    -- 2. Kunci sesi kupon lebih dulu. Selama transaksi ini berjalan, permintaan lain
    --    atas baris yang sama akan menunggu, bukan membaca angka yang sudah usang.
    SELECT * INTO v_item
    FROM public.patient_coupon_items
    WHERE id = p_coupon_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sesi kupon tidak ditemukan.';
    END IF;

    SELECT * INTO v_coupon
    FROM public.patient_coupons
    WHERE id = v_item.patient_coupon_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Kupon induk tidak ditemukan.';
    END IF;

    -- 3. Kupon harus milik pelanggan yang sedang dilayani.
    IF v_coupon.patient_id IS DISTINCT FROM p_patient_id THEN
        RAISE EXCEPTION 'Kupon ini bukan milik pelanggan yang dipilih.';
    END IF;

    IF v_coupon.status <> 'active' THEN
        RAISE EXCEPTION 'Kupon sudah tidak aktif (status: %).', v_coupon.status;
    END IF;

    -- 4. Masa berlaku diperiksa di sini juga. Status 'active' tidak pernah berubah
    --    sendiri saat tanggalnya lewat, jadi tanggalnya wajib dicek terpisah.
    IF v_coupon.expired_at IS NOT NULL AND v_coupon.expired_at <= now() THEN
        RAISE EXCEPTION 'Kupon sudah kedaluwarsa pada %.',
            to_char(v_coupon.expired_at, 'DD-MM-YYYY');
    END IF;

    IF v_item.status <> 'active' THEN
        RAISE EXCEPTION 'Sesi kupon ini sudah tidak aktif (status: %).', v_item.status;
    END IF;

    IF COALESCE(v_item.remaining_sessions, 0) < p_quantity THEN
        RAISE EXCEPTION 'Sisa sesi tidak mencukupi. Tersedia: %, diminta: %.',
            COALESCE(v_item.remaining_sessions, 0), p_quantity;
    END IF;

    -- 5. Potong sesi.
    v_new_used      := COALESCE(v_item.used_sessions, 0) + p_quantity;
    v_new_remaining := v_item.remaining_sessions - p_quantity;
    v_new_status    := CASE WHEN v_new_remaining <= 0 THEN 'fully_used' ELSE 'active' END;

    UPDATE public.patient_coupon_items
    SET used_sessions      = v_new_used,
        remaining_sessions = v_new_remaining,
        status             = v_new_status
    WHERE id = p_coupon_item_id;

    -- 6. Catat pemakaian. Berada dalam transaksi yang sama dengan pemotongan di atas,
    --    jadi keduanya tersimpan bersama atau gagal bersama.
    INSERT INTO public.coupon_usage_logs (
        patient_coupon_item_id,
        patient_id,
        transaction_id,
        treatment_record_id,
        branch_id,
        used_by,
        notes
    ) VALUES (
        p_coupon_item_id,
        p_patient_id,
        p_transaction_id,
        p_treatment_record_id,
        p_branch_id,
        v_user_id,
        p_notes
    );

    -- 7. Kalau seluruh sesi dalam paket ini sudah habis, tandai kupon induknya.
    IF v_new_remaining <= 0 THEN
        SELECT NOT EXISTS (
            SELECT 1
            FROM public.patient_coupon_items
            WHERE patient_coupon_id = v_item.patient_coupon_id
              AND COALESCE(remaining_sessions, 0) > 0
        ) INTO v_all_done;

        IF v_all_done THEN
            UPDATE public.patient_coupons
            SET status = 'fully_used'
            WHERE id = v_item.patient_coupon_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'coupon_item_id',     p_coupon_item_id,
        'used_sessions',      v_new_used,
        'remaining_sessions', v_new_remaining,
        'status',             v_new_status
    );
END;
$$;

-- Hanya pengguna yang sudah masuk yang boleh memanggil; peran diperiksa di dalam fungsi.
REVOKE ALL ON FUNCTION public.redeem_coupon_session(UUID, UUID, INT, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_coupon_session(UUID, UUID, INT, UUID, UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_session(UUID, UUID, INT, UUID, UUID, UUID, TEXT) TO authenticated;
