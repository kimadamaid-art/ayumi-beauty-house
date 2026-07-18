-- ====================================================================
-- MIGRATION: RLS Hybrid Schema (Branch Isolation & Global Read Access)
-- Tujuan: Mengamankan data finansial per cabang (Kategori B),
--         sambil membiarkan data pasien & rekam medis dibaca lintas cabang (Kategori A).
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. PEMBERSIHAN POLICY LAMA SECARA DINAMIS
-- --------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN (
            'patients', 'appointments', 'treatment_records', 'transactions', 
            'product_stock', 'leads', 'followup_queue', 'followup_logs', 
            'coupon_usage_logs', 'users', 'products', 'coupon_packages',
            'transaction_items', 'treatment_record_items', 'patient_coupons',
            'patient_coupon_items', 'appointment_treatments', 'coupon_package_items'
        )
    ) LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename);
    END LOOP;
END $$;

-- Pembersihan trigger lama jika ada
DROP TRIGGER IF EXISTS trg_auto_fill_patients_branch ON public.patients;
DROP TRIGGER IF EXISTS trg_auto_fill_treatment_records_branch ON public.treatment_records;
DROP TRIGGER IF EXISTS trg_restrict_patients_branch_update ON public.patients;
DROP TRIGGER IF EXISTS trg_restrict_treatment_records_branch_update ON public.treatment_records;


-- --------------------------------------------------------------------
-- 2. AKTIFKAN ROW LEVEL SECURITY (RLS)
-- --------------------------------------------------------------------
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_packages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_coupon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_package_items ENABLE ROW LEVEL SECURITY;


-- --------------------------------------------------------------------
-- 3. TRIGGER PENGISIAN & VALIDASI branch_id OTOMATIS (KATEGORI A)
-- --------------------------------------------------------------------

-- Fungsi 1: Auto-fill branch_id saat INSERT berdasarkan staff yang login
CREATE OR REPLACE FUNCTION public.auto_fill_branch_id()
RETURNS TRIGGER AS $$
DECLARE
    user_branch uuid;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        -- Ambil branch_id dari staff yang sedang melakukan INSERT
        SELECT branch_id INTO user_branch FROM public.users WHERE id = auth.uid();
        
        -- Jika yang login adalah Owner, biarkan input manual (atau null jika tidak diisi)
        IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner') THEN
            IF NEW.branch_id IS NULL THEN
                NEW.branch_id := NULL;
            END IF;
        ELSE
            -- Jika staff biasa: ALWAYS override kolom branch_id ke cabang mereka sendiri
            NEW.branch_id := user_branch;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pasang Trigger INSERT
CREATE TRIGGER trg_auto_fill_patients_branch
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.auto_fill_branch_id();

CREATE TRIGGER trg_auto_fill_treatment_records_branch
BEFORE INSERT ON public.treatment_records
FOR EACH ROW EXECUTE FUNCTION public.auto_fill_branch_id();


-- Fungsi 2: Kunci agar staff non-owner tidak bisa memindahkan cabang (UPDATE branch_id)
CREATE OR REPLACE FUNCTION public.restrict_branch_id_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        -- Jika bukan Owner, kembalikan branch_id ke nilai sebelumnya jika dicoba diubah
        IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner') THEN
            IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
                NEW.branch_id := OLD.branch_id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pasang Trigger UPDATE
CREATE TRIGGER trg_restrict_patients_branch_update
BEFORE UPDATE ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.restrict_branch_id_update();

CREATE TRIGGER trg_restrict_treatment_records_branch_update
BEFORE UPDATE ON public.treatment_records
FOR EACH ROW EXECUTE FUNCTION public.restrict_branch_id_update();


-- --------------------------------------------------------------------
-- 4. KATEGORI A - AKSES GLOBAL (Dapat dibaca semua staff, hapus oleh Owner)
-- --------------------------------------------------------------------

-- == patients ==
CREATE POLICY "patients_select" ON public.patients FOR SELECT TO authenticated USING (true);
CREATE POLICY "patients_insert" ON public.patients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "patients_update" ON public.patients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "patients_delete" ON public.patients FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'owner')
);

-- == treatment_records ==
CREATE POLICY "treatment_records_select" ON public.treatment_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "treatment_records_insert" ON public.treatment_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "treatment_records_update" ON public.treatment_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "treatment_records_delete" ON public.treatment_records FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'owner')
);

-- == treatment_record_items (Child) ==
CREATE POLICY "treatment_record_items_select" ON public.treatment_record_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "treatment_record_items_write" ON public.treatment_record_items FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- == patient_coupons (Global Read, Owner-Only Delete) ==
CREATE POLICY "patient_coupons_select" ON public.patient_coupons FOR SELECT TO authenticated USING (true);
CREATE POLICY "patient_coupons_insert" ON public.patient_coupons FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "patient_coupons_update" ON public.patient_coupons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "patient_coupons_delete" ON public.patient_coupons FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'owner')
);

-- == patient_coupon_items (Child) ==
CREATE POLICY "patient_coupon_items_select" ON public.patient_coupon_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "patient_coupon_items_write" ON public.patient_coupon_items FOR ALL TO authenticated 
USING (true) WITH CHECK (true);


-- --------------------------------------------------------------------
-- 5. KATEGORI B - ISOLASI PER CABANG (Dibatasi branch_id)
-- --------------------------------------------------------------------

