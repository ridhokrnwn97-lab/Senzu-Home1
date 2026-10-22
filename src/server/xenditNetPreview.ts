import { isAccurateXenditNetPreview, matchesXenditPaymentProduct, ACCURATE_NET_PREVIEW_ERRORS, xenditMinorUnits,
  type AccurateXenditNetPreview } from '../lib/accurateSyncContracts.ts';

const fail = (status: number, code: string) => Object.assign(new Error(ACCURATE_NET_PREVIEW_ERRORS[code]), { status, code });
type Expected = { bookingCode: string; referenceId: string; paymentId: string; amount: number };
type Dependencies = { env: NodeJS.ProcessEnv; fetch?: typeof fetch; clock: () => number };

// This module has exactly one outbound operation: GET /transactions on the
// fixed Xendit origin. It cannot refresh a payment, post fees or withdraw funds.
export async function readXenditNetPreview(expected: Expected, deps: Dependencies): Promise<AccurateXenditNetPreview> {
  const key = deps.env.XENDIT_LIVE_SECRET_KEY, businessId = deps.env.XENDIT_LIVE_BUSINESS_ID;
  if (!/^xnd_production_[A-Za-z0-9_-]+$/.test(key || '') || !/^[A-Za-z0-9_-]{8,128}$/.test(businessId || '')) {
    throw fail(503, 'XENDIT_NET_NOT_CONFIGURED');
  }
  const url = new URL('https://api.xendit.co/transactions');
  url.search = new URLSearchParams({ reference_id: expected.referenceId, types: 'PAYMENT', currency: 'IDR', limit: '2' }).toString();
  let response: Response, value: any;
  try {
    response = await (deps.fetch || fetch)(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, Accept: 'application/json' } });
  } catch { throw fail(503, 'XENDIT_TRANSACTION_UNAVAILABLE'); }
  // Never return or log the provider body, headers, credentials or private data.
  if (response.status === 401) throw fail(502, 'XENDIT_TRANSACTION_AUTH_INVALID');
  if (response.status === 403) throw fail(502, 'XENDIT_TRANSACTION_PERMISSION_REQUIRED');
  if (!response.ok || response.redirected) throw fail(503, 'XENDIT_TRANSACTION_UNAVAILABLE');
  try { value = await response.json(); } catch { throw fail(502, 'XENDIT_TRANSACTION_UNVERIFIED'); }
  // An ambiguous result is never resolved by choosing the first row or by
  // following provider pagination links (which could point elsewhere).
  if (value?.has_more !== false || !Array.isArray(value.data) || !Array.isArray(value.links) || value.links.length !== 0 || value.data.length > 1) {
    throw fail(409, 'XENDIT_TRANSACTION_UNVERIFIED');
  }
  if (value.data.length === 0) throw fail(404, 'XENDIT_TRANSACTION_NOT_FOUND');
  const t = value.data[0];
  if (!t || t.business_id !== businessId || t.reference_id !== expected.referenceId || t.type !== 'PAYMENT' || t.status !== 'SUCCESS' ||
      t.cashflow !== 'MONEY_IN' || t.currency !== 'IDR' || t.net_amount_currency !== 'IDR' || t.amount !== expected.amount ||
      !matchesXenditPaymentProduct(expected.paymentId, t.product_id)) {
    throw fail(409, 'XENDIT_TRANSACTION_UNVERIFIED');
  }
  if (!t.fee || t.fee.status !== 'COMPLETED') throw fail(409, 'XENDIT_FEES_PENDING');
  if (t.settlement_status !== 'SETTLED') throw fail(409, 'XENDIT_SETTLEMENT_PENDING');
  for (const field of ['xendit_fee', 'value_added_tax', 'xendit_withholding_tax', 'third_party_withholding_tax']) {
    if (xenditMinorUnits(t.fee[field]) === null) throw fail(409, 'XENDIT_TRANSACTION_UNVERIFIED');
  }
  // Withholding changes the net calculation/tax treatment. Do not guess its
  // direction or GL allocation until Finance and the provider evidence agree.
  if (t.fee.xendit_withholding_tax !== 0 || t.fee.third_party_withholding_tax !== 0) throw fail(409, 'XENDIT_WITHHOLDING_REVIEW');
  const result = {
    mode: 'xendit_net_preview_v1', environment: 'live', readOnly: true, bookingCode: expected.bookingCode,
    referenceId: expected.referenceId, paymentId: expected.paymentId, transactionId: t.id, productId: t.product_id,
    channelCode: t.channel_code, channelCategory: t.channel_category, currency: t.currency,
    grossAmount: t.amount, xenditFee: t.fee.xendit_fee, valueAddedTax: t.fee.value_added_tax,
    xenditWithholdingTax: t.fee.xendit_withholding_tax, thirdPartyWithholdingTax: t.fee.third_party_withholding_tax, netAmount: t.net_amount,
    feeStatus: t.fee.status, settlementStatus: t.settlement_status, transactionUpdatedAt: t.updated, checkedAt: new Date(deps.clock()).toISOString(),
    processingFeeIncluded: false, bankPayoutVerified: false,
  };
  if (!isAccurateXenditNetPreview(result)) throw fail(409, 'XENDIT_TRANSACTION_UNVERIFIED');
  return result;
}
