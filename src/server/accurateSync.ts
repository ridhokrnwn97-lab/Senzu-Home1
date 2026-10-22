import type { Express, Request } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ACCURATE_SYNC_ACK, ACCURATE_SYNC_DATABASE_ID as TARGET, ACCURATE_SYNC_NOTES, ACCURATE_NET_PREVIEW_ERRORS,
  type AccurateSyncJobState, type AccurateSyncJobView, type AccurateSyncPreview, type AccurateSyncStatus, type AccurateXenditNetPreview } from '../lib/accurateSyncContracts.ts';
import { liveQuoteSeal } from './xenditLiveQuote.ts';
import { readXenditNetPreview } from './xenditNetPreview.ts';
import { createAccurateSyncProvider, matchesAccurateCustomerNo, normalizeAccurate, positiveId, syncCredentialsConfigured, syncFailure,
  type AccurateDocumentKind } from './accurateSyncProvider.ts';

const JOBS = 'accurate_sync_jobs', OPS = 'accurate_sync_operations', CONTROL = 'accurate_sync_private';
const PARKED = Number.MAX_SAFE_INTEGER;
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const jobId = (bookingId: string) => hash([TARGET, bookingId]);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10000000;
const stampTime = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
const wibDate = (value: string) => {
  const date = new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
};
const providerDate = (value: unknown) => typeof value === 'string' ? /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value :
  /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : null : null;
