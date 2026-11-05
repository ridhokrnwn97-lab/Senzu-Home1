import { auth } from './firebase';
import { trackMetaAdsAction } from './metaPixel';

/** Only the customer page calls this; staff verification itself never tracks its operator. */
export async function trackVerifiedManualPayment(bookingId: string, isCurrent: () => boolean = () => true): Promise<void> {
  try {
    const customer = auth.currentUser;
    if (!customer || !isCurrent()) return;
    const stable = () => auth.currentUser === customer && isCurrent();
    const token = await customer.getIdToken();
    if (!stable()) return;
    const response = await fetch('/api/payments/lookup', { method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ bookingId }) });
    const result = await response.json().catch(() => null);
    if (!stable() || !response.ok || result?.success !== true) return;
    const receipt = result.manualPaidLead, payment = result.payment;
    if (!receipt || receipt.schemaVersion !== 1 || receipt.source !== 'staff_verified_manual'
      || receipt.bookingId !== bookingId || receipt.paymentId !== payment?.id || payment.bookingId !== bookingId
      || payment.status !== 'paid' || payment.paymentType !== 'manual' || payment.amount !== receipt.amount
      || receipt.currency !== 'IDR' || !Number.isSafeInteger(receipt.amount) || receipt.amount <= 0
      || typeof receipt.verifiedAt !== 'string' || !Number.isFinite(Date.parse(receipt.verifiedAt))) return;
    await trackMetaAdsAction('manual_payment_verified', { entityId: bookingId, value: receipt.amount, isCurrent: stable });
  } catch { /* Analytics must never affect payment, verification or navigation. */ }
}
