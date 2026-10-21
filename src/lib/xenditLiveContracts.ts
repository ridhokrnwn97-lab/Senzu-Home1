export const XENDIT_LIVE_METHOD = 'Xendit';
export type LiveCreationState = 'creating' | 'uncertain' | 'ready' | 'rejected';
export interface XenditLiveSession {
  bookingId: string;
  referenceId: string;
  amount: number;
  currency: 'IDR';
  environment: 'live';
  creationState: LiveCreationState;
  sessionStatus: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELED' | null;
  paymentStatus: string;
  sessionId: string | null;
  checkoutUrl: string | null;
  expiresAt: string | null;
  lastWebhookAt: string | null;
  lastCheckedAt: string | null;
  paidSource?: 'webhook' | 'check' | 'recovery' | 'create' | null;
  reconciliationRequired: boolean;
}

/** A Test URL can never be opened by the customer Live flow. */
export function safeLiveCheckoutUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Tautan pembayaran Xendit tidak valid.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Tautan pembayaran Xendit tidak valid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['xen.to', 'checkout.xendit.co'].includes(url.hostname)) {
    throw new Error('Tautan pembayaran bukan checkout Live Xendit.');
  }
  return url.href;
}
