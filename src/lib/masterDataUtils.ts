/**
 * Master Data Utilities
 * Handles normalization and display formatting for WhatsApp, email, times, and rupiah.
 */

/**
 * Normalizes WhatsApp number to E.164 Indonesian format: +628xxxxxxxxxx
 * Example: '0896-5462-3347' -> '+6289654623347'
 * Example: '089654623347' -> '+6289654623347'
 * Example: '6289654623347' -> '+6289654623347'
 */
export function normalizeWhatsApp(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  // Remove spaces, hyphens, parentheses, periods
  let cleaned = trimmed.replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.startsWith('+62')) {
    return cleaned;
  }
  if (cleaned.startsWith('62')) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    return `+62${cleaned.substring(1)}`;
  }
  if (cleaned.startsWith('8')) {
    return `+62${cleaned}`;
  }
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Formats normalized WhatsApp number for elegant human-readable UI display
 * Example: '+6289654623347' -> '+62 896-5462-3347'
 */
export function formatWhatsAppDisplay(phone: string): string {
  if (!phone) return '-';
  const normalized = normalizeWhatsApp(phone);
  // Match +62 8xx-xxxx-xxxx
  const match = normalized.match(/^\+62(\d{3})(\d{4})(\d{3,5})$/);
  if (match) {
    return `+62 ${match[1]}-${match[2]}-${match[3]}`;
  }
  return normalized;
}

/**
 * Normalizes email address (trims and converts to lowercase)
 * Example: ' SenzuReflexology@Gmail.COM ' -> 'senzureflexology@gmail.com'
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Validates Indonesian WhatsApp / phone format
 */
export function isValidWhatsApp(phone: string): boolean {
  if (!phone) return false;
  const normalized = normalizeWhatsApp(phone);
  return /^\+628\d{8,12}$/.test(normalized);
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

/**
 * Validates 24-hour time format (HH:mm)
 */
export function isValidTimeFormat(time: string): boolean {
  if (!time) return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim());
}

/**
 * Indonesian Timezone labels
 */
export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Jakarta', label: 'WIB (Asia/Jakarta - UTC+7)', abbreviation: 'WIB' },
  { value: 'Asia/Makassar', label: 'WITA (Asia/Makassar - UTC+8)', abbreviation: 'WITA' },
  { value: 'Asia/Jayapura', label: 'WIT (Asia/Jayapura - UTC+9)', abbreviation: 'WIT' },
];

/**
 * Generates direct wa.me link target from any normalized or raw phone number
 */
export function getWaMeTarget(phone: string): string {
  if (!phone) return '';
  const normalized = normalizeWhatsApp(phone);
  return normalized.replace('+', '');
}

/**
 * Standard Indonesian Staff Role display labels
 */
export const STAFF_ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  supervisor: 'Supervisor',
  css: 'CSS',
  therapist: 'Terapis',
  admin: 'Admin',
};

export function getRoleDisplayLabel(role?: string): string {
  if (!role) return '-';
  return STAFF_ROLE_LABELS[role.toLowerCase()] || role;
}

/**
 * Generates human-readable Employee Code suggestion based on role prefix
 * MGR001, SPV001, CSS001, TRP001, ADM001
 */
export function generateNextEmployeeCode(
  role: string,
  existingCodes: (string | undefined)[]
): string {
  const prefixMap: Record<string, string> = {
    manager: 'MGR',
    supervisor: 'SPV',
    css: 'CSS',
    therapist: 'TRP',
    admin: 'ADM',
  };
  const prefix = prefixMap[(role || '').toLowerCase()] || 'STF';

  // Find highest number used with this prefix
  let maxNum = 0;
  const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');

  existingCodes.forEach((code) => {
    if (!code) return;
    const match = code.trim().match(regex);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val > maxNum) maxNum = val;
    }
  });

  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

/**
 * Generates clean initials avatar (e.g. "Rina Anggraini" -> "RA")
 */
export function getInitialsAvatar(name?: string): string {
  if (!name) return 'SZ';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

