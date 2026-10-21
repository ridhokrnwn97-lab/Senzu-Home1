import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { OFFICIAL_SENZU_BANK_ACCOUNTS, OFFICIAL_SENZU_QRIS } from '../lib/paymentDefaults.ts';

export const paymentError = (status: number, message: string) => Object.assign(new Error(message), { status });
export function assertManualPayment(payment: any) {
  if (payment?.provider === 'xendit' || payment?.gatewayEnvironment === 'live') {
    throw paymentError(409, 'Pembayaran Xendit harus diperiksa melalui integrasi Xendit, bukan verifikasi atau koreksi manual.');
  }
}
const uidValue = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
export function paymentOwner(record: any): string | null {
  const primary = uidValue(record?.customerAuthUid);
  const legacy = uidValue(record?.authUserId);
  if (primary && legacy && primary !== legacy) throw paymentError(403, 'Kepemilikan pembayaran tidak valid.');
  return primary || legacy;
}
export function assertPaymentLink(payment: any, booking: any, callerUid?: string) {
  if (!booking) throw paymentError(404, 'Data reservasi tidak ditemukan.');
  const bookingOwner = paymentOwner(booking);
  const owner = paymentOwner(payment);
  if (owner && bookingOwner && owner !== bookingOwner) throw paymentError(403, 'Kepemilikan pembayaran tidak valid.');
  // An unowned booking requires provenance review, never a CRM/phone match.
  if (callerUid && (!bookingOwner || bookingOwner !== callerUid || (owner && owner !== callerUid))) {
    throw paymentError(403, 'Anda tidak memiliki akses ke pembayaran ini.');
  }
}
export function bookingDeadline(booking: any, createTimeMs: number): string | null {
  if (booking.paymentPolicyVersion === 2) {
    if (!Number.isFinite(createTimeMs)) throw paymentError(409, 'Waktu pembuatan reservasi tidak tersedia.');
    const expected = new Date(createTimeMs + 60 * 60 * 1000).toISOString();
    if (booking.paymentDeadline && booking.paymentDeadline !== expected) throw paymentError(409, 'Batas waktu pembayaran tidak konsisten.');
    return expected;
  }
  // No retroactive expiry for legacy records without a persisted deadline.
  if (!booking.paymentDeadline) return null;
  if (!Number.isFinite(Date.parse(booking.paymentDeadline))) throw paymentError(409, 'Batas waktu pembayaran tidak valid.');
  return booking.paymentDeadline;
}
function methodSnapshot(method: string, settings: any) {
  if (!['qris', 'bni', 'mandiri', 'bri'].includes(method)) throw paymentError(400, 'Metode pembayaran tidak tersedia.');
  if (settings?.manualPaymentEnabled === false) throw paymentError(400, 'Pembayaran manual tidak tersedia.');
  const qris = { ...OFFICIAL_SENZU_QRIS, ...settings?.qris };
  const banks = Array.isArray(settings?.bankAccounts) && settings.bankAccounts.length ? settings.bankAccounts : OFFICIAL_SENZU_BANK_ACCOUNTS;
  const bank = banks.find((b: any) => b.bankCode?.toLowerCase() === method);
  if (method === 'qris' ? !qris.enabled : !bank || bank.enabled === false) throw paymentError(400, 'Metode pembayaran tidak tersedia.');
  const bankCode = method === 'qris' ? 'QRIS' : bank.bankCode;
  const bankName = method === 'qris' ? 'QRIS SENZU' : bank.bankName || bank.bankCode;
  return {
    paymentMethod: method === 'qris' ? 'QRIS Senzu' : `Transfer ${bankName}`,
    bankCode, bankName, bankNameSnapshot: bankName,
    accountNumberSnapshot: method === 'qris' ? qris.nmid : bank.accountNumber,
    accountHolderSnapshot: method === 'qris' ? qris.accountHolder : bank.accountHolder,
    provider: method === 'qris' ? 'bni_merchant' : 'manual_senzu',
  };
}
function validId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 200) throw paymentError(400, 'ID pembayaran atau reservasi tidak valid.');
}
export function validateProof(input: any) {
  const { dataUrl, mimeType, fileName } = input;
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(mimeType) || typeof fileName !== 'string' || !fileName || fileName.length > 255 || typeof dataUrl !== 'string' || dataUrl.length > 700000) {
    throw paymentError(400, 'Format atau ukuran bukti pembayaran tidak valid.');
  }
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw paymentError(400, 'Format bukti pembayaran tidak valid.');
  const base64 = dataUrl.slice(prefix.length);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 500 * 1024 || bytes.toString('base64') !== base64) throw paymentError(400, 'Ukuran bukti pembayaran tidak valid.');
  const signature = mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mimeType === 'image/webp' ? bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'
    : bytes.subarray(0,5).toString() === '%PDF-';
  if (!signature) throw paymentError(400, 'Isi file tidak sesuai dengan format bukti pembayaran.');
  return { dataUrl, mimeType, fileName, hash: createHash('sha256').update(bytes).digest('hex') };
}

