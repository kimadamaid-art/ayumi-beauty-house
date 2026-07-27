-- Migration to update check constraint on followup_queue to support all CRM stage types
ALTER TABLE public.followup_queue 
    DROP CONSTRAINT IF EXISTS followup_queue_followup_type_check;

ALTER TABLE public.followup_queue 
    ADD CONSTRAINT followup_queue_followup_type_check 
    CHECK (followup_type IN (
        'followup_2minggu', 
        'followup_3minggu', 
        'followup_1bulan', 
        'treatment_reminder', 
        'reminder_besok', 
        'dormant_reminder', 
        'birthday'
    ));
