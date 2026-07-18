-- 1. Add branch_code column to public.branches
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS branch_code VARCHAR(5);

-- 2. Populate branch codes manually for existing branches
UPDATE public.branches SET branch_code = 'CIA' WHERE id = '6bc44a26-f7f3-4ea7-8902-a2c48e27b598'; -- Ayumi Ciamis
UPDATE public.branches SET branch_code = 'BAN' WHERE id = 'c4f02158-921a-4f8b-a4bc-5a98394dc35e'; -- Ayumi Banjar
UPDATE public.branches SET branch_code = 'TAS' WHERE id = '964eaa28-e905-430a-b3da-38e48dcbb813'; -- Ayumi Tasikmalaya

-- 3. Enforce NOT NULL constraint on branch_code for future branch additions
ALTER TABLE public.branches ALTER COLUMN branch_code SET NOT NULL;
