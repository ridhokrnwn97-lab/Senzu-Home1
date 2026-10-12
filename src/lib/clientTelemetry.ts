/**
 * Senzu Home Client Telemetry & Safe Error Classification
 * Non-blocking, sanitized client-side error reporting for Google Cloud Logging
 */

export type ErrorCategory =
  | 'AUTH'
  | 'PERMISSION'
  | 'FIRESTORE'
  | 'STORAGE'
  | 'PAYMENT'
  | 'BOOKING'
  | 'THERAPIST'
  | 'GPS'
  | 'MAPS'
  | 'NETWORK'
  | 'PWA'
  | 'NOTIFICATION'
  | 'VALIDATION'
  | 'SERVER'
  | 'UNKNOWN';

export type ErrorSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface ClientErrorReport {
  event?: string;
  error?: unknown;
  messageSafe?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  route?: string;
  role?: string;
  clientRequestId?: string;
}

// Client-side rate limiting: max 6 dispatches per 60 seconds
let reportCount = 0;
let reportResetTime = Date.now() + 60000;

function isRateLimited(): boolean {
  const now = Date.now();
  if (now > reportResetTime) {
    reportCount = 0;
    reportResetTime = now + 60000;
  }
  if (reportCount >= 6) {
    return true;
  }
  reportCount++;
  return false;
}

/**
 * Sanitize error message to prevent leaking tokens, phone numbers, or passwords
 */
function sanitizeMessage(msg: string): string {
  if (!msg) return 'Unknown error';
  let sanitized = String(msg).slice(0, 300);

  // Redact token-like strings
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, '[REDACTED_BEARER]');
  sanitized = sanitized.replace(/([a-zA-Z0-9_-]{20,})/g, (match) => {
    // Keep standard uuid or shorten
    return match.length > 32 ? match.slice(0, 6) + '...[REDACTED]' : match;
  });

  // Redact email
  sanitized = sanitized.replace(/([a-zA-Z0-9_\-.+]+)@([a-zA-Z0-9_\-.]+)/g, '$1***@$2');

  // Redact phone numbers
  sanitized = sanitized.replace(/(\+?62|0)[0-9]{8,13}/g, '$1****');

  return sanitized;
}

/**
 * Classify client and Firebase errors into standardized categories
 */
export function classifyError(err: unknown): {
  category: ErrorCategory;
  severity: ErrorSeverity;
  messageSafe: string;
} {
  const errObj = err as any;
  const rawMsg = errObj?.message || String(err || '');
  const code = String(errObj?.code || '').toLowerCase();
  const lowerMsg = rawMsg.toLowerCase();

  // 1. Firebase Auth
  if (code.startsWith('auth/') || lowerMsg.includes('auth/')) {
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
      return { category: 'AUTH', severity: 'WARNING', messageSafe: 'Autentikasi gagal: Kredensial tidak sesuai.' };
    }
    if (code.includes('too-many-requests')) {
      return { category: 'AUTH', severity: 'WARNING', messageSafe: 'Terlalu banyak percobaan masuk. Harap tunggu.' };
    }
    if (code.includes('user-disabled')) {
      return { category: 'AUTH', severity: 'WARNING', messageSafe: 'Akun telah dinonaktifkan oleh administrator.' };
    }
    if (code.includes('unauthorized-domain')) {
      return { category: 'AUTH', severity: 'ERROR', messageSafe: 'Domain belum diotorisasi pada Firebase Auth.' };
    }
    return { category: 'AUTH', severity: 'WARNING', messageSafe: sanitizeMessage(rawMsg) };
  }

  // 2. Cloud Firestore
  if (code.includes('permission-denied') || lowerMsg.includes('permission-denied') || lowerMsg.includes('insufficient permissions')) {
    return { category: 'PERMISSION', severity: 'ERROR', messageSafe: 'Akses ditolak oleh kebijakan keamanan data.' };
  }
  if (code.includes('resource-exhausted') || lowerMsg.includes('resource-exhausted') || lowerMsg.includes('quota')) {
    return { category: 'FIRESTORE', severity: 'ERROR', messageSafe: 'Batas kuota database tercapai sementara.' };
  }
  if (code.includes('failed-precondition') || lowerMsg.includes('failed-precondition')) {
    return { category: 'FIRESTORE', severity: 'WARNING', messageSafe: 'Indeks atau prakondisi query belum siap.' };
  }
  if (code.includes('unavailable') || lowerMsg.includes('unavailable')) {
    return { category: 'FIRESTORE', severity: 'WARNING', messageSafe: 'Layanan database sedang tidak tersedia sementara.' };
  }

  // 3. Firebase Storage
  if (code.startsWith('storage/') || lowerMsg.includes('storage/')) {
    if (code.includes('unauthorized')) {
      return { category: 'STORAGE', severity: 'ERROR', messageSafe: 'Unggah file ditolak: Tidak memiliki izin akses.' };
    }
    if (code.includes('retry-limit-exceeded')) {
      return { category: 'STORAGE', severity: 'WARNING', messageSafe: 'Koneksi unggah file terputus.' };
    }
    return { category: 'STORAGE', severity: 'WARNING', messageSafe: sanitizeMessage(rawMsg) };
  }

  // 4. Google Maps
  if (lowerMsg.includes('maps') || lowerMsg.includes('google') || lowerMsg.includes('referer') || lowerMsg.includes('gm_authfailure')) {
    return { category: 'MAPS', severity: 'WARNING', messageSafe: 'Kendala otorisasi Google Maps Platform.' };
  }

  // 5. Network / Offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { category: 'NETWORK', severity: 'INFO', messageSafe: 'Koneksi perangkat sedang offline.' };
  }
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('abort')) {
    return { category: 'NETWORK', severity: 'WARNING', messageSafe: 'Jaringan internet lambat atau terputus.' };
  }

  // 6. Payment
  if (lowerMsg.includes('payment') || lowerMsg.includes('qris') || lowerMsg.includes('rekening')) {
    return { category: 'PAYMENT', severity: 'ERROR', messageSafe: sanitizeMessage(rawMsg) };
  }

  // 7. Therapist
  if (lowerMsg.includes('terapis') || lowerMsg.includes('therapist') || lowerMsg.includes('accept-order')) {
    return { category: 'THERAPIST', severity: 'WARNING', messageSafe: sanitizeMessage(rawMsg) };
  }

  return {
    category: 'UNKNOWN',
    severity: 'ERROR',
    messageSafe: sanitizeMessage(rawMsg),
  };
}

