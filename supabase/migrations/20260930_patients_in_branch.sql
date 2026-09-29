-- Filter daftar pasien per cabang, dijalankan di database.
--
-- Halaman daftar pasien sebelumnya mengumpulkan ID semua pasien yang pernah
-- datang ke sebuah cabang, lalu mengirimnya sebagai daftar panjang di alamat
-- permintaan. Sejak data GD Cashier masuk, daftar itu mencapai ribuan ID
-- (Banjar 5.045 pasien, ±182 KB) dan permintaannya ditolak server, sehingga
-- filter cabang di daftar pasien gagal total di ketiga cabang.
--
-- Fungsi ini menerapkan aturan yang sama persis -- pasien terdaftar di cabang
-- tersebut, ATAU pernah punya rekam tindakan di sana, ATAU pernah bertransaksi
-- di sana -- tetapi penyaringannya dikerjakan database, jadi tidak ada lagi
-- daftar ID yang dikirim lewat alamat.
--
-- Mengembalikan baris tabel patients apa adanya, sehingga halaman tetap bisa
-- memilih kolom, menyertakan relasi, mengurutkan, mencari, dan membagi halaman
-- seperti sebelumnya.
--
-- SECURITY INVOKER: mengikuti hak dan RLS pengguna yang memanggil, sama seperti
-- membaca tabel patients secara langsung. Indeks patient_id pada
-- treatment_records dan transactions sudah tersedia.
--
-- Hanya menambah satu fungsi. Tidak ada data atau tabel yang diubah.

CREATE OR REPLACE FUNCTION public.patients_in_branch(p_branch_id uuid)
RETURNS SETOF public.patients
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT p.*
    FROM public.patients p
    WHERE p.branch_id = p_branch_id
       OR EXISTS (
            SELECT 1 FROM public.treatment_records tr
            WHERE tr.patient_id = p.id AND tr.branch_id = p_branch_id
       )
       OR EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.patient_id = p.id AND t.branch_id = p_branch_id
       )
$$;

-- Hanya pengguna yang sudah login yang boleh memanggil.
REVOKE ALL ON FUNCTION public.patients_in_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.patients_in_branch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.patients_in_branch(uuid) TO authenticated;