const numbers = (id: string) => ({ downPaymentNumber: `SHDP-${id.slice(0, 24)}`, receiptNumber: `SHRC-${id.slice(0, 24)}`, invoiceNumber: `SHIV-${id.slice(0, 24)}` });
const MESSAGES: Record<string, string> = {
  ...ACCURATE_NET_PREVIEW_ERRORS,
  AUTH_REQUIRED: 'Silakan masuk sebagai Manager atau Admin.', AUTH_INVALID: 'Sesi login tidak valid.',
  AUTH_UNAVAILABLE: 'Verifikasi login belum tersedia.', MANAGER_ROLE_REQUIRED: 'Akses Manager atau Admin aktif diperlukan.',
  INVALID_SYNC_REQUEST: 'Permintaan pencatatan Accurate tidak valid.', DATABASE_UNAVAILABLE: 'Database belum tersedia.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Coba sebentar lagi.', SYNC_NOT_CONFIGURED: 'Pengiriman belum diizinkan di konfigurasi server.',
  SYNC_APPROVAL_REQUIRED: 'Konfirmasi cakupan booking baru dan kebijakan pajak diperlukan.',
  SYNC_CONTROL_INVALID: 'Pengaturan pencatatan perlu diperiksa.', SYNC_SOURCE_INVALID: 'Data booking atau pembayaran perlu diperiksa.',
  SYNC_JOB_MISSING: 'Booking ini tidak masuk antrean pencatatan otomatis.', SYNC_BUSY: 'Antrean masih diproses. Coba muat ulang.',
  ACCURATE_TARGET_MISMATCH: 'Aplikasi atau database Accurate tidak cocok dengan PT KSBONE UNTUK KITA (2974047).',
  ACCURATE_SYNC_SECRETS_INVALID: 'Secrets Accurate atau ID database perlu diperiksa.',
  ACCURATE_MASTER_MISMATCH: 'Akun atau layanan Accurate belum cocok.', ACCURATE_CURRENCY_UNVERIFIED: 'Mata uang akun Accurate belum dapat diverifikasi sebagai IDR.',
  ACCURATE_ITEM_ACCOUNTS_UNVERIFIED: 'Akun pendapatan atau diskon pada layanan Accurate belum dapat diverifikasi.',
  ACCURATE_TAX_REVIEW_REQUIRED: 'Pengaturan pajak layanan memerlukan pemeriksaan Finance.',
  ACCURATE_DOCUMENT_COLLISION: 'Nomor dokumen sudah ada tetapi tidak cocok dengan transaksi ini.',
  ACCURATE_DOCUMENT_UNCERTAIN: 'Hasil pembuatan dokumen belum pasti. Periksa dokumen dengan nomor yang tercantum; pembuatan tidak diulang otomatis.',
  ACCURATE_DOCUMENT_MISMATCH: 'Isi dokumen Accurate perlu diperiksa sebelum melanjutkan.',
  ACCURATE_HOST_UNVERIFIED: 'Alamat server Accurate belum dapat diverifikasi.', ACCURATE_REQUEST_REJECTED: 'Accurate menolak permintaan. Periksa izin dan pengaturan data.',
  ACCURATE_RESPONSE_UNVERIFIED: 'Respons Accurate belum dapat diverifikasi.', ACCURATE_RETRY: 'Accurate belum dapat dihubungi. Antrean tetap disimpan.',
  SYNC_PAUSED: 'Pengiriman sedang dijeda. Antrean tetap disimpan.', SYNC_HISTORICAL: 'Booking dibuat sebelum aktivasi. Tidak dimasukkan otomatis.',
  SYNC_WAIT_SERVICE: 'Menunggu treatment selesai.', SYNC_SERVICE_UNMAPPED: 'Layanan ini belum mempunyai pemetaan Accurate.',
  SYNC_SOURCE_CHANGED: 'Booking, pembayaran, pembatalan, atau refund berubah. Perlu pemeriksaan Finance.',
  SYNC_PAYMENT_DATE_REVIEW_REQUIRED: 'Sesi dan konfirmasi pembayaran melewati pergantian tanggal WIB. Finance perlu memastikan tanggal pembayaran dari Xendit.',
};
const fail = (status: number, code: string) => Object.assign(new Error(MESSAGES[code] || 'Pencatatan Accurate belum berhasil.'), { status, code });
type Dependencies = {
  db: Firestore | null; verify: (token: string) => Promise<{ uid: string }>;
  authorizeManager: (transaction: Transaction, uid: string) => Promise<unknown>;
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: () => number; pause?: (ms: number) => Promise<void>;
};
export type AccuratePaidEvent = { booking: any; payment: any; intent: any; receipt: any; bookingCreatedAt: number };
function control(value: any) {
  if (!value) return null;
  if (value.schemaVersion !== 1 || value.databaseId !== TARGET || value.taxPolicy !== 'no_extra_tax' ||
      typeof value.enabled !== 'boolean' || !Number.isFinite(stampTime(value.activatedAt))) throw syncFailure('SYNC_CONTROL_INVALID', true);
  return value;
}
function terms(booking: any, payment: any) {
  const durations: Record<number, [string, string[]]> = {
    30: ['SH-SIG-030', ['Signature Treatment', 'Senzu Home - Signature Treatment 30 Menit']],
    60: ['SH-SIG-060', ['Senzu Home Signature 60 Menit']],
    90: ['SH-SIG-090', ['Senzu Home Signature 90 Menit']],
    120: ['SH-SIG-120', ['Senzu Home Signature 120 Menit']],
  };
  const mapped = durations[booking.serviceDuration];
  const itemCode = mapped?.[1].some(name => normalizeAccurate(name) === normalizeAccurate(booking.serviceName)) ? mapped[0] : null;
  const { servicePrice, homeServiceFee: visitFee, discountAmount: discount, totalAmount: amount } = booking;
  if (![servicePrice, visitFee, discount, amount].every(integer) || amount < 10000 || servicePrice <= 0 ||
      servicePrice + visitFee - discount !== amount || payment.amount !== amount) throw syncFailure('SYNC_SOURCE_INVALID', true);
  return { itemCode, servicePrice, visitFee, discount, amount };
}
function core(v: AccuratePaidEvent) {
  const { booking: b, payment: p, intent: i, receipt: r } = v;
  if (!b || !p || !i || !r || !safeId(b.id) || !/^SH-\d{6}-[A-Z0-9]{5,20}$/.test(b.bookingCode || '') ||
      b.paymentMethod !== 'Xendit' || b.gatewayProvider !== 'xendit' || b.gatewayEnvironment !== 'live' ||
      !safeId(b.customerAuthUid) || b.customerAuthUid !== b.authUserId || b.gatewayReviewRequired ||
      !['paid', 'PAID'].includes(b.paymentStatus) || b.activePaymentId !== p.id || p.id !== `PAY-${b.id}` ||
      p.status !== 'paid' || p.bookingId !== b.id || p.provider !== 'xendit' || p.gatewayEnvironment !== 'live' ||
      p.reconciliationRequired || p.correctedAt || p.verifiedBy !== 'xendit' || p.customerAuthUid !== b.customerAuthUid ||
      i.environment !== 'live' || i.bookingId !== b.id || i.ownerUid !== b.customerAuthUid || i.sessionStatus !== 'COMPLETED' ||
      !/^shl_[a-f0-9]{48}$/.test(i.referenceId || '') || i.referenceId !== p.providerReferenceId ||
      !/^ps-[A-Za-z0-9-]{16,80}$/.test(i.sessionId || '') || i.sessionId !== p.gatewaySessionId ||
      !/^py-[A-Za-z0-9-]{16,100}$/.test(i.paymentId || '') || i.paymentId !== p.providerTransactionId ||
      r.schemaVersion !== 2 || r.bookingId !== b.id || r.customerAuthUid !== b.customerAuthUid ||
      r.gatewayEnvironment !== 'live' || r.gatewayProvider !== 'xendit' || r.paymentMethod !== 'Xendit' ||
      r.gatewayQuoteHash !== i.quoteHash || liveQuoteSeal(b) !== i.quoteHash ||
      !Number.isFinite(stampTime(p.paidAt)) || !Number.isFinite(stampTime(i.createdAt)) || stampTime(p.paidAt) < stampTime(i.createdAt) ||
      r.totalAmount !== p.amount || i.amount !== p.amount) throw syncFailure('SYNC_SOURCE_INVALID', true);
  // The existing app's paidAt is its first successful API verification time.
  // It bounds the actual payment date together with the session creation time;
  // across WIB midnight that date cannot be proved without provider evidence.
  if (wibDate(i.createdAt) !== wibDate(p.paidAt)) throw syncFailure('SYNC_PAYMENT_DATE_REVIEW_REQUIRED', true);
  return terms(b, p);
}

