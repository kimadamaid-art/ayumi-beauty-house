-- Tabel Products
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabel Product Stock per cabang
CREATE TABLE IF NOT EXISTS public.product_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    quantity INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(product_id, branch_id)
);

-- Tabel Transactions
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_number VARCHAR NOT NULL UNIQUE,
    patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    treatment_record_id UUID REFERENCES public.treatment_records(id) ON DELETE SET NULL,
    cashier_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    subtotal NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) DEFAULT 0,
    discount_type VARCHAR CHECK (discount_type IN ('nominal', 'percent')),
    total NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR CHECK (payment_method IN ('cash', 'transfer', 'qris', 'debit', 'credit')),
    payment_status VARCHAR CHECK (payment_status IN ('paid', 'unpaid', 'partial')),
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabel Transaction Items
CREATE TABLE IF NOT EXISTS public.transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
    item_type VARCHAR CHECK (item_type IN ('treatment', 'product', 'coupon')),
    treatment_id UUID REFERENCES public.treatments(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name VARCHAR NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    quantity INT DEFAULT 1,
    subtotal NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies (Row Level Security) - Opsional jika tabel lain menggunakan RLS
-- Atur sesuai kebutuhan keamanan sistem (sementara public access atau di-handle via server)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated users" ON public.products FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.product_stock FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.transactions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all for authenticated users" ON public.transaction_items FOR ALL USING (auth.role() = 'authenticated');
