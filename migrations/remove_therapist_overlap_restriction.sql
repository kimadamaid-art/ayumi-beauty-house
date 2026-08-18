-- Migration: Remove Therapist Overlap Constraint / Trigger
-- Mengizinkan terapis menangani lebih dari 1 pasien / jadwal temu pada jam yang sama secara fleksibel

-- 1. Hapus trigger pengecekan bentrok jadwal terapis pada tabel appointments
DROP TRIGGER IF EXISTS trg_check_therapist_overlap ON public.appointments;

-- 2. Hapus function pengecekan bentrok jadwal terapis
DROP FUNCTION IF EXISTS public.check_therapist_overlap();

-- 3. Pastikan tidak ada constraint exclusion bentrok pada appointments
ALTER TABLE IF EXISTS public.appointments 
DROP CONSTRAINT IF EXISTS no_therapist_overlap;
