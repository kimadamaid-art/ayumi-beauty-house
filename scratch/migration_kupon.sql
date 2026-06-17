-- Tabel coupon_packages (Master Paket Kupon)
CREATE TABLE IF NOT EXISTS public.coupon_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    price NUMERIC(12, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabel coupon_package_items (Isi Paket)
CREATE TABLE IF NOT EXISTS public.coupon_package_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES public.coupon_packages(id) ON DELETE CASCADE,
    treatment_id UUID REFERENCES public.treatments(id) ON DELETE CASCADE,
    quantity INT NOT NULL,
    price_per_item NUMERIC DEFAULT 0,
    sort_order INT DEFAULT 0
);

-- Tabel patient_coupons (Kupon Milik Pasien)
CREATE TABLE IF NOT EXISTS public.patient_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    package_id UUID REFERENCES public.coupon_packages(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    purchased_at TIMESTAMPTZ DEFAULT now(),
    expired_at TIMESTAMPTZ NOT NULL,
    status VARCHAR CHECK (status IN ('active', 'expired', 'fully_used')) DEFAULT 'active',
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabel patient_coupon_items (Detail Kupon Pasien)
CREATE TABLE IF NOT EXISTS public.patient_coupon_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_coupon_id UUID REFERENCES public.patient_coupons(id) ON DELETE CASCADE,
    coupon_package_item_id UUID REFERENCES public.coupon_package_items(id) ON DELETE CASCADE,
    treatment_id UUID REFERENCES public.treatments(id) ON DELETE CASCADE,
    total_sessions INT NOT NULL,
    used_sessions INT DEFAULT 0,
    remaining_sessions INT NOT NULL,
    status VARCHAR CHECK (status IN ('active', 'fully_used')) DEFAULT 'active'
);

-- Tabel coupon_usage_logs (Log Pemakaian Kupon)
CREATE TABLE IF NOT EXISTS public.coupon_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_coupon_item_id UUID REFERENCES public.patient_coupon_items(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    treatment_record_id UUID REFERENCES public.treatment_records(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ DEFAULT now(),
    used_by UUID REFERENCES public.users(id),
    notes TEXT
);

-- RLS Policies
ALTER TABLE public.coupon_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_coupon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users" ON public.coupon_packages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.coupon_package_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.patient_coupons FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.patient_coupon_items FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.coupon_usage_logs FOR ALL USING (auth.role() = 'authenticated');

-- SEED DATA CONTOH
-- (Ganti UUID user dengan admin yang valid jika diperlukan, atau set NULL)
-- Harga diset 0, bisa diatur lewat aplikasi
INSERT INTO public.coupon_packages (name, category, price) VALUES
('PRP 3x', 'VIP', 0),
('PRP 6x', 'VIP', 0),
('3x Infused Whitening', 'VIP', 0),
('6x Infused Whitening', 'VIP', 0),
('Infused Sliming 3x', 'VIP', 0),
('Infused Sliming 6x', 'VIP', 0),
('Oxy Detox 3x', 'VIP', 0),
('Oxy Detox 6x', 'VIP', 0);

-- Catatan: Untuk memasukkan `coupon_package_items` (isi paket), 
-- admin harus menautkan ke ID `treatments` melalui aplikasi.
