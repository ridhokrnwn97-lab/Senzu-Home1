import { createHash } from 'node:crypto';
import { xenditMinorUnits } from '../lib/accurateSyncContracts.ts';

export const PROCESSING_TYPES = ['PROCESSING_FEE_DEDUCTION', 'PROCESSING_FEE_VAT_DEDUCTION'] as const;
export const PROCESSING_ERRORS: Record<string, string> = {
  PROCESSING_RANGE_INVALID: 'Rentang pemeriksaan processing fee tidak valid (maksimal 31 hari WIB).',
  PROCESSING_NOT_CONFIGURED: 'Konfigurasi pembacaan Xendit Live belum lengkap.',
  PROCESSING_READ_UNAVAILABLE: 'Riwayat potongan Xendit belum dapat dibaca. Tidak ada jurnal baru yang dikirim.',
  PROCESSING_READ_REJECTED: 'Xendit menolak pembacaan potongan. Periksa izin Transaction Read.',
  PROCESSING_FORMAT_INVALID: 'Bentuk riwayat processing fee perlu diperiksa. Tidak menebak potongan dari tarif.',
  PROCESSING_SCAN_INCOMPLETE: 'Riwayat belum terbaca lengkap. Persempit rentang tanggal sebelum mencatat.',
  PROCESSING_SOURCE_INVALID: 'Identitas, arah kas, nominal, atau tanggal potongan Xendit belum terverifikasi.',
  PROCESSING_PENDING: 'Ada potongan processing fee yang belum final. Tidak dicatat sampai berhasil dan settled.',
};
export const processingFailure = (code: string) => Object.assign(new Error(code), { code, status: 409, review: true });
export type ProcessingCharge = {
  transactionId: string; referenceId: string; productId: string; businessId: string;
  type: typeof PROCESSING_TYPES[number]; amount: number; createdAt: string; date: string;
};
export type ProcessingPreview = {
  fromDate: string; toDate: string; checkedAt: string; complete: true; charges: ProcessingCharge[];
  feeAmount: number; vatAmount: number; totalAmount: number; otherOutflowCount: number;
};
export function isoDay(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const wibDay = (timestamp: number) => new Date(timestamp + 25200000).toISOString().slice(0, 10);
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const identity = (v: unknown): v is string => typeof v === 'string' && /^(?:txn_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function processingCharge(t: any, businessId: string): ProcessingCharge {
  if (!t || !PROCESSING_TYPES.includes(t.type)) throw processingFailure('PROCESSING_SOURCE_INVALID');
  if (!['SUCCESS', 'SUCCESSFUL'].includes(t.status) || t.settlement_status !== 'SETTLED') throw processingFailure('PROCESSING_PENDING');
  const amount = xenditMinorUnits(t.amount), net = xenditMinorUnits(t.net_amount);
  if (t.business_id !== businessId || !identity(t.id) || !identity(t.reference_id) ||
      t.product_id !== `${t.reference_id}${t.type === PROCESSING_TYPES[1] ? ':vat' : ''}` ||
      t.cashflow !== 'MONEY_OUT' || t.currency !== 'IDR' || t.net_amount_currency !== 'IDR' ||
      amount === null || amount <= 0 || amount > 1000000000 || net !== amount || !stamp(t.created) || !stamp(t.updated) ||
      Date.parse(t.updated) < Date.parse(t.created)) throw processingFailure('PROCESSING_SOURCE_INVALID');
  // The amount itself is the standalone debit. Never add a payment fee again.
  // If the API supplies another nonzero fee/tax component, stop for review.
  if (t.fee !== undefined && (!t.fee || typeof t.fee !== 'object' || Array.isArray(t.fee) ||
      ['xendit_fee', 'value_added_tax', 'xendit_withholding_tax', 'third_party_withholding_tax'].some(k => t.fee[k] !== undefined && t.fee[k] !== 0))) {
    throw processingFailure('PROCESSING_SOURCE_INVALID');
  }
  return { transactionId: t.id, referenceId: t.reference_id, productId: t.product_id, businessId,
    type: t.type, amount: amount / 100, createdAt: new Date(t.created).toISOString(), date: wibDay(Date.parse(t.created)) };
}
export function processingJournal(charge: ProcessingCharge) {
  const key = createHash('sha256').update(JSON.stringify([charge.businessId, charge.transactionId])).digest('hex');
  const number = `SHPF-${key.slice(0, 24)}`;
  const description = `SENZU_HOME_PROCESSING_V1:${key} | ${charge.type} | ${charge.transactionId} | ${charge.referenceId} | amount=${charge.amount} | EXPENSE_INCLUDING_VAT`;
  const d = charge.date;
  return { key, payload: { number, transDate: `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, description,
    detailJournalVoucher: [{ accountNo: '600031', amount: charge.amount, amountType: 'DEBIT' },
      { accountNo: '110103', amount: charge.amount, amountType: 'CREDIT' }] } };
}
type Deps = { env: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: () => number };
export async function readProcessingFees(fromDate: string, toDate: string, deps: Deps): Promise<ProcessingPreview> {
  const clock = deps.clock || Date.now, key = deps.env.XENDIT_LIVE_SECRET_KEY, businessId = deps.env.XENDIT_LIVE_BUSINESS_ID;
  if (!/^xnd_production_[A-Za-z0-9_-]+$/.test(key || '') || !/^[A-Za-z0-9_-]{8,128}$/.test(businessId || '')) throw processingFailure('PROCESSING_NOT_CONFIGURED');
  if (!isoDay(fromDate) || !isoDay(toDate) || fromDate > toDate || toDate > wibDay(clock()) ||
      Date.parse(toDate) - Date.parse(fromDate) > 30 * 86400000) throw processingFailure('PROCESSING_RANGE_INVALID');
  const lower = Date.parse(`${fromDate}T00:00:00+07:00`), upper = Math.min(Date.parse(`${toDate}T23:59:59.999+07:00`), clock());
  const end = clock() + 35000, charges: ProcessingCharge[] = [], seen = new Set<string>();
  let cursor = '', otherOutflowCount = 0;
  for (let page = 0; page < 10; page++) {
    if (end - clock() < 1000) throw processingFailure('PROCESSING_SCAN_INCOMPLETE');
    const url = new URL('https://api.xendit.co/transactions');
    // No PAYMENT/type filter: standalone daily debit types are separate entries.
    url.search = new URLSearchParams({ currency: 'IDR', 'created[gte]': new Date(lower).toISOString(),
      'created[lte]': new Date(upper).toISOString(), limit: '100', ...(cursor ? { after_id: cursor } : {}) }).toString();
    let response: Response, body: any;
    try { response = await (deps.fetch || fetch)(url.href, { method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(Math.min(10000, end - clock())), headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, Accept: 'application/json' } }); }
    catch { throw processingFailure('PROCESSING_READ_UNAVAILABLE'); }
    if ([401, 403].includes(response.status)) throw processingFailure('PROCESSING_READ_REJECTED');
    if (!response.ok || response.redirected) throw processingFailure('PROCESSING_READ_UNAVAILABLE');
    try { body = await response.json(); } catch { throw processingFailure('PROCESSING_FORMAT_INVALID'); }
    if (!body || !Array.isArray(body.data) || !Array.isArray(body.links) || typeof body.has_more !== 'boolean' || body.data.length > 100 ||
        body.has_more && !body.data.length) throw processingFailure('PROCESSING_FORMAT_INVALID');
    for (const t of body.data) {
      if (!t || typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(t.id) || seen.has(t.id) || t.business_id !== businessId ||
          !stamp(t.created) || Date.parse(t.created) < lower || Date.parse(t.created) > upper) throw processingFailure('PROCESSING_SOURCE_INVALID');
      seen.add(t.id);
      if (PROCESSING_TYPES.includes(t.type)) charges.push(processingCharge(t, businessId!));
      else if (t.cashflow === 'MONEY_OUT') otherOutflowCount++;
    }
    if (!body.has_more) {
      const fee = charges.filter(c => c.type === PROCESSING_TYPES[0]).reduce((a, c) => a + xenditMinorUnits(c.amount)!, 0);
      const vat = charges.filter(c => c.type === PROCESSING_TYPES[1]).reduce((a, c) => a + xenditMinorUnits(c.amount)!, 0);
      return { fromDate, toDate, checkedAt: new Date(clock()).toISOString(), complete: true, charges,
        feeAmount: fee / 100, vatAmount: vat / 100, totalAmount: (fee + vat) / 100, otherOutflowCount };
    }
    // Only an observed ID is used as a cursor; provider links are never followed.
    cursor = body.data[body.data.length - 1].id;
  }
  throw processingFailure('PROCESSING_SCAN_INCOMPLETE');
}
