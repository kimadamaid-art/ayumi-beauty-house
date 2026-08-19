import { normalizeIndonesianPhone } from './phoneNormalization.js'

/**
 * Validates and cleans patient data before insertion into database.
 * Enforces all business rules across the 5 patient creation entry points:
 * 1. Full name: min 3 chars (trimmed)
 * 2. WhatsApp: must pass E.164 normalization (Indonesian or international)
 * 3. Birth date (optional): must be past, age 5-100, not equal to registration date
 * 4. Address & text notes (optional): min 5 chars if filled (rejects 'jl', 'f')
 * 5. Converts empty strings to null for optional database fields
 * 
 * @param {Object} data 
 * @param {Object} [options]
 * @param {Date|string} [options.registrationDate=new Date()]
 * @returns {{ isValid: boolean, errors: Object, cleanPayload: Object }}
 */
export function validatePatientData(data = {}, { registrationDate = new Date() } = {}) {
    const errors = {}

    // 1. Full Name (Required, min 3 chars)
    const rawName = String(data.full_name || '').trim()
    if (!rawName) {
        errors.full_name = 'Nama lengkap pasien wajib diisi.'
    } else if (rawName.length < 3) {
        errors.full_name = 'Nama lengkap minimal 3 karakter.'
    }

    // 2. WhatsApp Phone (Required, must pass E.164 normalization)
    const normalizedWa = normalizeIndonesianPhone(data.whatsapp)
    if (!normalizedWa) {
        errors.whatsapp = 'Nomor WhatsApp tidak valid. Gunakan nomor seluler yang sah (contoh: 081234567890 / 6281234567890).'
    }

    // 3. Birth Date (Optional: if provided, must be past, age 5-100, not same as registration date)
    let finalBirthDate = null
    if (data.birth_date && data.birth_date !== '-' && String(data.birth_date).trim() !== '') {
        const bDate = new Date(data.birth_date)
        if (isNaN(bDate.getTime())) {
            errors.birth_date = 'Format tanggal lahir tidak valid.'
        } else {
            const today = new Date()
            if (bDate >= today) {
                errors.birth_date = 'Tanggal lahir harus berada di masa lalu.'
            } else {
                // Calculate age in years
                const ageYears = (today.getTime() - bDate.getTime()) / (365.25 * 24 * 3600 * 1000)
                if (ageYears < 5 || ageYears > 100) {
                    errors.birth_date = 'Tanggal lahir tidak wajar (usia pasien harus antara 5 s/d 100 tahun).'
                } else {
                    // Check not equal to registration date
                    const regDateObj = new Date(registrationDate)
                    const regIso = !isNaN(regDateObj.getTime()) ? regDateObj.toISOString().split('T')[0] : today.toISOString().split('T')[0]
                    const bIso = bDate.toISOString().split('T')[0]
                    if (bIso === regIso) {
                        errors.birth_date = 'Tanggal lahir tidak boleh sama dengan tanggal pendaftaran.'
                    } else {
                        finalBirthDate = bIso
                    }
                }
            }
        }
    }

    // 4. Address (Optional: min 5 chars if filled, '-' treated as null)
    const rawAddress = data.address ? String(data.address).trim() : ''
    let finalAddress = null
    if (rawAddress && rawAddress !== '-' && rawAddress !== '--') {
        if (rawAddress.length < 5) {
            errors.address = 'Alamat terlalu pendek (minimal 5 karakter jika diisi).'
        } else {
            finalAddress = rawAddress
        }
    }

    // 5. Medical Notes, Allergies, Notes (Optional: min 5 chars if filled, '-' treated as null)
    const rawMedNotes = data.medical_notes ? String(data.medical_notes).trim() : ''
    let finalMedNotes = null
    if (rawMedNotes && rawMedNotes !== '-' && rawMedNotes !== '--') {
        if (rawMedNotes.length < 5) {
            errors.medical_notes = 'Catatan medis terlalu pendek (minimal 5 karakter jika diisi).'
        } else {
            finalMedNotes = rawMedNotes
        }
    }

    const rawAllergies = data.allergies ? String(data.allergies).trim() : ''
    let finalAllergies = null
    if (rawAllergies && rawAllergies !== '-' && rawAllergies !== '--') {
        if (rawAllergies.length < 5) {
            errors.allergies = 'Catatan alergi terlalu pendek (minimal 5 karakter jika diisi).'
        } else {
            finalAllergies = rawAllergies
        }
    }

    const rawNotes = data.notes ? String(data.notes).trim() : ''
    let finalNotes = null
    if (rawNotes && rawNotes !== '-' && rawNotes !== '--') {
        if (rawNotes.length < 5) {
            errors.notes = 'Catatan pasien terlalu pendek (minimal 5 karakter jika diisi).'
        } else {
            finalNotes = rawNotes
        }
    }

    // Skin concerns (array or string)
    let finalSkinConcerns = []
    if (Array.isArray(data.skin_concerns)) {
        finalSkinConcerns = data.skin_concerns.filter(Boolean)
    } else if (data.skin_concerns && typeof data.skin_concerns === 'string') {
        const trimmedConcern = data.skin_concerns.trim()
        if (trimmedConcern) finalSkinConcerns = [trimmedConcern]
    }

    const cleanPayload = {
        branch_id: data.branch_id || null,
        full_name: rawName,
        whatsapp: normalizedWa,
        birth_date: finalBirthDate,
        gender: data.gender || 'female',
        address: finalAddress,
        instagram: data.instagram ? String(data.instagram).trim() || null : null,
        skin_type: data.skin_type || 'normal',
        skin_concerns: finalSkinConcerns,
        allergies: finalAllergies,
        medical_notes: finalMedNotes,
        notes: finalNotes,
        is_active: data.is_active !== undefined ? Boolean(data.is_active) : true
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors,
        cleanPayload
    }
}
