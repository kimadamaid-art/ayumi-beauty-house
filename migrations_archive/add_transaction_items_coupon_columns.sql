-- Add missing columns to transaction_items table
-- These columns track original price and discount for coupon-based treatments

ALTER TABLE public.transaction_items 
    ADD COLUMN IF NOT EXISTS original_price NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2) DEFAULT 0;

-- Backfill existing rows: set original_price = price, discount_percent = 0 where not set
UPDATE public.transaction_items
SET 
    original_price = price,
    discount_percent = 0,
    commission_percent = 0
WHERE original_price IS NULL OR original_price = 0;
