-- Fee penjualan kupon: bonus sekali untuk terapis yang pertama kali menjual /
-- menginput paket kupon. Nominal rupiah per paket, ditentukan owner, dan
-- diisi 0 untuk paket yang memang tidak memberi fee (misalnya paket infus).
--
-- Migrasi ini hanya MENAMBAH tiga kolom. Tidak ada DROP, TRUNCATE, maupun
-- perubahan pada kolom yang sudah ada.

-- 1. Nominal fee per paket. Default 0 berarti paket tidak memberi fee,
--    sehingga seluruh paket yang ada sekarang tidak berubah perilakunya.
ALTER TABLE public.coupon_packages
    ADD COLUMN IF NOT EXISTS seller_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. Siapa yang menjual, dan berapa fee-nya SAAT ITU. Nominal disalin seperti
--    halnya harga dan persen komisi pada item tindakan, supaya kenaikan fee di
--    kemudian hari tidak mengubah laporan periode sebelumnya.
ALTER TABLE public.patient_coupons
    ADD COLUMN IF NOT EXISTS sold_by UUID REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS seller_fee_at_time NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_patient_coupons_sold_by
    ON public.patient_coupons (sold_by);
