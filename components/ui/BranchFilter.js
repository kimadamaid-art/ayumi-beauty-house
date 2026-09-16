'use client'

/**
 * Reusable BranchFilter component for selecting clinic branches across modules.
 * Handles auto-locking for non-owners and custom labeling.
 */
export default function BranchFilter({
    value,
    selectedBranch,
    onChange,
    onBranchChange,
    branches = [],
    userRole = 'owner',
    userBranchId = null,
    allowAllRoles = false,
    allOptionLabel = 'Semua Cabang',
    label = 'Cabang Klinik',
    showLabel = true,
    disabled = false,
    className = '',
    selectClassName = ''
}) {
    const isOwner = userRole === 'owner'
    const isAllowed = isOwner || allowAllRoles
    const isDisabled = disabled || !isAllowed
    let rawVal = value !== undefined ? value : (selectedBranch !== undefined ? selectedBranch : '')
    if (rawVal === 'All' || rawVal === 'all') rawVal = ''
    const currentValue = rawVal

    const handleChange = (val) => {
        if (onChange) onChange(val)
        if (onBranchChange) onBranchChange(val)
    }

    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            {showLabel && (
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider pl-0.5">
                    {label}
                </label>
            )}
            <select
                value={currentValue}
                onChange={(e) => handleChange(e.target.value)}
                disabled={isDisabled}
                className={`input-ayumi py-2 text-xs bg-gray-50 font-bold text-ayumi-secondary disabled:opacity-75 cursor-pointer ${selectClassName}`}
            >
                {isAllowed && <option value="">{allOptionLabel}</option>}
                {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                        {b.name}
                    </option>
                ))}
            </select>
        </div>
    )
}
