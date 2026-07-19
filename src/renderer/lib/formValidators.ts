import { isGstin, isMobile, isPincode, isEmail, VMSG } from '@shared/validation'

export const vGstin = (v: string): string | null => (isGstin(v) ? null : VMSG.gstin)
export const vPhone = (v: string): string | null => (isMobile(v) ? null : VMSG.phone)
// Optional phone: blank is allowed, but a non-empty value must be a valid 10-digit number.
export const vPhoneOptional = (v: string): string | null => (!v || isMobile(v) ? null : VMSG.phone)
export const vPincode = (v: string): string | null => (isPincode(v) ? null : VMSG.pincode)
// Optional email: blank is allowed, but a non-empty value must look like an email.
export const vEmailOptional = (v: string): string | null => (!v || isEmail(v) ? null : VMSG.email)
