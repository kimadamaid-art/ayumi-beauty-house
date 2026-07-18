-- ====================================================================
-- MIGRATION: Update RLS Policy for products Table
-- Deskripsi: Mengizinkan role 'admin' selain 'owner' untuk menambah dan
--            mengedit data produk (Master Produk) secara global.
-- ====================================================================

-- Ganti policy products_write agar memperbolehkan Owner dan Admin
DROP POLICY IF EXISTS "products_write" ON public.products;

CREATE POLICY "products_write" ON public.products FOR ALL TO authenticated
USING (
  public.get_my_role() = 'owner' OR public.get_my_role() = 'admin'
);
