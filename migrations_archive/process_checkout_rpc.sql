-- Create process_checkout RPC function with atomicity, race-condition stock locking, duplicate invoice prevention, and security-safe path.
CREATE OR REPLACE FUNCTION public.process_checkout(
    p_patient_id UUID,
    p_branch_id UUID,
    p_treatment_record_id UUID,
    p_cashier_id UUID,
    p_subtotal NUMERIC,
    p_discount NUMERIC,
    p_discount_type VARCHAR,
    p_total NUMERIC,
    p_payment_method VARCHAR,
    p_payment_status VARCHAR,
    p_notes TEXT,
    p_created_by UUID,
    p_items JSONB
) RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_branch_id UUID;
    v_user_role VARCHAR;
    v_trx_number VARCHAR;
    v_date_str VARCHAR;
    v_random_code INT;
    v_trx public.transactions;
    v_item JSONB;
    v_product_stock_id UUID;
    v_current_stock INT;
    v_p_coupon_id UUID;
    v_pkg_item RECORD;
    v_cart_treatment_ids UUID[];
    v_max_sort_order INT;
    v_cart_item_id UUID;
    v_cart_item_type VARCHAR;
    v_cart_name VARCHAR;
    v_cart_price NUMERIC;
    v_cart_quantity INT;
    v_cart_original_price NUMERIC;
    v_cart_discount_percent NUMERIC;
    v_cart_commission_percent NUMERIC;
    v_attempts INT := 0;
    v_inserted BOOLEAN := FALSE;
    v_branch_code VARCHAR(5);
    v_last_number INT;
    v_next_number INT;
