-- ====================================================================
-- MIGRATION: Pengamanan View Database (Security Invoker)
-- Tujuan: Mencegah kebocoran data publik dengan memaksa view mematuhi RLS tabel dasarnya.
-- ====================================================================

-- 1. Mengamankan View Dashboard Utama
ALTER VIEW public.dashboard_today_view SET (security_invoker = true);

-- 2. Mengamankan View Status Pasien CRM
ALTER VIEW public.patient_status_view SET (security_invoker = true);
