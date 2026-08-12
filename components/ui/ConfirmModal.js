'use client'

/**
 * Reusable ConfirmModal component for dangerous or important confirmation actions.
 */
export default function ConfirmModal({
    isOpen = false,
    title = 'Konfirmasi Aksi',
    message = 'Apakah Anda yakin ingin melanjutkan tindakan ini?',
    confirmLabel = 'Ya, Lanjutkan',
    cancelLabel = 'Batal',
    variant = 'danger', // 'danger' | 'warning' | 'info'
    loading = false,
    onConfirm,
    onClose
}) {
    if (!isOpen) return null

    const variantStyles = {
        danger: {
            iconBg: 'bg-red-100 text-red-600',
            buttonBg: 'bg-red-600 hover:bg-red-700 text-white',
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            )
        },
        warning: {
            iconBg: 'bg-amber-100 text-amber-600',
            buttonBg: 'bg-amber-600 hover:bg-amber-700 text-white',
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            )
        },
        info: {
            iconBg: 'bg-ayumi-accent text-ayumi-primary',
            buttonBg: 'btn-primary',
            icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            )
        }
    }

    const currentStyle = variantStyles[variant] || variantStyles.danger

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-gray-100 space-y-5 relative">
                <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${currentStyle.iconBg}`}>
                        {currentStyle.icon}
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-extrabold text-gray-800 tracking-tight">
                            {title}
                        </h3>
                        <p className="text-xs text-gray-500 font-medium leading-relaxed">
                            {message}
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={loading}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-2 ${currentStyle.buttonBg}`}
                    >
                        {loading ? (
                            <>
                                <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></span>
                                <span>Memproses...</span>
                            </>
                        ) : (
                            confirmLabel
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