/**
 * Safely dispatches a non-blocking error report to /api/client-errors
 */
export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === 'undefined') return;
  if (isRateLimited()) return;

  const rawMsg = report.messageSafe || (typeof report.error === 'string' ? report.error : (report.error as any)?.message || '');
  const lowerMsg = rawMsg.toLowerCase();

  // Protect legitimate business and system errors from being suppressed
  const isCriticalOperationalError =
    lowerMsg.includes('permission') ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('resource-exhausted') ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('failed-precondition') ||
    lowerMsg.includes('storage/') ||
    lowerMsg.includes('payment') ||
    lowerMsg.includes('rekening') ||
    lowerMsg.includes('therapist') ||
    lowerMsg.includes('terapis') ||
    lowerMsg.includes('booking') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('networkerror');

  // Filter out strictly known benign environment or transport negotiation noise
  if (!isCriticalOperationalError) {
    if (
      lowerMsg.includes('websocket closed without opened') ||
      lowerMsg.includes('failed to connect to websocket') ||
      lowerMsg.includes('resizeobserver loop')
    ) {
      return;
    }
  }

  const classification = report.category
    ? { category: report.category, severity: report.severity || 'ERROR', messageSafe: report.messageSafe || 'Unknown error' }
    : classifyError(report.error || report.messageSafe);

  const deviceClass =
    window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop';

  const payload = {
    event: report.event || 'client_error',
    messageSafe: sanitizeMessage(report.messageSafe || classification.messageSafe),
    category: classification.category,
    severity: classification.severity,
    route: (report.route || window.location.pathname || '/').slice(0, 100),
    role: report.role || undefined,
    clientRequestId: report.clientRequestId || undefined,
    browserFamily: navigator.userAgent.includes('Chrome')
      ? 'Chrome'
      : navigator.userAgent.includes('Safari')
      ? 'Safari'
      : navigator.userAgent.includes('Firefox')
      ? 'Firefox'
      : 'Other',
    deviceClass,
    onlineStatus: navigator.onLine,
    timestamp: new Date().toISOString(),
  };

  try {
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Non-blocking catch: Telemetry failures must NEVER crash the user experience
    });
  } catch (_) {
    // Non-blocking catch
  }
}

let hasInitializedListeners = false;

/**
 * Initialize global unhandled error and rejection listeners safely
 */
export function initGlobalErrorHandlers(): void {
  if (typeof window === 'undefined' || hasInitializedListeners) return;
  hasInitializedListeners = true;

  window.addEventListener('error', (event) => {
    // Suppress benign third-party or extension errors
    const filename = event.filename || '';
    const message = event.message || '';
    const lowerMessage = message.toLowerCase();
    if (
      filename.includes('extensions::') ||
      filename.includes('chrome-extension://') ||
      filename.includes('moz-extension://') ||
      lowerMessage.includes('resizeobserver loop') ||
      lowerMessage.includes('failed to connect to websocket') ||
      lowerMessage.includes('websocket closed without opened')
    ) {
      return;
    }

    reportClientError({
      event: 'unhandled_window_error',
      error: event.error || message,
      messageSafe: message,
      route: window.location.pathname,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = typeof reason === 'string' ? reason : reason?.message || '';
    const lowerMsg = msg.toLowerCase();

    // Protect legitimate operational errors from suppression
    const isCriticalOperationalError =
      lowerMsg.includes('permission') ||
      lowerMsg.includes('unauthenticated') ||
      lowerMsg.includes('resource-exhausted') ||
      lowerMsg.includes('unavailable') ||
      lowerMsg.includes('failed-precondition') ||
      lowerMsg.includes('storage/') ||
      lowerMsg.includes('payment') ||
      lowerMsg.includes('rekening') ||
      lowerMsg.includes('therapist') ||
      lowerMsg.includes('terapis') ||
      lowerMsg.includes('booking') ||
      lowerMsg.includes('failed to fetch') ||
      lowerMsg.includes('networkerror');

    // Suppress only strictly known benign transport negotiation noise
    if (!isCriticalOperationalError) {
      if (
        lowerMsg.includes('websocket closed without opened') ||
        lowerMsg.includes('failed to connect to websocket') ||
        lowerMsg.includes('resizeobserver loop')
      ) {
        return;
      }
    }

    reportClientError({
      event: 'unhandled_promise_rejection',
      error: reason,
      messageSafe: msg,
      route: window.location.pathname,
    });
  });
}
