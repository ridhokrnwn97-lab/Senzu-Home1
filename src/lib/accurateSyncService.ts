import { auth } from './firebase';
import { ACCURATE_SYNC_ACK, ACCURATE_SYNC_DATABASE_ID, type AccurateSyncStatus, type AccurateSyncPreview } from './accurateSyncContracts';

async function request(action: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Silakan masuk sebagai Manager atau Admin.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  const response = await fetch(`/api/integrations/accurate/sync/${action}`, { method: 'POST', cache: 'no-store', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sesi pengguna telah berubah.');
  if (!response.ok || value?.success !== true) throw new Error('Permintaan Accurate belum berhasil.' +
    (typeof value?.code === 'string' && /^[A-Z_]{1,60}$/.test(value.code) ? ` Kode: ${value.code}.` : ' Coba muat ulang.'));
  return value;
}
export async function accurateSyncAction(action: 'status' | 'activate' | 'pause' | 'run' | 'retry', bookingId?: string, signal?: AbortSignal): Promise<AccurateSyncStatus> {
  const body = action === 'activate' ? { acknowledgement: ACCURATE_SYNC_ACK, taxPolicy: 'no_extra_tax' } : action === 'retry' ? { bookingId } : {};
  const v = await request(action, body, signal);
  if (v.mode !== 'posting_v1' || v.databaseId !== ACCURATE_SYNC_DATABASE_ID ||
      ['writesConfigured', 'schedulerConfigured', 'enabled'].some(k => typeof v[k] !== 'boolean') ||
      !(v.activatedAt === null || typeof v.activatedAt === 'string' && Number.isFinite(Date.parse(v.activatedAt))) ||
      ![null, 'no_extra_tax'].includes(v.taxPolicy) || !Array.isArray(v.jobs) || v.jobs.length > 20 ||
      v.jobs.some((j: any) => !/^[a-f0-9]{64}$/.test(j?.id || '') || typeof j.bookingCode !== 'string' || !/^SH-\d{6}-[A-Z0-9]{5,20}$/.test(j.bookingCode) ||
        !Number.isSafeInteger(j.amount) || j.amount < 10000 || j.amount > 10000000 || !['queued', 'processing', 'waiting_service', 'retry', 'review', 'complete'].includes(j.state) ||
        typeof j.note !== 'string' || !Number.isFinite(Date.parse(j.createdAt)) || !Number.isFinite(Date.parse(j.updatedAt)) ||
        j.downPaymentNumber !== `SHDP-${j.id.slice(0, 24)}` || j.receiptNumber !== `SHRC-${j.id.slice(0, 24)}` || j.invoiceNumber !== `SHIV-${j.id.slice(0, 24)}` ||
        !Array.isArray(j.confirmed) || j.confirmed.some((k: any) => !['down_payment', 'receipt', 'invoice'].includes(k)))) {
    throw new Error('Respons status pencatatan Accurate tidak valid.');
  }
  return v;
}
export async function accurateSyncPreview(bookingId: string, signal?: AbortSignal): Promise<AccurateSyncPreview> {
  const v = await request('preview', { bookingId }, signal);
  if (!/^SH-\d{6}-[A-Z0-9]{5,20}$/.test(v.bookingCode || '') || ['amount', 'servicePrice', 'visitFee', 'discount'].some(k => !Number.isSafeInteger(v[k]) || v[k] < 0 || v[k] > 10000000) ||
      v.servicePrice + v.visitFee - v.discount !== v.amount || typeof v.historical !== 'boolean' || typeof v.eligible !== 'boolean' ||
      ![null, 'SH-SIG-030', 'SH-SIG-060', 'SH-SIG-090', 'SH-SIG-120'].includes(v.itemCode) || typeof v.note !== 'string' ||
      !/^SHDP-[a-f0-9]{24}$/.test(v.downPaymentNumber || '') || !/^SHRC-[a-f0-9]{24}$/.test(v.receiptNumber || '') || !/^SHIV-[a-f0-9]{24}$/.test(v.invoiceNumber || '')) {
    throw new Error('Respons pratinjau Accurate tidak valid.');
  }
  return v;
}
