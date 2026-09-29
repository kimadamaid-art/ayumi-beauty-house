-- Terapis boleh membaca transaksi atas tindakan yang ia kerjakan sendiri,
-- di cabang mana pun.
--
-- Aturan rekam tindakan dan janji temu sudah punya pengecualian untuk pelaksana
-- (performed_by / therapist_id = auth.uid()), tetapi aturan transaksi belum:
-- terapis hanya bisa membaca transaksi cabang penempatannya.
--
-- Dashboard terapis menghitung komisi hanya dari tindakan yang transaksinya
-- terlihat lunas. Akibatnya komisi atas pekerjaan di cabang lain tidak tampil di
-- layar terapis sendiri, padahal laporan owner menampilkannya dengan benar.
-- Terukur pada data 2026: Elsa Rp 11.124.008, Rana Rp 5.923.195, Raika
-- Rp 148.600, Asti Rp 83.800 tidak terlihat oleh terapis yang bersangkutan.
--
-- Aturan ini hanya MENAMBAH izin baca, dan terbatas pada transaksi yang terhubung
-- dengan rekam tindakan yang dikerjakan terapis itu sendiri. Transaksi lain di
-- cabang lain tetap tidak terlihat. Aturan permissive digabung dengan OR,
-- sehingga izin yang sudah ada untuk owner dan admin tidak berubah.
--
-- Tidak ada DROP dan tidak ada data yang diubah.

CREATE POLICY "Therapist reads transactions of own treatments"
    ON public.transactions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.treatment_records tr
            WHERE tr.id = transactions.treatment_record_id
              AND tr.performed_by = auth.uid()
        )
    );
