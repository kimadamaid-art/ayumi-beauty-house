-- 1. Create check_therapist_overlap function for trigger validation
CREATE OR REPLACE FUNCTION public.check_therapist_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_overlap_id UUID;
    v_overlap_start TIME;
    v_overlap_end TIME;
    v_therapist_name VARCHAR;
BEGIN
    -- Skip check if therapist_id is NULL
    IF NEW.therapist_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Skip check if the new status is 'cancelled'
    IF NEW.status = 'cancelled' THEN
        RETURN NEW;
    END IF;

    -- Check for overlapping appointments (same therapist, same date, same branch, non-cancelled)
    SELECT a.id, a.start_time, a.end_time INTO v_overlap_id, v_overlap_start, v_overlap_end
    FROM public.appointments a
    WHERE a.therapist_id = NEW.therapist_id
      AND a.appointment_date = NEW.appointment_date
      AND a.branch_id = NEW.branch_id
      AND a.status <> 'cancelled'
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id)
      -- Overlap logic: (start_baru < end_lama) AND (end_baru > start_lama)
      AND (NEW.start_time < a.end_time AND NEW.end_time > a.start_time)
    LIMIT 1;

    -- If an overlap is found, raise exception with detailed cashier message
    IF v_overlap_id IS NOT NULL THEN
        -- Fetch therapist's full name
        SELECT full_name INTO v_therapist_name
        FROM public.users
        WHERE id = NEW.therapist_id;

        RAISE EXCEPTION 'Terapis % sudah memiliki jadwal lain yang bertabrakan pada jam % - %.',
            COALESCE(v_therapist_name, 'tersebut'),
            to_char(v_overlap_start, 'HH24:MI'),
            to_char(v_overlap_end, 'HH24:MI');
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Create BEFORE INSERT OR UPDATE trigger on public.appointments table
DROP TRIGGER IF EXISTS trg_check_therapist_overlap ON public.appointments;
CREATE TRIGGER trg_check_therapist_overlap
BEFORE INSERT OR UPDATE OF therapist_id, appointment_date, start_time, end_time, status, branch_id
ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.check_therapist_overlap();
