-- CRM "Target Treatment": follow-up pasien berdasarkan treatment tertentu.
--
-- Isi migrasi (hanya MENAMBAH; tidak ada data yang diubah atau dihapus):
--   1. Index untuk mencari item treatment per jenis treatment, dan untuk membaca log
--      follow-up serta antrean per pasien.
--   2. Kolom followup_logs.treatment_id (boleh kosong) + jenis log 'treatment_specific'.
--   3. Fungsi crm_treatment_targets(...) yang mengolah daftar pasien di database dan
--      hanya mengembalikan satu halaman hasil beserta jumlah totalnya.
--
-- Pembatalan: 20261001_crm_treatment_targets_ROLLBACK.sql
--
-- PRA-CEK (jalankan dulu). Langkah 2 mengganti aturan jenis log; semua jenis yang
-- sudah ada di tabel harus termasuk daftar baru. Hasil query ini hanya boleh berisi
-- treatment_reminder, birthday, dormant_reactivation, dan/atau manual:
--
--   SELECT followup_type, count(*) FROM public.followup_logs GROUP BY 1 ORDER BY 1;


BEGIN;

-- 1. Index ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_treatment_record_items_treatment_id
    ON public.treatment_record_items (treatment_id);

CREATE INDEX IF NOT EXISTS idx_followup_logs_patient_performed
    ON public.followup_logs (patient_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_followup_queue_patient_status
    ON public.followup_queue (patient_id, status);

-- 2. Log follow-up per treatment ---------------------------------------------------------
ALTER TABLE public.followup_logs
    ADD COLUMN IF NOT EXISTS treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL;

ALTER TABLE public.followup_logs DROP CONSTRAINT IF EXISTS followup_logs_followup_type_check;
ALTER TABLE public.followup_logs ADD CONSTRAINT followup_logs_followup_type_check
    CHECK (followup_type IN ('treatment_reminder', 'birthday', 'dormant_reactivation', 'manual', 'treatment_specific'));

-- 3. Fungsi daftar target ---------------------------------------------------------------
--
-- Aturan:
--   * Hari dihitung dari tanggal terakhir pasien mengambil salah satu treatment yang
--     dipilih, terhadap tanggal hari ini WIB.
--   * Cabang = cabang tempat treatment terakhir itu dilakukan.
--   * Rekam treatment yang notanya di-VOID diabaikan.
--   * Hanya pasien aktif.
--   * p_min_days / p_max_days: batas umur treatment terakhir (inklusif), NULL = tanpa batas.
--   * p_due_by_followup = true: hanya pasien yang sudah melewati followup_days treatment
--     terakhirnya (jadwal ulang bawaan tiap treatment).
--   * Pencarian: nama (tanpa beda huruf besar/kecil) atau nomor WA (08.. dianggap 628..).
--   * Urutan: treatment paling baru dulu.
--
-- SECURITY INVOKER: memakai hak akses pemanggil. Admin hanya melihat rekam treatment,
-- log, dan antrean cabangnya sendiri; owner melihat semua cabang.
CREATE OR REPLACE FUNCTION public.crm_treatment_targets(
    p_treatment_ids    uuid[],
    p_branch_id        uuid    DEFAULT NULL,
    p_min_days         integer DEFAULT NULL,
    p_max_days         integer DEFAULT NULL,
    p_due_by_followup  boolean DEFAULT false,
    p_search           text    DEFAULT NULL,
    p_limit            integer DEFAULT 50,
    p_offset           integer DEFAULT 0
)
RETURNS TABLE (
    patient_id                uuid,
    full_name                 text,
    whatsapp                  text,
    branch_id                 uuid,
    branch_name               text,
    last_treatment_id         uuid,
    last_treatment_name       text,
    followup_days             integer,
    last_treatment_date       date,
    days_since                integer,
    times_taken               integer,
    last_visit_date           date,
    last_visit_days           integer,
    last_contact_at           timestamptz,
    last_contact_outcome      text,
    last_contact_type         text,
    last_treatment_contact_at timestamptz,
    in_queue                  boolean,
    total_count               bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    WITH params AS (
        SELECT
            (now() AT TIME ZONE 'Asia/Jakarta')::date AS today,
            NULLIF(btrim(coalesce(p_search, '')), '') AS q,
            CASE
                WHEN regexp_replace(coalesce(p_search, ''), '\D', '', 'g') ~ '^0'
                    THEN '62' || substr(regexp_replace(p_search, '\D', '', 'g'), 2)
                ELSE NULLIF(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '')
            END AS q_digits
    ),
    hits AS (
        SELECT tr.id AS record_id, tr.patient_id, tr.treatment_date, tr.treatment_time,
               tr.branch_id, tri.treatment_id
        FROM public.treatment_record_items tri
        JOIN public.treatment_records tr ON tr.id = tri.treatment_record_id
        WHERE tri.treatment_id = ANY (p_treatment_ids)
          AND tr.patient_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM public.transactions t
                WHERE t.treatment_record_id = tr.id AND t.payment_status = 'void'
          )
    ),
    last_hit AS (
        SELECT DISTINCT ON (h.patient_id)
               h.patient_id, h.treatment_date, h.branch_id, h.treatment_id
        FROM hits h
        ORDER BY h.patient_id, h.treatment_date DESC, h.treatment_time DESC NULLS LAST, h.record_id DESC
    ),
    times AS (
        SELECT h.patient_id, count(DISTINCT h.record_id)::integer AS times_taken
        FROM hits h
        GROUP BY h.patient_id
    ),
    page AS (
        SELECT lh.patient_id,
               p.full_name::text AS full_name,
               p.whatsapp::text  AS whatsapp,
               lh.branch_id,
               b.name::text      AS branch_name,
               lh.treatment_id   AS last_treatment_id,
               t.name::text      AS last_treatment_name,
               t.followup_days,
               lh.treatment_date AS last_treatment_date,
               (pr.today - lh.treatment_date) AS days_since,
               tm.times_taken,
               count(*) OVER () AS total_count
        FROM last_hit lh
        CROSS JOIN params pr
        JOIN public.patients p   ON p.id = lh.patient_id
        JOIN times tm            ON tm.patient_id = lh.patient_id
        LEFT JOIN public.branches b   ON b.id = lh.branch_id
        LEFT JOIN public.treatments t ON t.id = lh.treatment_id
        WHERE coalesce(p.is_active, true)
          AND (p_branch_id IS NULL OR lh.branch_id = p_branch_id)
          AND (p_min_days IS NULL OR pr.today - lh.treatment_date >= p_min_days)
          AND (p_max_days IS NULL OR pr.today - lh.treatment_date <= p_max_days)
          AND (NOT p_due_by_followup OR pr.today - lh.treatment_date >= coalesce(t.followup_days, 30))
          AND (
                pr.q IS NULL
             OR strpos(lower(p.full_name), lower(pr.q)) > 0
             OR (length(pr.q_digits) >= 3 AND strpos(coalesce(p.whatsapp, ''), pr.q_digits) > 0)
          )
        ORDER BY lh.treatment_date DESC, p.full_name
        LIMIT greatest(coalesce(p_limit, 50), 1)
        OFFSET greatest(coalesce(p_offset, 0), 0)
    )
    -- Kunjungan terakhir, kontak terakhir, dan antrean hanya dicari untuk baris di
    -- halaman ini, bukan untuk seluruh pasien.
    SELECT pg.patient_id, pg.full_name, pg.whatsapp, pg.branch_id, pg.branch_name,
           pg.last_treatment_id, pg.last_treatment_name, pg.followup_days,
           pg.last_treatment_date, pg.days_since, pg.times_taken,
           lv.last_visit_date,
           (pr.today - lv.last_visit_date) AS last_visit_days,
           lc.performed_at  AS last_contact_at,
           lc.outcome::text AS last_contact_outcome,
           lc.followup_type::text AS last_contact_type,
           ltc.performed_at AS last_treatment_contact_at,
           EXISTS (
               SELECT 1 FROM public.followup_queue fq
               WHERE fq.patient_id = pg.patient_id AND fq.status IN ('pending', 'rescheduled')
           ) AS in_queue,
           pg.total_count
    FROM page pg
    CROSS JOIN params pr
    LEFT JOIN LATERAL (
        SELECT max(tr.treatment_date) AS last_visit_date
        FROM public.treatment_records tr
        WHERE tr.patient_id = pg.patient_id
    ) lv ON true
    LEFT JOIN LATERAL (
        SELECT fl.performed_at, fl.outcome, fl.followup_type
        FROM public.followup_logs fl
        WHERE fl.patient_id = pg.patient_id
        ORDER BY fl.performed_at DESC
        LIMIT 1
    ) lc ON true
    LEFT JOIN LATERAL (
        SELECT fl.performed_at
        FROM public.followup_logs fl
        WHERE fl.patient_id = pg.patient_id
          AND fl.treatment_id = ANY (p_treatment_ids)
        ORDER BY fl.performed_at DESC
        LIMIT 1
    ) ltc ON true
    ORDER BY pg.last_treatment_date DESC, pg.full_name;
$$;

REVOKE ALL ON FUNCTION public.crm_treatment_targets(uuid[], uuid, integer, integer, boolean, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_treatment_targets(uuid[], uuid, integer, integer, boolean, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_treatment_targets(uuid[], uuid, integer, integer, boolean, text, integer, integer) TO authenticated;

COMMIT;
