-- Menutup kebocoran data pasien lewat view.
--
-- Di Postgres, view dijalankan dengan hak pemiliknya, sehingga aturan RLS tabel
-- di belakangnya terlewati. Akibatnya patient_status_view dan dashboard_today_view
-- di Singapura bisa dibaca tanpa login (4.131 baris: nama, WhatsApp, tanggal lahir),
-- padahal tabel patients sendiri sudah dicabut aksesnya dari anon.
--
-- Di Tokyo kedua view ini menolak akses anon. Perintah di bawah menyamakan
-- perilakunya: security_invoker membuat view mengikuti hak dan RLS pengguna yang
-- bertanya, bukan hak pemilik view.
--
-- Hanya mengubah setelan view. Tidak ada data yang diubah atau dihapus, dan tidak
-- ada satu pun halaman aplikasi yang memakai kedua view ini.

ALTER VIEW public.patient_status_view SET (security_invoker = on);
ALTER VIEW public.dashboard_today_view SET (security_invoker = on);

-- Pengguna yang belum login tidak berkepentingan dengan kedua view ini,
-- sama seperti tabel patients dan workers yang aksesnya sudah dicabut.
REVOKE ALL ON public.patient_status_view FROM anon;
REVOKE ALL ON public.dashboard_today_view FROM anon;
