'use client'

import Link from 'next/link'
import { getCouponRedeemItemIds } from '@/lib/couponRedeem'
import { getProductOriginalPrice } from '@/lib/productVariants'

/**
 * Modal detail transaksi di halaman Transaksi: rincian nota, edit, void,
 * hapus, kirim WA, dan cetak. Hanya tampilan; semua state dan handler
 * tetap berada di app/transactions/page.js.
 */
export default function TransactionDetailModal({
    selectedTx,
    dbUser,
    productCatalogMap,
    isEditingTx,
    setIsEditingTx,
    editTxData,
    setEditTxData,
    isDeletingTx,
    closeDetailModal,
    handleSaveEditedTx,
    handleVoidTx,
    handleDeleteTx,
    handleSendWA,
    formatCurrency,
    formatDate,
    formatGenderAge,
    getCleanTxPricing,
    getCustomerStatus
}) {
    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-pink-100 flex flex-col max-h-[90vh]">
                {/* Modal Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-pink-50/30">
                    <div>
                        <h3 className="font-extrabold text-ayumi-secondary text-sm">Rincian Transaksi</h3>
                        <p className="text-[10px] text-gray-400 font-bold tracking-wider uppercase ">{selectedTx.transaction_number}</p>
                    </div>
                    <button
                        onClick={closeDetailModal}
                        className="text-gray-400 hover:text-gray-600 bg-white p-1.5 rounded-full border border-gray-100 shadow-sm"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Modal Content - Scrollable */}
                <div className="p-4 md:p-6 overflow-y-auto space-y-4 text-xs font-semibold text-gray-700 flex-1">
                    {/* Void Banner Notice */}
                    {selectedTx.payment_status === 'void' && (
                        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5 text-rose-800">
                            <span className="text-rose-600 text-lg leading-none">🚫</span>
                            <div>
                                <p className="font-black text-rose-900 text-xs tracking-wide">STATUS: DIBATALKAN (VOID)</p>
                                <p className="text-[11px] font-medium text-rose-700 mt-0.5 leading-relaxed">
                                    Transaksi ini telah dibatalkan dan tidak dihitung ke pendapatan/omzet klinik.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Transaction Info Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-b border-dashed border-gray-200 pb-3">
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase">Tanggal (Terkunci)</span>
                            <span className="text-gray-800 font-bold">{formatDate(selectedTx.created_at)}</span>
                        </div>
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase">Kasir</span>
                            <span className="font-semibold text-gray-800">{selectedTx.users?.full_name || 'System Admin'}</span>
                        </div>
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase">Terapis Pelaksana</span>
                            <span className="font-semibold text-gray-800">
                                {selectedTx.treatment_records?.therapist?.full_name || '-'}
                            </span>
                        </div>
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase">Klinik Cabang</span>
                            <span className="font-semibold text-gray-800">{selectedTx.branches?.name || '-'}</span>
                        </div>
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase">Metode Pembayaran</span>
                            {isEditingTx ? (
                                <select
                                    value={editTxData.payment_method}
                                    onChange={(e) => setEditTxData(prev => ({ ...prev, payment_method: e.target.value }))}
                                    className="w-full p-1 border rounded text-[10px] focus:outline-none focus:border-ayumi-primary font-bold uppercase text-ayumi-primary bg-white"
                                >
                                    <option value="cash">CASH</option>
                                    <option value="transfer">TRANSFER</option>
                                    <option value="qris">QRIS</option>
                                    <option value="debit">DEBIT</option>
                                    <option value="credit">CREDIT</option>
                                </select>
                            ) : (
                                <span className="uppercase text-ayumi-primary font-bold">{selectedTx.payment_method}</span>
                            )}
                        </div>
                    </div>

                    {/* Patient Info */}
                    <div className="bg-gray-50/70 p-3 rounded-xl border border-gray-100 flex items-center justify-between gap-2">
                        <div>
                            <span className="block text-[9px] text-gray-400 font-bold uppercase mb-0.5">Informasi Pasien</span>
                            <div className="flex items-center gap-2">
                                <p className="font-extrabold text-gray-800 text-sm">{selectedTx.patients?.full_name || 'Walk-in Customer'}</p>
                                {(() => {
                                    const s = getCustomerStatus(selectedTx)
                                    return (
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.badgeClass}`}>
                                            {s.fullLabel || s.label}
                                        </span>
                                    )
                                })()}
                            </div>
                            {selectedTx.patients?.whatsapp && (
                                <p className="text-[10px] text-gray-500 mt-0.5">WhatsApp: {selectedTx.patients.whatsapp}</p>
                            )}
                            {formatGenderAge(selectedTx.patients) && (
                                <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
                                    Profil: <span className="text-gray-700 font-bold">{formatGenderAge(selectedTx.patients)}</span>
                                </p>
                            )}
                        </div>
                        {selectedTx.patient_id && (
                            <Link
                                href={`/patients/${selectedTx.patient_id}`}
                                className="px-3.5 py-2 bg-pink-50 hover:bg-pink-100 text-ayumi-primary text-xs font-extrabold rounded-xl transition-colors border border-pink-200 shrink-0 flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
                                title="Buka Rekam Medis & Riwayat Lengkap Pasien"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                <span>Buka Riwayat Pasien</span>
                                <span>↗</span>
                            </Link>
                        )}
                    </div>

                    {/* Itemized Table */}
                    <div>
                        <span className="block text-[9px] text-gray-400 font-bold uppercase mb-2">Item Belanja</span>
                        <div className="space-y-2">
                            {selectedTx.transaction_items?.map((item) => {
                                const qty = Number(item.quantity) || 1
                                const charged = Number(item.price) || 0
                                let orig = Number(item.original_price) || 0
                                // Harga katalog/rekam hanya dipakai bila nota tidak menyimpan harga asli,
                                // agar rincian item sama dengan ringkasan (lib/revenueBreakdown.js).
                                if (item.item_type === 'product' && orig <= charged) {
                                    const prod = item.products || productCatalogMap?.get(item.product_id) || productCatalogMap?.get((item.name || '').trim().toLowerCase())
                                    if (prod) {
                                        const pOrig = getProductOriginalPrice(item, prod)
                                        if (pOrig > charged) orig = pOrig
                                    }
                                } else if (item.item_type === 'treatment' && orig <= charged) {
                                    // Rekam treatment hanya dipakai bila nota tidak menyimpan harga asli:
                                    // untuk sesi pertama paket kupon, rekam menyimpan harga paket, bukan harga sesi.
                                    const triList = selectedTx.treatment_records?.treatment_record_items || []
                                    const tri = triList.find(t => (t.treatments?.name || t.notes || '').trim().toLowerCase() === (item.name || '').trim().toLowerCase())
                                    if (tri) {
                                        const tOrig = Number(tri.original_price) || Number(tri.treatments?.price) || Number(tri.price_at_time) || 0
                                        if (tOrig > charged) orig = tOrig
                                    }
                                }
                                const hasItemDisc = orig > charged
                                const isCouponRedeem = getCouponRedeemItemIds(selectedTx).has(item.id)

                                return (
                                    <div key={item.id} className="flex justify-between items-start py-1.5 border-b border-gray-50 last:border-0">
                                        <div className="flex-1">
                                            <p className="font-bold text-gray-800 text-[11px] leading-tight pr-4">{item.name}</p>
                                            <div className="flex items-center gap-1.5 text-[10px] font-medium mt-0.5">
                                                {hasItemDisc ? (
                                                    <>
                                                        <span className="text-gray-400 line-through">Rp {orig.toLocaleString('id-ID')}</span>
                                                        <span className="text-emerald-700 font-bold">Rp {charged.toLocaleString('id-ID')}</span>
                                                    </>
                                                ) : (
                                                    <span className="text-gray-400">Rp {charged.toLocaleString('id-ID')}</span>
                                                )}
                                                <span className="text-gray-400">x{qty}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="font-bold text-gray-800 text-[11px]">{formatCurrency(item.subtotal)}</span>
                                            {hasItemDisc && (isCouponRedeem ? (
                                                <div className="text-[9px] font-extrabold text-amber-700">
                                                    Redeem Kupon Rp {((orig - charged) * qty).toLocaleString('id-ID')}
                                                </div>
                                            ) : (
                                                <div className="text-[9px] font-extrabold text-rose-600">
                                                    Hemat Rp {((orig - charged) * qty).toLocaleString('id-ID')}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Calculations */}
                    {(() => {
                        const modalPricing = getCleanTxPricing(selectedTx)
                        return (
                            <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5 font-bold">
                                <div className="flex justify-between text-gray-500">
                                    <span>Sebelum Diskon</span>
                                    <span className="">{formatCurrency(modalPricing.sebelumDiskon)}</span>
                                </div>
                                {modalPricing.discount > 0 && (
                                    <div className="flex justify-between text-red-500">
                                        <span>Potongan Diskon</span>
                                        <span className="">- {formatCurrency(modalPricing.discount)}</span>
                                    </div>
                                )}
                                {modalPricing.couponRedeem > 0 && (
                                    <div className="flex justify-between text-amber-700">
                                        <span>Redeem Kupon</span>
                                        <span className="">- {formatCurrency(modalPricing.couponRedeem)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm border-t border-gray-100 pt-2 text-gray-900 font-black">
                                    <span>TOTAL BAYAR</span>
                                    <span className=" text-base text-ayumi-secondary">{formatCurrency(modalPricing.total)}</span>
                                </div>
                            </div>
                        )
                    })()}

                    {/* Notes if exists */}
                    {(isEditingTx || selectedTx.notes) && (
                        <div className="bg-yellow-50/50 p-2.5 rounded-lg border border-yellow-100 text-[10px] text-yellow-800 leading-relaxed">
                            <strong>Catatan:</strong>
                            {isEditingTx ? (
                                <textarea
                                    value={editTxData.notes}
                                    onChange={(e) => setEditTxData(prev => ({ ...prev, notes: e.target.value }))}
                                    rows="2"
                                    className="w-full mt-1 p-1.5 border border-yellow-200 rounded text-[10px] bg-white text-gray-800 focus:outline-none focus:border-ayumi-primary resize-none"
                                    placeholder="Catatan transaksi..."
                                />
                            ) : (
                                <span> {selectedTx.notes}</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Modal Action Buttons */}
                <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
                    {isEditingTx ? (
                        <>
                            <button
                                onClick={handleSaveEditedTx}
                                className="bg-ayumi-primary hover:bg-ayumi-primary-hover text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all"
                            >
                                Simpan
                            </button>
                            <button
                                onClick={() => setIsEditingTx(false)}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                            >
                                Batal
                            </button>
                        </>
                    ) : (
                        <>
                            {(dbUser?.role === 'owner' || dbUser?.role === 'admin') && (
                                <>
                                    <button
                                        onClick={() => setIsEditingTx(true)}
                                        className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                    >
                                        Edit
                                    </button>
                                    {selectedTx?.payment_status !== 'void' && (
                                        <button
                                            onClick={() => handleVoidTx(selectedTx)}
                                            className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                            title="Batalkan Transaksi (VOID) & Kembalikan Stok/Kupon"
                                        >
                                            Batalkan (Void)
                                        </button>
                                    )}
                                    {dbUser?.role === 'owner' && (
                                        <button
                                            onClick={() => handleDeleteTx(selectedTx)}
                                            disabled={isDeletingTx}
                                            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                            title="Hapus Transaksi Permanen dari Database (Khusus Owner)"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            <span>{isDeletingTx ? 'Menghapus...' : 'Hapus'}</span>
                                        </button>
                                    )}
                                </>
                            )}
                            <Link
                                href={`/kasir/transactions/${selectedTx.id}`}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 transition-all"
                                title="Buka Halaman Struk & Kirim Foto Struk ke WhatsApp"
                            >
                                <span>📸</span>
                                <span>Foto Struk & Kirim WA</span>
                            </Link>
                            <button
                                onClick={() => handleSendWA(selectedTx)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                title="Kirim Struk Teks WA"
                            >
                                <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.964 9.964 0 001.333 4.993L2 22l5.233-1.371a9.946 9.946 0 004.787 1.226h.005c5.502 0 9.985-4.479 9.986-9.987 0-2.67-1.037-5.178-2.924-7.065A9.923 9.923 0 0012.012 2zm4.857 13.913c-.266.747-1.545 1.399-2.113 1.488-.517.081-1.19.122-1.921-.112-.733-.234-1.637-.621-2.738-1.096-1.83-.791-3.23-2.56-3.32-2.682-.092-.121-.75-.992-.75-1.884v-.001c0-.893.468-1.332.635-1.514.167-.182.365-.228.487-.228.121 0 .243.002.348.006.112.005.263-.042.412.316.152.366.52.1.626.471.106.371.076.66-.046.903-.121.243-.243.402-.365.548-.121.146-.248.304-.106.548.142.244.632 1.039 1.36 1.688.937.834 1.728 1.093 1.972 1.214.244.121.385.101.527-.061.142-.162.608-.71.77-1.016.162-.304.324-.254.548-.172.223.081 1.42.67 1.663.792.244.121.405.182.466.284.061.101.061.589-.203 1.337z"/></svg>
                                <span>Kirim Teks WA</span>
                            </button>
                            <button
                                onClick={() => window.print()}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                Cetak
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