export function createAccurateSync(deps: Dependencies) {
  const db = deps.db, env = deps.env || process.env, clock = deps.clock || Date.now;
  const provider = createAccurateSyncProvider({ ...deps, env });
  const ref = () => db!.collection(CONTROL).doc('control');
  const now = () => new Date(clock()).toISOString();
  const rates = new Map<string, { count: number; until: number }>();
  const configured = () => env.ACCURATE_SYNC_WRITES_ENABLED === 'true' && syncCredentialsConfigured(env);
  const schedulerConfigured = () => /^[A-Za-z0-9_-]{43,128}$/.test(env.ACCURATE_SYNC_WORKER_TOKEN || '');
  let localBusy = false, wakePending = false;
  function rate(key: string, max: number) {
    for (const [k, v] of rates) if (v.until <= clock()) rates.delete(k);
    const v = rates.get(key);
    if (v && v.count >= max || !v && rates.size >= 5000) throw fail(429, 'RATE_LIMITED');
    rates.set(key, { count: (v?.count || 0) + 1, until: v?.until || clock() + 60000 });
  }
  async function actor(req: Request, keys: string[]) {
    rate(`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`, 100);
    const count = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(v => v.toLowerCase() === 'authorization').length;
    const match = typeof req.headers.authorization === 'string' && /^Bearer (\S+)$/.exec(req.headers.authorization);
    if (count > 1 || Object.keys(req.headers).some(k => ['x-firebase-auth', 'x-accurate-worker-token'].includes(k.toLowerCase()))) throw fail(401, 'AUTH_INVALID');
    if (!match) throw fail(401, 'AUTH_REQUIRED');
    let identity: { uid: string };
    try { identity = await deps.verify(match[1]); } catch (e: any) {
      const invalid = /^auth\/(id-token-expired|id-token-revoked|invalid-id-token|argument-error|user-disabled|user-not-found)$/.test(e?.code || '');
      throw fail(invalid ? 401 : 503, invalid ? 'AUTH_INVALID' : 'AUTH_UNAVAILABLE');
    }
    if (!safeId(identity?.uid)) throw fail(401, 'AUTH_INVALID');
    if (!db) throw fail(503, 'DATABASE_UNAVAILABLE');
    await db.runTransaction(t => deps.authorizeManager(t, identity.uid));
    rate(`uid:${identity.uid}`, 30);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(k => !keys.includes(k))) throw fail(400, 'INVALID_SYNC_REQUEST');
    return identity.uid;
  }
  async function stagePaid(t: Transaction, v: AccuratePaidEvent) {
    // Called inside the payment transaction BEFORE its first write. Failure rolls
    // back payment + queue together; the provider webhook/status retry can recover.
    const c = control((await t.get(ref())).data());
    if (!c || !Number.isFinite(v.bookingCreatedAt) || v.bookingCreatedAt <= stampTime(c.activatedAt) ||
        stampTime(v.intent.createdAt) <= stampTime(c.activatedAt) || !Number.isFinite(stampTime(v.intent.createdAt))) return;
    const id = jobId(v.booking.id), jr = db!.collection(JOBS).doc(id), existing = await t.get(jr);
    if (existing.exists) return;
    let commercial: ReturnType<typeof terms> | null = null, issue = '';
    try { commercial = core(v); if (!commercial.itemCode) issue = 'SYNC_SERVICE_UNMAPPED'; }
    catch (e: any) { issue = MESSAGES[e.code] ? e.code : 'SYNC_SOURCE_INVALID'; }
    t.create(jr, { schemaVersion: 1, databaseId: TARGET, bookingId: v.booking.id, bookingCode: v.booking.bookingCode,
      paymentId: v.payment.id, referenceId: v.intent.referenceId, quoteHash: v.intent.quoteHash,
      ownerHash: hash([TARGET, v.booking.customerAuthUid]), amount: v.payment.amount,
      state: issue ? 'review' : 'queued', issue, commercial, createdAt: now(), updatedAt: now(),
      wakeAt: issue ? PARKED : clock(), documents: {}, attempts: 0 });
  }
  async function source(t: Transaction, bookingId: string): Promise<AccuratePaidEvent> {
    const bs = await t.get(db!.collection('bookings').doc(bookingId)), b = bs.data();
    if (!b || b.id !== bookingId || !safeId(b.gatewayReceiptId)) throw syncFailure('SYNC_SOURCE_INVALID', true);
    const ps = await t.get(db!.collection('payments').doc(`PAY-${bookingId}`)), p = ps.data();
    if (!p || !/^shl_[a-f0-9]{48}$/.test(p.providerReferenceId || '')) throw syncFailure('SYNC_SOURCE_INVALID', true);
    const [is, rs] = await Promise.all([t.get(db!.collection('xendit_live_sessions').doc(p.providerReferenceId)),
      t.get(db!.collection('voucher_checkout_receipts').doc(b.gatewayReceiptId))]);
    return { booking: b, payment: p, intent: is.data(), receipt: rs.data(), bookingCreatedAt: bs.createTime?.toMillis() || NaN };
  }
  const jobView = (id: string, job: any): AccurateSyncJobView => ({ id, bookingCode: job.bookingCode, amount: job.amount,
    state: job.state, createdAt: job.createdAt, updatedAt: job.updatedAt,
    note: MESSAGES[job.issue] || ACCURATE_SYNC_NOTES[job.state] || ACCURATE_SYNC_NOTES.review,
    ...numbers(id), confirmed: (['down_payment', 'receipt', 'invoice'] as const).filter(kind => Boolean(job.documents?.[kind]?.id)) });
  async function statusValue(uid: string): Promise<AccurateSyncStatus> {
    const [cs, latest] = await Promise.all([ref().get(), db!.collection(JOBS).orderBy('createdAt', 'desc').limit(20).get()]);
    const c = control(cs.data());
    await db!.runTransaction(t => deps.authorizeManager(t, uid));
    return { mode: 'posting_v1', databaseId: TARGET, writesConfigured: configured(), schedulerConfigured: schedulerConfigured(),
      enabled: c?.enabled === true, activatedAt: c?.activatedAt || null, taxPolicy: c?.taxPolicy || null,
      jobs: latest.docs.map(d => jobView(d.id, d.data())) };
  }
  async function status(req: Request) { const uid = await actor(req, []); return statusValue(uid); }
  async function preview(req: Request): Promise<AccurateSyncPreview> {
    const uid = await actor(req, ['bookingId']);
    if (!safeId(req.body.bookingId)) throw fail(400, 'INVALID_SYNC_REQUEST');
    rate(`preview:${uid}`, 3);
    const { v, c } = await db!.runTransaction(async t => ({ v: await source(t, req.body.bookingId), c: control((await t.get(ref())).data()) }));
    const commercial = core(v), at = c ? stampTime(c.activatedAt) : clock();
    const historical = v.bookingCreatedAt <= at || stampTime(v.intent.createdAt) <= at;
    const blocked = ['cancelled', 'canceled', 'refunded', 'expired', 'rescheduled', 'rejected'].includes(String(v.booking.status).toLowerCase());
    // Preview checks vendor mappings but never calls save/create or creates a job.
    const api = await provider.connect(clock() + 45000); await api.masters(commercial.itemCode || undefined);
    await db!.runTransaction(t => deps.authorizeManager(t, uid));
    return { bookingCode: v.booking.bookingCode, ...commercial, historical,
      eligible: !historical && !blocked && Boolean(commercial.itemCode),
      note: historical ? MESSAGES.SYNC_HISTORICAL : blocked ? MESSAGES.SYNC_SOURCE_CHANGED : !commercial.itemCode ? MESSAGES.SYNC_SERVICE_UNMAPPED : 'Data siap untuk pencatatan setelah aktivasi.',
      ...numbers(jobId(v.booking.id)) };
  }
  async function netPreview(req: Request): Promise<AccurateXenditNetPreview> {
    const uid = await actor(req, ['bookingId']), bookingId = req.body.bookingId;
    if (!safeId(bookingId)) throw fail(400, 'INVALID_SYNC_REQUEST');
    rate(`netPreview:${uid}`, 3);
    const readSource = async (t: Transaction) => {
      await deps.authorizeManager(t, uid);
      const v = await source(t, bookingId); core(v);
      if (['cancelled', 'canceled', 'refunded', 'expired', 'rescheduled', 'rejected'].includes(String(v.booking.status).toLowerCase())) {
        throw fail(409, 'SYNC_SOURCE_CHANGED');
      }
      return v;
    };
    const v = await db!.runTransaction(readSource), fingerprint = hash(v);
    const result = await readXenditNetPreview({ bookingCode: v.booking.bookingCode, referenceId: v.intent.referenceId,
      paymentId: v.intent.paymentId, amount: v.payment.amount }, { env, fetch: deps.fetch, clock });
    // Read-only historical inspection is allowed. No queue/control/operation
    // writes, Accurate requests or payment status refreshes occur on this path.
    const latest = await db!.runTransaction(readSource);
    if (hash(latest) !== fingerprint) throw fail(409, 'SYNC_SOURCE_CHANGED');
    return result;
  }
  async function activate(req: Request) {
    const uid = await actor(req, ['acknowledgement', 'taxPolicy']); rate(`activate:${uid}`, 2);
    if (req.body.acknowledgement !== ACCURATE_SYNC_ACK || req.body.taxPolicy !== 'no_extra_tax') throw fail(400, 'SYNC_APPROVAL_REQUIRED');
    if (!configured()) throw fail(503, 'SYNC_NOT_CONFIGURED');
    const api = await provider.connect(clock() + 45000); await api.masters();
    await db!.runTransaction(async t => {
      await deps.authorizeManager(t, uid); const c = control((await t.get(ref())).data());
      t.set(ref(), { ...c, schemaVersion: 1, databaseId: TARGET, taxPolicy: 'no_extra_tax', enabled: true,
        activatedAt: c?.activatedAt || now(), updatedAt: now(), updatedBy: uid }, { merge: true });
    });
    wake(); return statusValue(uid);
  }
  async function pause(req: Request) {
    const uid = await actor(req, []);
    await db!.runTransaction(async t => {
      await deps.authorizeManager(t, uid); const cs = await t.get(ref()); control(cs.data());
      if (cs.exists) t.update(ref(), { enabled: false, updatedAt: now(), updatedBy: uid });
    });
    return statusValue(uid);
  }
  async function retry(req: Request) {
    const uid = await actor(req, ['bookingId']);
    if (!safeId(req.body.bookingId)) throw fail(400, 'INVALID_SYNC_REQUEST');
    rate(`retry:${uid}`, 5);
    await db!.runTransaction(async t => {
      await deps.authorizeManager(t, uid);
      const jr = db!.collection(JOBS).doc(jobId(req.body.bookingId)), snap = await t.get(jr), job = snap.data();
      if (!job || job.bookingId !== req.body.bookingId || job.databaseId !== TARGET) throw fail(404, 'SYNC_JOB_MISSING');
      if (job.state === 'processing') throw fail(409, 'SYNC_BUSY');
      // Operation receipts are immutable here. An uncertain POST can ONLY be
      // reconciled by number; this endpoint never resets it for another POST.
      if (job.state !== 'complete') t.update(jr, { state: 'retry', wakeAt: clock(), updatedAt: now(), issue: '' });
    });
    await runOnce(); return statusValue(uid);
  }
  async function run(req: Request) {
    const uid = await actor(req, []); rate(`run:${uid}`, 3); await runOnce(); return statusValue(uid);
  }
  async function claim() {
    if (!db || !configured()) return null;
    const token = randomUUID();
    return db.runTransaction(async t => {
      const c = control((await t.get(ref())).data());
      if (!c?.enabled || c.leaseUntil > clock()) return null;
      const rows = await t.get(db.collection(JOBS).where('wakeAt', '<=', clock()).orderBy('wakeAt', 'asc').limit(1));
      if (rows.empty) return null;
      const snap = rows.docs[0], job = snap.data();
      if (job.schemaVersion !== 1 || job.databaseId !== TARGET || !safeId(job.bookingId) || snap.id !== jobId(job.bookingId)) throw syncFailure('SYNC_CONTROL_INVALID', true);
      t.update(ref(), { leaseToken: token, leaseUntil: clock() + 90000 });
      t.update(snap.ref, { state: 'processing', attempts: (job.attempts || 0) + 1, wakeAt: clock() + 100000, updatedAt: now() });
      return { id: snap.id, token, job, ref: snap.ref };
    });
  }
  async function leased(t: Transaction, token: string) {
    const c = control((await t.get(ref())).data());
    if (!configured() || !c?.enabled) throw syncFailure('SYNC_PAUSED');
    if (c.leaseToken !== token || c.leaseUntil <= clock()) throw syncFailure('SYNC_BUSY');
    return c;
  }
  async function runOnce() {
    if (localBusy || !db || !configured()) return { processed: 0 };
    localBusy = true; let active: Awaited<ReturnType<typeof claim>> = null;
    try {
      active = await claim(); if (!active) return { processed: 0 };
      const a = active, deadline = clock() + 55000;
      async function fresh() {
        return db!.runTransaction(async t => {
          await leased(t, a.token); const v = await source(t, a.job.bookingId); const commercial = core(v);
          if (v.intent.quoteHash !== a.job.quoteHash || v.payment.id !== a.job.paymentId || v.intent.referenceId !== a.job.referenceId ||
              commercial.amount !== a.job.amount || hash([TARGET, v.booking.customerAuthUid]) !== a.job.ownerHash ||
              JSON.stringify(commercial) !== JSON.stringify(a.job.commercial) ||
              ['cancelled', 'canceled', 'refunded', 'expired', 'rescheduled', 'rejected'].includes(String(v.booking.status).toLowerCase())) throw syncFailure('SYNC_SOURCE_CHANGED', true);
          if (!commercial.itemCode) throw syncFailure('SYNC_SERVICE_UNMAPPED', true);
          return v;
        });
      }
      const v = await fresh(), commercial = core(v), docs = numbers(a.id);
      const api = await provider.connect(deadline); await api.masters(commercial.itemCode!);
      async function ensure(kind: AccurateDocumentKind, number: string, payload: Record<string, any>, validate: (d: any) => boolean) {
        const operationId = hash([TARGET, kind, number]), opRef = db!.collection(OPS).doc(operationId);
        const fingerprint = hash(kind === 'customer' ? { ...payload, name: null, transDate: null } : payload);
        const op = await db!.runTransaction(async t => { await leased(t, a.token); return (await t.get(opRef)).data(); });
        if (op && (op.databaseId !== TARGET || op.kind !== kind || op.number !== number || op.fingerprint !== fingerprint)) throw syncFailure('ACCURATE_DOCUMENT_COLLISION', true);
        let document = await api.lookup(kind, number);
        if (!document) {
          // Once a create may have been sent, absence is NOT permission to retry.
          if (op) throw syncFailure('ACCURATE_DOCUMENT_UNCERTAIN', true);
          if (deadline - clock() < 12000) throw syncFailure('ACCURATE_RETRY');
          await fresh();
          await db!.runTransaction(async t => {
            await leased(t, a.token); const current = await t.get(opRef);
            if (current.exists) throw syncFailure('ACCURATE_DOCUMENT_UNCERTAIN', true);
            t.create(opRef, { schemaVersion: 1, databaseId: TARGET, kind, number, fingerprint, state: 'sending',
              bookingId: kind === 'customer' ? null : a.job.bookingId, createdAt: now(), updatedAt: now() });
          });
          try { await api.save(kind, payload); }
          catch {
            // Any failure after the durable sending record is ambiguous. Raw
            // API messages and response bodies never enter logs or Firestore.
            throw syncFailure('ACCURATE_DOCUMENT_UNCERTAIN', true);
          }
          document = await api.lookup(kind, number);
          if (!document) throw syncFailure('ACCURATE_DOCUMENT_UNCERTAIN', true);
        }
        if (!positiveId(document.id) || !validate(document)) throw syncFailure('ACCURATE_DOCUMENT_MISMATCH', true);
        await db!.runTransaction(async t => {
          await leased(t, a.token); const current = await t.get(opRef);
          if (current.exists && current.data()?.fingerprint !== fingerprint) throw syncFailure('ACCURATE_DOCUMENT_COLLISION', true);
          t.set(opRef, { schemaVersion: 1, databaseId: TARGET, kind, number, fingerprint, state: 'confirmed',
            providerId: document.id, bookingId: kind === 'customer' ? null : a.job.bookingId, createdAt: op?.createdAt || now(), updatedAt: now() });
          if (kind !== 'customer') t.update(a.ref, { [`documents.${kind}`]: { id: document.id, number }, updatedAt: now() });
        });
        return document;
      }
      const customerNo = `SHC-${a.job.ownerHash.slice(0, 24)}`;
      const customerMarker = `SENZU_HOME_CUSTOMER_V1:${a.job.ownerHash}`;
      // Customer number + ownership marker are stable. Later display-name
      // changes never edit an existing customer or change its identity.
      const customerName = String(v.booking.customerName || 'Pelanggan Senzu Home').normalize('NFKC').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) || 'Pelanggan Senzu Home';
      const customerPayload = { name: customerName, customerNo, number: customerNo,
        transDate: wibDate(v.payment.paidAt), currencyCode: 'IDR', notes: customerMarker,
        customerReceivableAccountListNo: ['110301'], customerDownPaymentAccountListNo: ['210102'],
        salesAccountNo: '400005', salesDiscountAccountNo: '400004', itemDiscountAccountNo: '400004' };
      const listNo = (d: any, field: string) => {
        const rows = d[field] || d[`${field}No`];
        return Array.isArray(rows) ? rows.map((r: any) => typeof r === 'string' ? r : r?.no) : [];
      };
      await ensure('customer', customerNo, customerPayload, d => matchesAccurateCustomerNo(customerNo, d.customerNo, d.no) && d.notes === customerMarker &&
        JSON.stringify(listNo(d, 'customerReceivableAccountList')) === '["110301"]' && JSON.stringify(listNo(d, 'customerDownPaymentAccountList')) === '["210102"]');
      const paidDate = wibDate(v.payment.paidAt), description = (stage: string) => `SENZU_HOME_V1:${a.id}:${stage} | ${v.booking.bookingCode} | ${v.intent.paymentId}`;
      const currency = (d: any) => (d.currency?.code || d.currencyCode) === 'IDR';
      const customerMatches = (d: any) =>
        (d.customer === undefined || d.customer === null || typeof d.customer === 'object' && !Array.isArray(d.customer)) &&
        matchesAccurateCustomerNo(customerNo, d.customer?.customerNo, d.customer?.no, d.customerNo);
      await ensure('down_payment', docs.downPaymentNumber, { customerNo, number: docs.downPaymentNumber, dpAmount: a.job.amount,
        transDate: paidDate, currencyCode: 'IDR', isTaxable: false, inclusiveTax: false, description: description('DP') },
      d => d.number === docs.downPaymentNumber && d.invoiceDp === true && d.totalAmount === a.job.amount && currency(d) &&
        customerMatches(d) && d.description === description('DP') && d.taxable === false && providerDate(d.transDate) === paidDate);
      const invoiceNumber = (row: any) => row?.invoice?.number || row?.invoiceNo || row?.invoiceNumber;
      await ensure('receipt', docs.receiptNumber, { customerNo, number: docs.receiptNumber, bankNo: '110103', chequeAmount: a.job.amount,
        transDate: paidDate, currencyCode: 'IDR', paymentMethod: 'PAYMENT_LINK', description: description('RC'),
        detailInvoice: [{ invoiceNo: docs.downPaymentNumber, paymentAmount: a.job.amount }] },
      d => d.number === docs.receiptNumber && (d.bank?.no || d.bankNo) === '110103' && d.chequeAmount === a.job.amount &&
        currency(d) && customerMatches(d) && d.description === description('RC') && providerDate(d.transDate) === paidDate && Array.isArray(d.detailInvoice) &&
        d.detailInvoice.length === 1 && invoiceNumber(d.detailInvoice[0]) === docs.downPaymentNumber && d.detailInvoice[0].paymentAmount === a.job.amount);
      const latest = await fresh();
      if (String(latest.booking.status).toLowerCase() !== 'completed') {
        await finish(a, 'waiting_service', ''); return { processed: 1 };
      }
      const completedAt = latest.booking.completedAt;
      if (!Number.isFinite(stampTime(completedAt)) || stampTime(completedAt) < stampTime(v.payment.paidAt) || stampTime(completedAt) > clock() + 60000) throw syncFailure('SYNC_SOURCE_CHANGED', true);
      const item = { itemNo: commercial.itemCode, quantity: 1, itemUnitName: 'Paket', unitPrice: commercial.servicePrice,
        useTax1: false, useTax2: false, useTax3: false };
      const expenses = commercial.visitFee ? [{ accountNo: '400005', expenseAmount: commercial.visitFee, expenseName: 'Biaya kunjungan Senzu Home' }] : [];
      await ensure('invoice', docs.invoiceNumber, { customerNo, number: docs.invoiceNumber, transDate: wibDate(completedAt),
        currencyCode: 'IDR', invoiceDp: false, taxable: false, inclusiveTax: false, cashDiscount: commercial.discount,
        description: description('IV'), detailItem: [item], detailExpense: expenses,
        detailDownPayment: [{ invoiceNumber: docs.downPaymentNumber, paymentAmount: a.job.amount }] },
      d => d.number === docs.invoiceNumber && d.invoiceDp === false && d.totalAmount === a.job.amount && currency(d) && customerMatches(d) &&
        d.description === description('IV') && providerDate(d.transDate) === wibDate(completedAt) && d.taxable === false && (d.cashDiscount || 0) === commercial.discount &&
        Array.isArray(d.detailItem) && d.detailItem.length === 1 && (d.detailItem[0].item?.no || d.detailItem[0].itemNo) === commercial.itemCode &&
        d.detailItem[0].quantity === 1 && d.detailItem[0].unitPrice === commercial.servicePrice &&
        Array.isArray(d.detailExpense) && d.detailExpense.length === expenses.length && (!expenses.length ||
          (d.detailExpense[0].account?.no || d.detailExpense[0].accountNo) === '400005' && d.detailExpense[0].expenseAmount === commercial.visitFee) &&
        Array.isArray(d.detailDownPayment) && d.detailDownPayment.length === 1 && invoiceNumber(d.detailDownPayment[0]) === docs.downPaymentNumber &&
        d.detailDownPayment[0].paymentAmount === a.job.amount && (d.primeOwing === undefined || d.primeOwing === 0));
      await finish(a, 'complete', ''); return { processed: 1 };
    } catch (e: any) {
      if (!active) throw syncFailure(MESSAGES[e?.code] ? e.code : 'ACCURATE_RETRY', Boolean(e?.review));
      if (active) await finish(active, e?.review ? 'review' : 'retry', MESSAGES[e?.code] ? e.code : 'ACCURATE_RETRY').catch(() => {});
      return { processed: active ? 1 : 0 };
    } finally { localBusy = false; }
  }
  async function finish(a: NonNullable<Awaited<ReturnType<typeof claim>>>, state: AccurateSyncJobState, issue: string) {
    await db!.runTransaction(async t => {
      const c = control((await t.get(ref())).data()), snap = await t.get(a.ref);
      if (!c || c.leaseToken !== a.token || !snap.exists) return;
      const wait = state === 'waiting_service' ? 300000 : Math.min(3600000, 60000 * 2 ** Math.min(a.job.attempts || 0, 5));
      t.update(a.ref, { state, issue, updatedAt: now(), wakeAt: ['review', 'complete'].includes(state) ? PARKED : clock() + wait });
      t.update(ref(), { leaseToken: null, leaseUntil: 0 });
    });
  }
  function wake() {
    if (wakePending || !configured()) return;
    wakePending = true;
    const timer = setTimeout(() => { wakePending = false; runOnce().catch(() => {}); }, 100);
    timer.unref?.();
  }
  async function scheduled(req: Request) {
    const value = req.headers['x-accurate-worker-token'];
    const count = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(v => v.toLowerCase() === 'x-accurate-worker-token').length;
    rate(`worker:${req.ip || 'unknown'}`, 12);
    if (!schedulerConfigured() || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value) || count > 1 || req.headers.authorization ||
        value.length !== env.ACCURATE_SYNC_WORKER_TOKEN!.length || !timingSafeEqual(Buffer.from(value), Buffer.from(env.ACCURATE_SYNC_WORKER_TOKEN!))) throw fail(401, 'AUTH_INVALID');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw fail(400, 'INVALID_SYNC_REQUEST');
    return runOnce();
  }
  return { stagePaid, status, preview, netPreview, activate, pause, retry, run, runOnce, scheduled, wake };
}

export function registerAccurateSync(app: Express, deps: Dependencies) {
  const service = createAccurateSync(deps);
  for (const action of ['status', 'preview', 'netPreview', 'activate', 'pause', 'retry', 'run', 'scheduled'] as const) {
    app.post(`/api/integrations/accurate/sync/${action}`, async (req, res) => {
      res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
      try { res.json({ success: true, ...await service[action](req) }); }
      catch (e: any) {
        const code = MESSAGES[e?.code] ? e.code : e?.status === 403 ? 'MANAGER_ROLE_REQUIRED' : 'ACCURATE_RETRY';
        res.status(e?.status && Number.isInteger(e.status) && e.status >= 400 && e.status < 600 ? e.status : e?.review ? 409 : 503)
          .json({ success: false, code, error: MESSAGES[code] });
      }
    });
  }
  // Durable jobs survive restarts. Live onPaid wakes the worker; Test/manual
  // requests do not trigger this integration. Cloud Run can suspend background
  // CPU, so the scheduler is necessary for unattended retries/completion checks.
  const timer = setInterval(() => service.wake(), 30000); timer.unref?.();
  return { ...service, stop: () => clearInterval(timer) };
}
