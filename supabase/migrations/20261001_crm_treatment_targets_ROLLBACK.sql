-- Membatalkan 20261001_crm_treatment_targets.sql.
--
-- PERHATIAN: kalau fitur Target Treatment sudah dipakai, sudah ada log berjenis
-- 'treatment_specific'. Aturan jenis log lama tidak mengizinkannya, jadi log itu
-- diubah dulu menjadi 'manual' (catatan & waktunya tetap), dan kolom treatment_id
-- beserta isinya ikut hilang.

BEGIN;

DROP FUNCTION IF EXISTS public.crm_treatment_targets(uuid[], uuid, integer, integer, boolean, text, integer, integer);

UPDATE public.followup_logs SET followup_type = 'manual' WHERE followup_type = 'treatment_specific';

ALTER TABLE public.followup_logs DROP CONSTRAINT IF EXISTS followup_logs_followup_type_check;
ALTER TABLE public.followup_logs ADD CONSTRAINT followup_logs_followup_type_check
    CHECK (followup_type IN ('treatment_reminder', 'birthday', 'dormant_reactivation', 'manual'));

ALTER TABLE public.followup_logs DROP COLUMN IF EXISTS treatment_id;

DROP INDEX IF EXISTS public.idx_followup_queue_patient_status;
DROP INDEX IF EXISTS public.idx_followup_logs_patient_performed;
DROP INDEX IF EXISTS public.idx_treatment_record_items_treatment_id;

COMMIT;
