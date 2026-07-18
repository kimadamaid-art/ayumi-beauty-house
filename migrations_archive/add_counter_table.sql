-- Create daily_transaction_counters table to manage contiguous daily transaction numbers per branch.
CREATE TABLE IF NOT EXISTS public.daily_transaction_counters (
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    counter_date DATE DEFAULT CURRENT_DATE,
    last_number INT DEFAULT 0,
    PRIMARY KEY (branch_id, counter_date)
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.daily_transaction_counters ENABLE ROW LEVEL SECURITY;

-- Revoke direct permissions from authenticated and anon roles to enforce RPC-only access
REVOKE ALL PRIVILEGES ON TABLE public.daily_transaction_counters FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.daily_transaction_counters FROM anon;
