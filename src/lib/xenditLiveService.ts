import { auth } from './firebase';
import { safeLiveCheckoutUrl, type XenditLiveSession } from './xenditLiveContracts';
import { trackMetaAdsAction } from './metaPixel';

const base = '/api/integrations/xendit/live';
export async function xenditLiveAvailable(signal?: AbortSignal): Promise<boolean> {
  const r = await fetch(`${base}/availability`, { cache: 'no-store', signal, redirect: 'error' });
  const value = await r.json();
  return r.ok && value?.success === true && value.available === true && value.environment === 'live';
}
async function request(action: string, body: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan masuk ke akun pelanggan untuk mengakses pembayaran.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  const r = await fetch(`${base}/${action}`, { method: 'POST', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const value = await r.json().catch(() => null);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  if (!r.ok || value?.success !== true) throw Object.assign(new Error(value?.error || 'Data pembayaran belum dapat dimuat. Coba muat ulang pesanan ini.'), { code: value?.code });
  return value;
}
async function session(action: string, bookingId: string, sessionId?: string): Promise<XenditLiveSession | null> {
  const customer = auth.currentUser;
  const value = await request(action, { bookingId, ...(sessionId ? { sessionId } : {}) });
  const s = value.session;
  if (s === null) return null;
  if (!s || s.bookingId !== bookingId || s.environment !== 'live' || s.currency !== 'IDR' ||
      !Number.isInteger(s.amount) || s.amount < 10000 || !/^shl_[a-f0-9]{48}$/.test(s.referenceId || '')) throw new Error('Respons pembayaran tidak valid.');
  if (s.checkoutUrl) safeLiveCheckoutUrl(s.checkoutUrl);
  // Only customer responses from the authenticated Live backend qualify.
  // Manager inspection, return URLs and Test/manual payments never fire Lead.
  if (['status', 'refresh', 'checkout'].includes(action) && customer && auth.currentUser === customer
      && s.creationState === 'ready' && s.sessionStatus === 'COMPLETED' && s.paymentStatus === 'paid'
      && s.reconciliationRequired === false && /^ps-[A-Za-z0-9-]{16,100}$/.test(s.sessionId || '')
      && ['webhook', 'check', 'recovery', 'create'].includes(s.paidSource || '')) {
    void trackMetaAdsAction('xendit_live_paid', { entityId: bookingId, value: s.amount });
  }
  return s;
}
export const readLivePayment = (bookingId: string) => session('status', bookingId);
export const inspectLivePayment = (bookingId: string) => session('inspect', bookingId);
export const createLivePayment = (bookingId: string) => session('checkout', bookingId);
export const checkLivePayment = (bookingId: string) => session('refresh', bookingId);
export const recoverLivePayment = (bookingId: string, sessionId: string) => session('recover', bookingId, sessionId);
export const readLiveConfiguration = () => request('configuration', {});
export function rememberLiveReturn(bookingId: string) {
  const uid = auth.currentUser?.uid;
  if (uid) { try { sessionStorage.setItem(`senzu:xendit-live-return:${uid}`, bookingId); } catch {} }
}