-- == transactions ==
CREATE POLICY "transactions_select" ON public.transactions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = transactions.branch_id)
  )
);
CREATE POLICY "transactions_insert" ON public.transactions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = transactions.branch_id)
  )
);
CREATE POLICY "transactions_update" ON public.transactions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = transactions.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = transactions.branch_id)
  )
);
CREATE POLICY "transactions_delete" ON public.transactions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = transactions.branch_id)
  )
);

-- == product_stock ==
CREATE POLICY "product_stock_select" ON public.product_stock FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = product_stock.branch_id)
  )
);
CREATE POLICY "product_stock_insert" ON public.product_stock FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = product_stock.branch_id)
  )
);
CREATE POLICY "product_stock_update" ON public.product_stock FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = product_stock.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = product_stock.branch_id)
  )
);
CREATE POLICY "product_stock_delete" ON public.product_stock FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = product_stock.branch_id)
  )
);

-- == appointments ==
CREATE POLICY "appointments_select" ON public.appointments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = appointments.branch_id)
  )
);
CREATE POLICY "appointments_insert" ON public.appointments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = appointments.branch_id)
  )
);
CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = appointments.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = appointments.branch_id)
  )
);
CREATE POLICY "appointments_delete" ON public.appointments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = appointments.branch_id)
  )
);

-- == leads ==
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = leads.branch_id)
  )
);
CREATE POLICY "leads_insert" ON public.leads FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = leads.branch_id)
  )
);
CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = leads.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = leads.branch_id)
  )
);
CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = leads.branch_id)
  )
);

-- == followup_queue ==
CREATE POLICY "followup_queue_select" ON public.followup_queue FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_queue.branch_id)
  )
);
CREATE POLICY "followup_queue_insert" ON public.followup_queue FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_queue.branch_id)
  )
);
CREATE POLICY "followup_queue_update" ON public.followup_queue FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_queue.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_queue.branch_id)
  )
);
CREATE POLICY "followup_queue_delete" ON public.followup_queue FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_queue.branch_id)
  )
);

-- == followup_logs ==
CREATE POLICY "followup_logs_select" ON public.followup_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_logs.branch_id)
  )
);
CREATE POLICY "followup_logs_insert" ON public.followup_logs FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_logs.branch_id)
  )
);
CREATE POLICY "followup_logs_update" ON public.followup_logs FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_logs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_logs.branch_id)
  )
);
CREATE POLICY "followup_logs_delete" ON public.followup_logs FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = followup_logs.branch_id)
  )
);

-- == coupon_usage_logs ==
CREATE POLICY "coupon_usage_logs_select" ON public.coupon_usage_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = coupon_usage_logs.branch_id)
  )
);
CREATE POLICY "coupon_usage_logs_insert" ON public.coupon_usage_logs FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = coupon_usage_logs.branch_id)
  )
);
CREATE POLICY "coupon_usage_logs_update" ON public.coupon_usage_logs FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = coupon_usage_logs.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = coupon_usage_logs.branch_id)
  )
);
CREATE POLICY "coupon_usage_logs_delete" ON public.coupon_usage_logs FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND (users.role = 'owner' OR users.branch_id = coupon_usage_logs.branch_id)
  )
);

-- == transaction_items (Child - mewarisi isolasi transactions) ==
CREATE POLICY "transaction_items_policy" ON public.transaction_items FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.id = transaction_items.transaction_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transactions.id = transaction_items.transaction_id
  )
);

-- == appointment_treatments (Child - mewarisi isolasi appointments) ==
CREATE POLICY "appointment_treatments_policy" ON public.appointment_treatments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.appointments
    WHERE appointments.id = appointment_treatments.appointment_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.appointments
    WHERE appointments.id = appointment_treatments.appointment_id
  )
);


-- --------------------------------------------------------------------
-- 6. KATEGORI C - GLOBAL READ, OWNER-ONLY WRITE
-- --------------------------------------------------------------------

-- == products ==
CREATE POLICY "products_select" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON public.products FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'owner')
);

-- == coupon_packages ==
CREATE POLICY "coupon_packages_select" ON public.coupon_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY "coupon_packages_write" ON public.coupon_packages FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'owner')
);

-- == coupon_package_items (Child) ==
CREATE POLICY "coupon_package_items_policy" ON public.coupon_package_items FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.coupon_packages
    WHERE coupon_packages.id = coupon_package_items.package_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.coupon_packages
    WHERE coupon_packages.id = coupon_package_items.package_id
  )
);


-- --------------------------------------------------------------------
-- 7. KATEGORI D - TABEL USERS (Diisolasi Cabang untuk non-owner)
-- --------------------------------------------------------------------
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users AS cu
    WHERE cu.id = auth.uid()
    AND (
      cu.role = 'owner' 
      OR cu.branch_id = users.branch_id 
      OR users.role = 'owner'
    )
  )
);

CREATE POLICY "users_insert" ON public.users FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users AS cu
    WHERE cu.id = auth.uid()
    AND cu.role = 'owner'
  )
);

CREATE POLICY "users_update" ON public.users FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users AS cu
    WHERE cu.id = auth.uid()
    AND (cu.role = 'owner' OR cu.id = users.id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users AS cu
    WHERE cu.id = auth.uid()
    AND (cu.role = 'owner' OR cu.id = users.id)
  )
);

CREATE POLICY "users_delete" ON public.users FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users AS cu
    WHERE cu.id = auth.uid()
    AND cu.role = 'owner'
  )
);
