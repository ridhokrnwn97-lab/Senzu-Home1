import { auth } from './firebase';

export const PROCESSING_ACK = 'ACTUAL_XENDIT_PROCESSING_DEBITS_AS_EXPENSE_NO_PRIOR_MANUAL_POSTING';
export const PROCESSING_TYPES = ['PROCESSING_FEE_DEDUCTION', 'PROCESSING_FEE_VAT_DEDUCTION'];
export type ProcessingChargeView = { transactionId: string; referenceId: string; productId: string; businessId: string;
  type: string; amount: number; createdAt: string; date: string };
export type ProcessingPreviewView = { fromDate: string; toDate: string; checkedAt: string; complete: true;
  charges: ProcessingChargeView[]; feeAmount: number; vatAmount: number; totalAmount: number; otherOutflowCount: number };
export type ProcessingStatusView = { enabled: boolean; fromDate: string | null; activatedAt: string | null;
  lastScanAt: string | null; lastScanFromDate: string | null; lastScanToDate: string | null; issue: string;
  jobs: { id: string; transactionId: string; type: string; date: string; amount: number; number: string; state: string; issue: string }[] };
const day = (v: unknown) => typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const stamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000000000 && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001;
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const issue = (v: unknown) => typeof v === 'string' && (v === '' || /^[A-Z_]{1,80}$/.test(v));
export function validProcessingPreview(v: any): v is ProcessingPreviewView {
  if (!v || v.complete !== true || !day(v.fromDate) || !day(v.toDate) || !stamp(v.checkedAt) ||
      ![v.feeAmount, v.vatAmount, v.totalAmount].every(money) || !Number.isSafeInteger(v.otherOutflowCount) || v.otherOutflowCount < 0 ||
      !Array.isArray(v.charges) || v.charges.length > 1000 || v.charges.some((c: any) => !id(c?.transactionId) || !id(c.referenceId) ||
        typeof c.businessId !== 'string' || !PROCESSING_TYPES.includes(c.type) || !money(c.amount) || c.amount <= 0 ||
        !day(c.date) || c.date < v.fromDate || c.date > v.toDate || !stamp(c.createdAt) ||
        c.productId !== c.referenceId + (c.type === PROCESSING_TYPES[1] ? ':vat' : '')) ||
      new Set(v.charges.map((c: any) => c.transactionId)).size !== v.charges.length) return false;
  const sum = (kind: string) => v.charges.filter((c: any) => c.type === kind).reduce((n: number, c: any) => n + Math.round(c.amount * 100), 0);
  return sum(PROCESSING_TYPES[0]) === Math.round(v.feeAmount * 100) && sum(PROCESSING_TYPES[1]) === Math.round(v.vatAmount * 100) &&
    Math.round(v.feeAmount * 100) + Math.round(v.vatAmount * 100) === Math.round(v.totalAmount * 100);
}
export function validProcessingStatus(v: any): v is ProcessingStatusView {
  return !!v && typeof v.enabled === 'boolean' && [v.fromDate, v.lastScanFromDate, v.lastScanToDate].every(d => d === null || day(d)) &&
    [v.activatedAt, v.lastScanAt].every(d => d === null || stamp(d)) && (!v.enabled || !!v.fromDate && !!v.activatedAt) && issue(v.issue) &&
    Array.isArray(v.jobs) && v.jobs.length <= 30 && v.jobs.every((r: any) => /^[a-f0-9]{64}$/.test(r?.id || '') &&
      r.number === `SHPF-${r.id.slice(0, 24)}` && id(r.transactionId) && PROCESSING_TYPES.includes(r.type) && day(r.date) &&
      money(r.amount) && r.amount > 0 && ['pending', 'sending', 'retry', 'review', 'confirmed'].includes(r.state) && issue(r.issue));
}
export async function accurateProcessingAction(action: 'processingStatus' | 'processingPreview' | 'activateProcessing' | 'pauseProcessing' | 'runProcessing' | 'reconcileProcessing', body: Record<string, unknown> = {}, signal?: AbortSignal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan masuk sebagai Manager.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna berubah.');
  const response = await fetch(`/api/integrations/accurate/sync/${action}`, { method: 'POST', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(95000)]),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const v = await response.json().catch(() => null);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna berubah.');
  if (!response.ok || v?.success !== true) throw new Error('Permintaan processing fee belum berhasil.' +
    (issue(v?.code) && v.code ? ` Kode: ${v.code}.` : ' Coba muat ulang.'));
  if (action === 'processingPreview') {
    if (!validProcessingPreview(v.preview) || v.preview.fromDate !== body.fromDate || v.preview.toDate !== body.toDate) throw new Error('Bukti potongan tidak valid.');
  } else if (!validProcessingStatus(v.processing)) throw new Error('Status processing fee tidak valid.');
  return v;
}