/** Uses only injected Admin Firestore; importing this module never initializes production. */
export function createPaymentAcceptance(db: Firestore, clock = Date.now) {
  return {
    async initialize(uid: string, input: any) {
      validId(input.bookingId);
      const bookingRef = db.collection('bookings').doc(input.bookingId);
      return db.runTransaction(async t => {
        const snap = await t.get(bookingRef);
        if (!snap.exists) throw paymentError(404, 'Data reservasi tidak ditemukan.');
        const booking = snap.data()!;
        assertPaymentLink({}, booking, uid);
        if (booking.paymentMethod === 'Xendit' || booking.gatewayProvider === 'xendit') {
          throw paymentError(409, 'Pesanan ini menggunakan pembayaran Xendit.');
        }
        const existing = await t.get(db.collection('payments').where('bookingId', '==', snap.id));
        const settings = await t.get(db.collection('settings').doc('payment'));
        const nowMs = clock();
        const now = new Date(nowMs).toISOString();
        const deadline = bookingDeadline(booking, snap.createTime!.toMillis());
        const records = existing.docs.map(d => ({ ...d.data(), id: d.id } as any));
        for (const p of records) assertPaymentLink(p, booking, uid);
        // Preserve legacy selection precedence; new records use one deterministic ID.
        const active = records.find(p => p.status === 'paid') || records.find(p => p.status === 'pending_manual_verification') || records.find(p => p.status === 'expired') || records.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
        if (active && ['paid', 'pending_manual_verification', 'expired', 'payment_rejected'].includes(active.status)) return { payment: active, isIdempotent: true };
        if (!active && ['Completed', 'Cancelled', 'expired'].includes(booking.status)) throw paymentError(409, 'Reservasi ini tidak menerima pembayaran baru.');
        const method = methodSnapshot(input.methodType, settings.data());
        // Preserve the current service + home-service-fee formula; do not change pricing policy.
        const amount = (booking.servicePrice || 0) + (booking.homeServiceFee || 0);
        if (!Number.isFinite(amount) || amount < 0) throw paymentError(409, 'Nominal reservasi tidak valid.');
        const effectiveDeadline = active?.paymentDeadline || deadline;
        if (booking.paymentPolicyVersion === 2 && active?.paymentDeadline && active.paymentDeadline !== deadline) throw paymentError(409, 'Batas waktu pembayaran tidak konsisten.');
        const expired = !!effectiveDeadline && !active?.paymentProofUrl && nowMs >= Date.parse(effectiveDeadline);
        const ref = active ? db.collection('payments').doc(active.id) : db.collection('payments').doc(`PAY-${snap.id}`);
        const payment = {
          ...(active || { id: ref.id, bookingId: snap.id, bookingCode: booking.bookingCode || '', customerId: booking.customerId || '', customerName: booking.customerName || '', customerWhatsApp: booking.customerWhatsApp || '', customerAuthUid: uid, authUserId: uid, paymentType: 'manual', currency: 'IDR', amount, createdAt: now }),
          ...method, paymentDeadline: effectiveDeadline, updatedAt: now,
          status: expired ? 'expired' : active?.status || 'unpaid',
          ...(expired ? { expiredAt: now } : {}),
        };
        t.set(ref, payment);
        t.update(bookingRef, { activePaymentId: ref.id, paymentDeadline: deadline, ...(expired ? { paymentStatus: 'expired', paymentExpiredAt: now } : {}) });
        if (!active || expired) t.set(db.collection('payment_status_history').doc(), {
          paymentId: ref.id, bookingId: snap.id, bookingCode: booking.bookingCode || '', newStatus: payment.status,
          oldStatus: active?.status || null, userId: uid, source: 'customer', eventType: expired ? 'payment_expired' : 'payment_created', createdAt: now,
        });
        return { payment, isIdempotent: false };
      });
    },
    async acceptProof(uid: string, paymentId: string, input: any) {
      validId(paymentId);
      const proof = validateProof(input);
      const ref = db.collection('payments').doc(paymentId);
      return db.runTransaction(async t => {
        const snap = await t.get(ref);
        if (!snap.exists) throw paymentError(404, 'Data pembayaran tidak ditemukan.');
        const payment = snap.data()!;
        assertManualPayment(payment);
        validId(payment.bookingId);
        if (input.bookingId && input.bookingId !== payment.bookingId) throw paymentError(400, 'ID reservasi tidak sesuai dengan pembayaran.');
        const bookingRef = db.collection('bookings').doc(payment.bookingId);
        const bookingSnap = await t.get(bookingRef);
        const booking = bookingSnap.data();
        assertPaymentLink(payment, booking, uid);
        if (payment.status === 'pending_manual_verification' && payment.paymentProofHash === proof.hash) return { payment: { ...payment, id: snap.id }, isIdempotent: true };
        if (!['unpaid', 'pending', 'pending_payment'].includes(payment.status)) throw paymentError(409, 'Pembayaran ini tidak menerima bukti baru.');
        const deadline = payment.paymentDeadline || bookingDeadline(booking, bookingSnap.createTime!.toMillis());
        const nowMs = clock(); // Recomputed after each transaction retry, never supplied by client.
        if (deadline && (!Number.isFinite(Date.parse(deadline)) || nowMs >= Date.parse(deadline))) throw paymentError(409, 'Waktu pembayaran telah berakhir.');
        const now = new Date(nowMs).toISOString();
        const update = { paymentProofUrl: proof.dataUrl, paymentProofFileName: proof.fileName, paymentProofMimeType: proof.mimeType,
          paymentProofHash: proof.hash, paymentProofUploadedAt: now, paymentProofUploadedBy: booking!.customerName || uid,
          status: 'pending_manual_verification', updatedAt: now };
        t.update(ref, update);
        t.update(bookingRef, { paymentStatus: 'pending_manual_verification', updatedAt: now });
        t.set(db.collection('payment_status_history').doc(), { paymentId: snap.id, bookingId: payment.bookingId, bookingCode: payment.bookingCode || '', oldStatus: payment.status, newStatus: update.status, source: 'customer', userId: uid, eventType: 'payment_proof_uploaded', createdAt: now });
        return { payment: { ...payment, ...update, id: snap.id }, isIdempotent: false };
      });
    },
  };
}
export function registerPaymentAcceptance(app: Express, db: Firestore | null, verify: (token: string) => Promise<any>) {
  const route = (action: 'initialize' | 'acceptProof') => async (req: any, res: any) => {
    try {
      const match = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
      if (!match) throw paymentError(401, 'Autentikasi pembayaran diperlukan.');
      const identity = await verify(match[1]).catch(() => null);
      if (!identity?.uid) throw paymentError(401, 'Sesi autentikasi tidak valid.');
      if (!db) throw paymentError(503, 'Database pembayaran tidak tersedia.');
      const service = createPaymentAcceptance(db);
      const result = action === 'initialize' ? await service.initialize(identity.uid, req.body || {}) : await service.acceptProof(identity.uid, req.params.paymentId, req.body || {});
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Layanan pembayaran tidak tersedia. Silakan coba kembali.' });
    }
  };
  app.post('/api/payments/lookup', async (req, res) => {
    try {
      const match = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
      const identity = match ? await verify(match[1]).catch(() => null) : null;
      if (!identity?.uid) throw paymentError(401, 'Sesi autentikasi tidak valid.');
      if (!db) throw paymentError(503, 'Database pembayaran tidak tersedia.');
      validId(req.body?.bookingId);
      const result = await db.runTransaction(async t => {
        const bookingSnap = await t.get(db.collection('bookings').doc(req.body.bookingId));
        const roleSnap = await t.get(db.collection('staff_roles').doc(identity.uid));
        const role = roleSnap.data();
        const staff = role?.isActive === true && ['css','supervisor','manager','admin'].includes(role.role);
        const booking = bookingSnap.data();
        assertPaymentLink({}, booking, staff ? undefined : identity.uid);
        const payments = await t.get(db.collection('payments').where('bookingId','==',bookingSnap.id));
        const records = payments.docs.map(d => ({ ...d.data(), id: d.id } as any));
        for (const record of records) assertPaymentLink(record, booking, staff ? undefined : identity.uid);
        return records.find(p => p.status === 'paid') || records.find(p => p.status === 'pending_manual_verification') || records.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
      });
      res.json({ success: true, payment: result });
    } catch (error: any) {
      res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Data pembayaran tidak dapat dimuat.' });
    }
  });
  app.post('/api/payments/initialize', route('initialize'));
  app.post('/api/payments/:paymentId/proof', route('acceptProof'));
}
