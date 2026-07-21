'use client'

import { useState, useEffect, useRef } from 'react'

export default function DateRangePicker({ startDate, endDate, onChange, inputClassName = '', autoOpen = false, align = 'left' }) {
    const [isOpen, setIsOpen] = useState(autoOpen)
    const containerRef = useRef(null)

    // Formatted dates for display
    const formatDateDisplay = (dateStr) => {
        if (!dateStr) return ''
        const [y, m, d] = dateStr.split('-')
        return `${d}/${m}/${y}`
    }

    // Set temp states for selection
    const [tempStart, setTempStart] = useState(startDate)
    const [tempEnd, setTempEnd] = useState(endDate)

    // Calendar state
    const today = new Date()
    const [viewMonth, setViewMonth] = useState(today.getMonth())
    const [viewYear, setViewYear] = useState(today.getFullYear())

    useEffect(() => {
        setTempStart(startDate)
        setTempEnd(endDate)
        if (startDate) {
            const parsed = new Date(startDate)
            setViewMonth(parsed.getMonth())
            setViewYear(parsed.getFullYear())
        }
    }, [startDate, endDate])

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const getLocalYYYYMMDD = (d = new Date()) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const handleQuickSelect = (type) => {
        const now = new Date()
        let start = new Date()
        let end = new Date()

        if (type === 'today') {
            start = now
            end = now
        } else if (type === '7days') {
            start.setDate(now.getDate() - 6)
        } else if (type === '30days') {
            start.setDate(now.getDate() - 29)
        } else if (type === 'thisMonth') {
            start = new Date(now.getFullYear(), now.getMonth(), 1)
            end = now
        } else if (type === 'lastMonth') {
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            end = new Date(now.getFullYear(), now.getMonth(), 0)
        }

        const startStr = getLocalYYYYMMDD(start)
        const endStr = getLocalYYYYMMDD(end)

        setTempStart(startStr)
        setTempEnd(endStr)
        onChange({ startDate: startStr, endDate: endStr })
        setIsOpen(false)
    }

    // Calendar Days Calculation
    const getDaysArray = () => {
        const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay() // 0 = Sun, 1 = Mon ...
        const adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1 // Adjust so Mon is 0

        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

        const days = []

        // Previous month days
        for (let i = adjustedFirstDay - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i
            const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1
            const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear
            days.push({
                day,
                month: prevMonth,
                year: prevYear,
                isCurrentMonth: false,
                dateStr: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            })
        }

        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            days.push({
                day: i,
                month: viewMonth,
                year: viewYear,
                isCurrentMonth: true,
                dateStr: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
            })
        }

        // Next month days (pad to multiples of 7)
        const totalCells = Math.ceil(days.length / 7) * 7
        const nextDaysCount = totalCells - days.length
        for (let i = 1; i <= nextDaysCount; i++) {
            const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1
            const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear
            days.push({
                day: i,
                month: nextMonth,
                year: nextYear,
                isCurrentMonth: false,
                dateStr: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
            })
        }

        return days
    }

    const handleDateClick = (dateStr) => {
        if (!tempStart || (tempStart && tempEnd)) {
            // First click: select start date
            setTempStart(dateStr)
            setTempEnd('')
        } else {
            // Second click: select end date
            if (new Date(dateStr) < new Date(tempStart)) {
                // If clicked date is before start date, make it the new start date
                setTempStart(dateStr)
            } else {
                setTempEnd(dateStr)
                onChange({ startDate: tempStart, endDate: dateStr })
                setIsOpen(false)
            }
        }
    }

    const isSelected = (dateStr) => {
        return dateStr === tempStart || dateStr === tempEnd
    }

    const isInRange = (dateStr) => {
        if (!tempStart || !tempEnd) return false
        const d = new Date(dateStr)
        const start = new Date(tempStart)
        const end = new Date(tempEnd)
        return d > start && d < end
    }

    const nextMonth = () => {
        if (viewMonth === 11) {
            setViewMonth(0)
            setViewYear(viewYear + 1)
        } else {
            setViewMonth(viewMonth + 1)
        }
    }

    const prevMonth = () => {
        if (viewMonth === 0) {
            setViewMonth(11)
            setViewYear(viewYear - 1)
        } else {
            setViewMonth(viewMonth - 1)
        }
    }

    const monthNames = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ]

    const daysOfWeek = ["Sn", "Sl", "Rb", "Km", "Jm", "Sb", "Mg"]

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between gap-2 border border-gray-200 hover:border-ayumi-primary/40 bg-white px-4 py-2 rounded-xl shadow-sm text-sm font-semibold text-gray-700 transition-all cursor-pointer ${inputClassName}`}
            >
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="whitespace-nowrap">
                        {tempStart && tempEnd 
                            ? `${formatDateDisplay(tempStart)} - ${formatDateDisplay(tempEnd)}`
                            : 'Pilih rentang tanggal...'}
                    </span>
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-2 bg-white rounded-2xl border border-gray-200 shadow-2xl p-3.5 sm:p-4 flex flex-col md:flex-row gap-3 sm:gap-4 z-50 w-[calc(100vw-2.5rem)] sm:w-auto max-w-[350px] sm:max-w-none sm:min-w-[500px]`}>
                    
                    {/* Predefined Ranges Panel */}
                    <div className="flex flex-row md:flex-col gap-1.5 overflow-x-auto max-w-full shrink-0 pb-2 md:pb-0 md:border-r border-gray-100 pr-0 md:pr-4 custom-scrollbar">
                        <div className="hidden md:block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Rentang Cepat</div>
                        <button
                            type="button"
                            onClick={() => handleQuickSelect('today')}
                            className="text-left px-3 py-2 text-xs font-semibold text-gray-600 hover:text-ayumi-primary hover:bg-pink-50/50 rounded-lg whitespace-nowrap transition-colors"
                        >
                            Hari Ini
                        </button>
                        <button
                            type="button"
                            onClick={() => handleQuickSelect('7days')}
                            className="text-left px-3 py-2 text-xs font-semibold text-gray-600 hover:text-ayumi-primary hover:bg-pink-50/50 rounded-lg whitespace-nowrap transition-colors"
                        >
                            7 Hari Terakhir
                        </button>
                        <button
                            type="button"
                            onClick={() => handleQuickSelect('30days')}
                            className="text-left px-3 py-2 text-xs font-semibold text-gray-600 hover:text-ayumi-primary hover:bg-pink-50/50 rounded-lg whitespace-nowrap transition-colors"
                        >
                            30 Hari Terakhir
                        </button>
                        <button
                            type="button"
                            onClick={() => handleQuickSelect('thisMonth')}
                            className="text-left px-3 py-2 text-xs font-semibold text-gray-600 hover:text-ayumi-primary hover:bg-pink-50/50 rounded-lg whitespace-nowrap transition-colors"
                        >
                            Bulan Ini
                        </button>
                        <button
                            type="button"
                            onClick={() => handleQuickSelect('lastMonth')}
                            className="text-left px-3 py-2 text-xs font-semibold text-gray-600 hover:text-ayumi-primary hover:bg-pink-50/50 rounded-lg whitespace-nowrap transition-colors"
                        >
                            Bulan Lalu
                        </button>
                    </div>

                    {/* Calendar Panel */}
                    <div className="flex-1">
                        {/* Month Header Navigation */}
                        <div className="flex items-center justify-between mb-4">
                            <button
                                type="button"
                                onClick={prevMonth}
                                className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <span className="font-bold text-gray-800 text-sm">
                                {monthNames[viewMonth]} {viewYear}
                            </span>
                            <button
                                type="button"
                                onClick={nextMonth}
                                className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1 text-center mb-2">
                            {daysOfWeek.map((d, i) => (
                                <div key={i} className="text-[10px] font-bold text-gray-400 py-1">
                                    {d}
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1 text-center">
                            {getDaysArray().map((item, index) => {
                                const active = isSelected(item.dateStr)
                                const range = isInRange(item.dateStr)
                                const isStart = item.dateStr === tempStart
                                const isEnd = item.dateStr === tempEnd

                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => handleDateClick(item.dateStr)}
                                        className={`
                                            h-8 text-xs font-semibold rounded-lg flex items-center justify-center transition-all relative
                                            ${!item.isCurrentMonth ? 'text-gray-300' : 'text-gray-700 hover:bg-pink-50 hover:text-ayumi-primary'}
                                            ${active ? 'bg-ayumi-primary text-white hover:bg-ayumi-primary hover:text-white shadow-sm' : ''}
                                            ${range ? 'bg-pink-50 text-ayumi-primary rounded-none font-bold' : ''}
                                            ${isStart && tempEnd ? 'rounded-r-none' : ''}
                                            ${isEnd && tempStart ? 'rounded-l-none' : ''}
                                        `}
                                    >
                                        {item.day}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                </div>
            )}
        </div>
    )
}
