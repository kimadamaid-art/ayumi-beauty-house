-- ====================================================================
-- MIGRATION: Ubah View Menjadi Security Invoker
-- View yang dimodifikasi:
--   1. public.dashboard_today_view
--   2. public.patient_status_view
-- ====================================================================

ALTER VIEW public.dashboard_today_view SET (security_invoker = true);
ALTER VIEW public.patient_status_view SET (security_invoker = true);