BEGIN
    -- 1. Security check: Get branch_id and role of the currently logged-in user (auth.uid())
    SELECT branch_id, role INTO v_user_branch_id, v_user_role
    FROM public.users
    WHERE id = auth.uid();

    -- Ensure the user exists in the database
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Pengguna tidak terautentikasi atau data pengguna tidak ditemukan.';
    END IF;

    -- Ensure cashier can only create transactions for their own branch (unless they are owner)
    IF v_user_role <> 'owner' AND v_user_branch_id <> p_branch_id THEN
        RAISE EXCEPTION 'Tidak diizinkan membuat transaksi untuk cabang lain.';
    END IF;

    -- 2. Try to generate a unique transaction number (TRX-{branch_code}-{YYYYMMDD}-{0001}) and insert.
    -- Loop handles potential race conditions on the unique transaction number check.
    WHILE NOT v_inserted AND v_attempts < 5 LOOP
        v_attempts := v_attempts + 1;
        
        -- Get branch code
        SELECT branch_code INTO v_branch_code
        FROM public.branches
        WHERE id = p_branch_id;

        IF v_branch_code IS NULL THEN
            v_branch_code := 'UNK';
        END IF;

        -- Create or fetch counter with lock to prevent race condition
        INSERT INTO public.daily_transaction_counters (branch_id, counter_date, last_number)
        VALUES (p_branch_id, CURRENT_DATE, 0)
        ON CONFLICT (branch_id, counter_date) DO NOTHING;

        SELECT last_number INTO v_last_number
        FROM public.daily_transaction_counters
        WHERE branch_id = p_branch_id AND counter_date = CURRENT_DATE
        FOR UPDATE;

        v_next_number := v_last_number + 1;

        UPDATE public.daily_transaction_counters
        SET last_number = v_next_number
        WHERE branch_id = p_branch_id AND counter_date = CURRENT_DATE;

        v_date_str := to_char(CURRENT_DATE, 'YYYYMMDD');
        v_trx_number := 'TRX-' || v_branch_code || '-' || v_date_str || '-' || lpad(v_next_number::text, 4, '0');

        BEGIN
            -- Insert transaction
            INSERT INTO public.transactions (
                transaction_number,
                patient_id,
                branch_id,
                treatment_record_id,
                cashier_id,
                subtotal,
                discount,
                discount_type,
                total,
                payment_method,
                payment_status,
                notes,
                created_by
            ) VALUES (
                v_trx_number,
                p_patient_id,
                p_branch_id,
                p_treatment_record_id,
                p_cashier_id,
                p_subtotal,
                p_discount,
                p_discount_type,
                p_total,
                p_payment_method,
                p_payment_status,
                p_notes,
                p_created_by
            ) RETURNING * INTO v_trx;

            v_inserted := TRUE;
        EXCEPTION WHEN unique_violation THEN
            -- If unique violation, loop again to generate new number
            IF v_attempts >= 5 THEN
                RAISE EXCEPTION 'Gagal generate nomor transaksi unik setelah 5 percobaan, silakan coba lagi.';
            END IF;
        END;
    END LOOP;

    -- 3. Loop through p_items and process them
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_cart_item_id := (v_item->>'id')::UUID;
        v_cart_item_type := v_item->>'item_type';
        v_cart_name := v_item->>'name';
        v_cart_price := (v_item->>'price')::NUMERIC;
        v_cart_quantity := (v_item->>'quantity')::INT;
        
        -- Insert into transaction_items
        INSERT INTO public.transaction_items (
            transaction_id,
            item_type,
            treatment_id,
            product_id,
            name,
            price,
            quantity,
            subtotal
        ) VALUES (
            v_trx.id,
            v_cart_item_type,
            CASE WHEN v_cart_item_type = 'treatment' THEN v_cart_item_id ELSE NULL END,
            CASE WHEN v_cart_item_type = 'product' THEN v_cart_item_id ELSE NULL END,
            v_cart_name,
            v_cart_price,
            v_cart_quantity,
            v_cart_price * v_cart_quantity
        );

        -- Process stock reduction for products
        IF v_cart_item_type = 'product' THEN
            -- Lock and get stock for the specific product at this transaction's branch
            SELECT id, quantity INTO v_product_stock_id, v_current_stock
            FROM public.product_stock
            WHERE product_id = v_cart_item_id AND branch_id = p_branch_id
            FOR UPDATE;

            IF v_product_stock_id IS NULL THEN
                RAISE EXCEPTION 'Stok untuk produk "%" tidak ditemukan di cabang ini!', v_cart_name;
            END IF;

            IF v_current_stock < v_cart_quantity THEN
                RAISE EXCEPTION 'Stok produk "%" tidak mencukupi! Tersedia: %, Diminta: %', v_cart_name, v_current_stock, v_cart_quantity;
            END IF;

            -- Update stock (only update the specific row fetched above, which is bound to p_branch_id)
            UPDATE public.product_stock
            SET quantity = v_current_stock - v_cart_quantity,
                updated_at = now()
            WHERE id = v_product_stock_id;

        -- Process coupon packages
        ELSIF v_cart_item_type = 'coupon' THEN
            IF p_patient_id IS NULL THEN
                RAISE EXCEPTION 'Pelanggan wajib ditentukan untuk penjualan kupon!';
            END IF;

            FOR i IN 1..v_cart_quantity LOOP
                -- Insert patient_coupon
                INSERT INTO public.patient_coupons (
                    patient_id,
                    package_id,
                    transaction_id,
                    expired_at,
                    status,
                    created_by
                ) VALUES (
                    p_patient_id,
                    v_cart_item_id,
                    v_trx.id,
                    now() + INTERVAL '1 year',
                    'active',
                    p_created_by
                ) RETURNING id INTO v_p_coupon_id;

                -- Insert patient_coupon_items
                FOR v_pkg_item IN (
                    SELECT id, treatment_id, quantity 
                    FROM public.coupon_package_items 
                    WHERE package_id = v_cart_item_id
                ) LOOP
                    INSERT INTO public.patient_coupon_items (
                        patient_coupon_id,
                        coupon_package_item_id,
                        treatment_id,
                        total_sessions,
                        remaining_sessions,
                        used_sessions,
                        status
                    ) VALUES (
                        v_p_coupon_id,
                        v_pkg_item.id,
                        v_pkg_item.treatment_id,
                        v_pkg_item.quantity,
                        v_pkg_item.quantity,
                        0,
                        'active'
                    );
                END LOOP;
            END LOOP;
        END IF;
    END LOOP;

    -- 4. Sync treatment records if treatment_record_id is present
    IF p_treatment_record_id IS NOT NULL THEN
        -- Get treatment ids from cart
        SELECT ARRAY_AGG((elem->>'id')::UUID) INTO v_cart_treatment_ids
        FROM jsonb_array_elements(p_items) elem
        WHERE elem->>'item_type' = 'treatment';

        -- Delete treatment_record_items not in cart
        IF v_cart_treatment_ids IS NOT NULL THEN
            DELETE FROM public.treatment_record_items
            WHERE treatment_record_id = p_treatment_record_id
              AND treatment_id NOT IN (SELECT unnest(v_cart_treatment_ids));
        ELSE
            DELETE FROM public.treatment_record_items
            WHERE treatment_record_id = p_treatment_record_id;
        END IF;

        -- Get current max sort_order
        SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort_order
        FROM public.treatment_record_items
        WHERE treatment_record_id = p_treatment_record_id;

        -- Loop and upsert treatment record items
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_cart_item_id := (v_item->>'id')::UUID;
            v_cart_item_type := v_item->>'item_type';
            v_cart_price := (v_item->>'price')::NUMERIC;
            v_cart_original_price := COALESCE((v_item->>'original_price')::NUMERIC, 0);
            v_cart_discount_percent := COALESCE((v_item->>'discount_percent')::NUMERIC, 0);
            v_cart_commission_percent := COALESCE((v_item->>'commission_percent')::NUMERIC, 0);

            IF v_cart_item_type = 'treatment' THEN
                IF EXISTS (
                    SELECT 1 FROM public.treatment_record_items
                    WHERE treatment_record_id = p_treatment_record_id AND treatment_id = v_cart_item_id
                ) THEN
                    UPDATE public.treatment_record_items
                    SET price_at_time = v_cart_price,
                        discount_percent = v_cart_discount_percent,
                        original_price = v_cart_original_price,
                        commission_percent = v_cart_commission_percent
                    WHERE treatment_record_id = p_treatment_record_id AND treatment_id = v_cart_item_id;
                ELSE
                    v_max_sort_order := v_max_sort_order + 1;
                    INSERT INTO public.treatment_record_items (
                        treatment_record_id,
                        treatment_id,
                        price_at_time,
                        original_price,
                        discount_percent,
                        sort_order,
                        notes,
                        commission_percent
                    ) VALUES (
                        p_treatment_record_id,
                        v_cart_item_id,
                        v_cart_price,
                        v_cart_original_price,
                        v_cart_discount_percent,
                        v_max_sort_order,
                        'Ditambahkan oleh Kasir/Admin',
                        v_cart_commission_percent
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN v_trx;
END;
$$;
