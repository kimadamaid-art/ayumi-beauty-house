-- 1. Buat tabel notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('patient_arrived', 'therapist_ready', 'general')),
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tambahkan kolom di tabel appointments jika belum ada
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS arrival_status VARCHAR(50) DEFAULT 'not_arrived' 
CHECK (arrival_status IN ('not_arrived', 'arrived', 'therapist_ready', 'in_treatment'));

ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS therapist_ready_at TIMESTAMPTZ;

-- 3. Aktifkan RLS untuk tabel notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Buat policy RLS agar user yang login bisa melihat/mengubah notifikasi mereka sendiri
CREATE POLICY "Users can view their own notifications" 
ON public.notifications 
FOR SELECT 
USING (auth.uid() = recipient_id);

CREATE POLICY "Users can update their own notifications" 
ON public.notifications 
FOR UPDATE 
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);

-- Kebijakan agar user terotentikasi bisa membuat notifikasi baru (untuk alur trigger)
CREATE POLICY "Authenticated users can insert notifications" 
ON public.notifications 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- 4. Enable Supabase Realtime untuk tabel notifications dan appointments
-- Pastikan tabel masuk ke dalam publikasi realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
-- (Jika tabel appointments belum masuk ke publikasi realtime, jalankan perintah di bawah)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
