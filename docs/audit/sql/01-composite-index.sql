-- ==============================================================================
-- 🚀 SKRIP COMPOSITE INDEX UNTUK SKALABILITAS JANGKA PANJANG (AYUMI BEAUTY HOUSE)
-- ==============================================================================
-- 
-- ⚠️ PERINGATAN PENTING SEBELUM MENJALANKAN:
-- 1. Perintah di bawah menggunakan klausa CONCURRENTLY (agar PostgreSQL TIDAK 
--    mengunci tabel selama pembuatan index — kasir & staf tetap bisa bertransaksi).
-- 2. Di PostgreSQL / Supabase SQL Editor, perintah 'CREATE INDEX CONCURRENTLY' 
--    TIDAK DAPAT dijalankan di dalam blok transaksi multi-perintah sekaligus.
-- 3. JALANKAN SATU PER SATU (blok demi blok) di Supabase SQL Editor.
-- 4. Semua skrip bersifat aman (idempotent) dengan klausa IF NOT EXISTS.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 1. INDEX TRANSAKSI PER CABANG & TANGGAL (PRIORITAS TINGGI)
-- ------------------------------------------------------------------------------
-- Query yang Dipercepat:
-- - app/transactions/page.js: Filter riwayat transaksi per cabang & rentang tanggal.
-- - app/dashboard/page.js: Agregasi omset bulanan & grafik tren penjualan cabang.
-- Pola Query: WHERE branch_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_branch_id_created_at 
ON public.transactions (branch_id, created_at DESC);


-- ------------------------------------------------------------------------------
-- 2. INDEX REKAM MEDIS PER TERAPIS & TANGGAL TINDAKAN (PRIORITAS TINGGI)
-- ------------------------------------------------------------------------------
-- Query yang Dipercepat:
-- - app/therapist/dashboard/page.js: Rekap komisi tindakan terapis harian/bulanan.
-- - app/therapist/appointments/page.js: Tab riwayat tindakan selesai terapis.
-- - app/reports/therapists/page.js: Laporan omset & komisi seluruh terapis.
-- Pola Query: WHERE performed_by = $1 AND treatment_date >= $2 AND treatment_date <= $3 ORDER BY treatment_date DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_treatment_records_performed_by_treatment_date 
ON public.treatment_records (performed_by, treatment_date DESC);


-- ------------------------------------------------------------------------------
-- 3. INDEX REKAM MEDIS PER PASIEN (PRIORITAS TINGGI)
-- ------------------------------------------------------------------------------
-- Query yang Dipercepat:
-- - app/patients/[id]/page.js: Riwayat SOAP & kronologi perawatan profil pasien.
-- - app/treatment-records/page.js: Filter pencarian riwayat medis pasien.
-- - components/ui/TherapistPatientHistoryModal.js: Modal riwayat medis pasien di modul terapis.
-- Pola Query: WHERE patient_id = $1 ORDER BY treatment_date DESC, treatment_time DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_treatment_records_patient_id_treatment_date 
ON public.treatment_records (patient_id, treatment_date DESC);


-- ------------------------------------------------------------------------------
-- 4. INDEX DETAIL ITEM TRANSAKSI KASIR (PRIORITAS TINGGI)
-- ------------------------------------------------------------------------------
-- Query yang Dipercepat:
-- - app/kasir/transactions/[id]/page.js: Cetak invoice & nota belanja kasir.
-- - app/transactions/page.js: Modal rincian nota & kalkulasi item produk/treatment.
-- - process_checkout RPC: Pemrosesan breakdown item per invoice.
-- Pola Query: WHERE transaction_id = $1 (dengan filter / pengelompokan item_type)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_items_transaction_id_item_type 
ON public.transaction_items (transaction_id, item_type);


-- ==============================================================================
-- 💡 USULAN INDEX TAMBAHAN (BERDASARKAN AUDIT QUERY MODUL LAIN)
-- ==============================================================================
-- Index di bawah ini sangat disarankan untuk menjaga performa antrean & stok:

-- Usulan A. Index Janji Temu Cabang & Timeline Jam
-- Query yang Dipercepat:
-- - app/appointments/page.js & app/dashboard/page.js: Antrean janji temu harian.
-- Pola Query: WHERE branch_id = $1 AND appointment_date = $2 ORDER BY start_time ASC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_branch_id_appointment_date_start_time 
ON public.appointments (branch_id, appointment_date, start_time);


-- Usulan B. Index Pencarian & Penguncian Stok Produk Cabang
-- Query yang Dipercepat:
-- - process_checkout RPC: Row locking (SELECT ... FOR UPDATE) saat kasir checkout.
-- - app/settings/products/page.js: Tabel stok produk per cabang.
-- Pola Query: WHERE product_id = $1 AND branch_id = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_stock_branch_id_product_id 
ON public.product_stock (branch_id, product_id);


-- Usulan C. Index Antrean Follow-up CRM WhatsApp
-- Query yang Dipercepat:
-- - app/crm/page.js: Pengambilan antrean reminder follow-up H+3 dan recall H+14.
-- Pola Query: WHERE status = 'pending' AND followup_date <= $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_followup_queue_status_followup_date 
ON public.followup_queue (status, followup_date);


-- ==============================================================================
-- 🔄 SKRIP ROLLBACK (JALANKAN HANYA JIKA INGIN MENGHAPUS INDEX)
-- ==============================================================================
-- Jika sewaktu-waktu ingin membatalkan / menghapus index di atas, 
-- jalankan perintah di bawah ini satu per satu:
--
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_transactions_branch_id_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_treatment_records_performed_by_treatment_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_treatment_records_patient_id_treatment_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_transaction_items_transaction_id_item_type;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_appointments_branch_id_appointment_date_start_time;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_product_stock_branch_id_product_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_followup_queue_status_followup_date;
