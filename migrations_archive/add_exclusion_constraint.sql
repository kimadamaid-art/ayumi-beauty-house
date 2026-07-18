-- 1. Enable the btree_gist extension (required for EXCLUDE constraint with scalar types like UUID and Date)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Add EXCLUDE constraint to prevent overlapping therapist appointments
-- Uses GIST index to enforce: no two rows can have the same therapist, date, and branch, and overlapping time range.
ALTER TABLE public.appointments
ADD CONSTRAINT no_therapist_overlap
EXCLUDE USING gist (
  therapist_id WITH =,
  appointment_date WITH =,
  branch_id WITH =,
  tsrange( (appointment_date + start_time), (appointment_date + end_time) ) WITH &&
) WHERE (status <> 'cancelled' AND therapist_id IS NOT NULL);
