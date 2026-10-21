import { auth } from './firebase';
import { isXenditBookingPreview, normalizeXenditBookingPreview, type XenditBookingPreview,
  type XenditBookingPreviewInput } from './xenditBookingPreview';

export type XenditTestSession = {
  referenceId: string;
  sessionId: string | null;
  checkoutUrl: string | null;
  sessionStatus: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELED' | null;
  creationState: 'creating' | 'created' | 'uncertain' | 'rejected' | 'review_closed';
  amount: number;
  bookingPreview?: XenditBookingPreview;
  currency: 'IDR';
  environment: 'test';
  expiresAt: string | null;
  lastWebhookAt: string | null;
  lastCheckedAt: string | null;
  reviewCloseAllowed?: boolean;
  lastError?: { code: string; upstreamStatus: number | null; upstreamCode: string | null } | null;
  realBookingAffected: false;
};
export type XenditTestStatus = {
  configured: boolean; environment: 'test'; amount: 10000; currency: 'IDR';
  webhookPath: string; realBookingAffected: false; message: string;
};
export function safeXenditTestLink(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['dev.xen.to', 'checkout-staging.xendit.co'].includes(url.hostname)) throw new Error('Tautan checkout Test tidak valid.');
  return url.href;
}
function validateSession(value: any): XenditTestSession {
  if (!value || !/^szt_[a-f0-9]{48}$/.test(value.referenceId || '') || value.environment !== 'test' ||
      (value.bookingPreview === undefined ? value.amount !== 10000
        : !isXenditBookingPreview(value.bookingPreview) || value.amount !== value.bookingPreview.totalAmount) ||
      value.currency !== 'IDR' || value.realBookingAffected !== false ||
      !['creating', 'created', 'uncertain', 'rejected', 'review_closed'].includes(value.creationState) ||
      ![null, 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELED'].includes(value.sessionStatus) ||
      (value.sessionId !== null && (typeof value.sessionId !== 'string' || !/^ps-[a-zA-Z0-9-]{16,80}$/.test(value.sessionId))) ||
      (value.checkoutUrl !== null && typeof value.checkoutUrl !== 'string') ||
      (value.reviewCloseAllowed !== undefined && typeof value.reviewCloseAllowed !== 'boolean') ||
      (value.lastError !== undefined && value.lastError !== null &&
        (!value.lastError || typeof value.lastError.code !== 'string' || !/^[A-Z_]{1,64}$/.test(value.lastError.code) ||
          (value.lastError.upstreamStatus !== null && (!Number.isInteger(value.lastError.upstreamStatus) ||
            value.lastError.upstreamStatus < 400 || value.lastError.upstreamStatus > 599)) ||
          (value.lastError.upstreamCode !== null && (typeof value.lastError.upstreamCode !== 'string' ||
            !/^[A-Z_]{1,64}$/.test(value.lastError.upstreamCode))))) ||
      ['expiresAt', 'lastWebhookAt', 'lastCheckedAt'].some(field => value[field] !== null &&
        (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field]))))) throw new Error('Respons sesi uji Xendit tidak valid.');
  if (value.checkoutUrl) safeXenditTestLink(value.checkoutUrl);
  return value;
}
async function request(action: string, payload: any, signal?: AbortSignal): Promise<any> {
  const session = auth.currentUser;
  if (!session?.uid) throw new Error('Silakan masuk sebagai Manager atau Admin.');
  const stable = () => {
    if (auth.currentUser !== session || auth.currentUser?.uid !== session.uid) throw new Error('Sesi berubah. Buka ulang panel Xendit.');
    if (signal?.aborted) throw new Error('Permintaan dibatalkan.');
  };
  const token = await session.getIdToken(); stable();
  if (!token) throw new Error('Token sesi tidak tersedia.');
  // Never automatically retry session creation after an ambiguous network error.
  const response = await fetch(`/api/integrations/xendit/test/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), cache: 'no-store',
  });
  stable();
  let data: any;
  try { data = await response.json(); } catch { throw new Error('Respons server belum dapat dibaca. Periksa percobaan yang sama.'); }
  stable();
  if (!response.ok || data?.success !== true) throw new Error(typeof data?.message === 'string' ? data.message : 'Permintaan uji Xendit gagal.');
  return data;
}
export async function getXenditTestStatus(signal?: AbortSignal): Promise<XenditTestStatus> {
  const data = await request('status', {}, signal);
  if (typeof data.configured !== 'boolean' || data.environment !== 'test' || data.realBookingAffected !== false ||
      data.amount !== 10000 || data.currency !== 'IDR' || data.webhookPath !== '/api/integrations/xendit/test/webhook') throw new Error('Respons konfigurasi Xendit tidak valid.');
  return data;
}
export async function getLatestXenditTestSession(signal?: AbortSignal): Promise<XenditTestSession | null> {
  const data = await request('latest', {}, signal);
  return data.session === null ? null : validateSession(data.session);
}
export async function createXenditTestSession(attemptId: string, bookingPreview?: XenditBookingPreviewInput): Promise<XenditTestSession> {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(attemptId)) throw new Error('ID percobaan tidak valid.');
  return validateSession((await request('checkout', { attemptId,
    ...(bookingPreview ? { bookingPreview: normalizeXenditBookingPreview(bookingPreview) } : {}) })).session);
}
export async function readXenditTestSession(referenceId: string, sessionId?: string): Promise<XenditTestSession> {
  if (!/^szt_[a-f0-9]{48}$/.test(referenceId)) throw new Error('Referensi percobaan tidak valid.');
  if (sessionId !== undefined && !/^ps-[a-zA-Z0-9-]{16,80}$/.test(sessionId)) throw new Error('ID sesi Xendit tidak valid.');
  const value = validateSession((await request('read', { referenceId, ...(sessionId ? { sessionId } : {}) })).session);
  if (value.referenceId !== referenceId) throw new Error('Referensi respons Xendit tidak sesuai.');
  return value;
}
export async function closeReviewedXenditTestAttempt(referenceId: string): Promise<XenditTestSession> {
  if (!/^szt_[a-f0-9]{48}$/.test(referenceId)) throw new Error('Referensi percobaan tidak valid.');
  const value = validateSession((await request('review-close', {
    referenceId, confirmedReference: referenceId, checkedTestDashboard: true,
  })).session);
  if (value.referenceId !== referenceId || value.creationState !== 'review_closed') throw new Error('Respons penutupan percobaan tidak sesuai.');
  return value;
}
