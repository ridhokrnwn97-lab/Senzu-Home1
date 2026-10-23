import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { createAccurateSyncProvider, positiveId, syncFailure } from './accurateSyncProvider.ts';
import { matchesFeeJournal } from './accurateFeePosting.ts';
import { isoDay, processingJournal, readProcessingFees, wibDay, type ProcessingCharge } from './xenditProcessingFees.ts';

export const PROCESSING_ACK = 'ACTUAL_XENDIT_PROCESSING_DEBITS_AS_EXPENSE_NO_PRIOR_MANUAL_POSTING';
export const PROCESSING_SYNC_ERRORS: Record<string, string> = {
  PROCESSING_APPROVAL_REQUIRED: 'Konfirmasi Finance, tanggal awal, dan ID potongan contoh diperlukan. Pastikan potongan belum dijurnal manual.',
  PROCESSING_DISABLED: 'Pencatatan processing fee belum aktif atau sedang dijeda.',
  PROCESSING_CONTROL_INVALID: 'Pengaturan processing fee perlu diperiksa.',
  PROCESSING_EVIDENCE_CHANGED: 'Bukti potongan berubah atau nomor jurnal bertabrakan. Perlu pemeriksaan Finance.',
  PROCESSING_DOCUMENT_UNCERTAIN: 'Hasil pengiriman jurnal belum pasti. Hanya pencocokan nomor diizinkan; jurnal tidak dikirim ulang.',
  PROCESSING_DOCUMENT_MISMATCH: 'Isi jurnal processing fee tidak cocok dengan bukti potongan.',
};
const TARGET = 2974047, ROWS = 'accurate_processing_fee_jobs', OPS = 'accurate_sync_operations', PARKED = Number.MAX_SAFE_INTEGER;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Deps = { db: Firestore | null; env: NodeJS.ProcessEnv; fetch?: typeof fetch; clock: () => number;
  provider: ReturnType<typeof createAccurateSyncProvider>; ref: () => DocumentReference; configured: () => boolean;
  authorizeManager: (t: Transaction, uid: string) => Promise<unknown> };
export function createProcessingFeeSync(deps: Deps) {
  const { db, env, clock, ref } = deps, now = () => new Date(clock()).toISOString();
  const business = () => digest(env.XENDIT_LIVE_BUSINESS_ID || '');
  const settings = (c: any) => {
    if (!c || c.processingFromDate === undefined) return null;
    if (c.databaseId !== TARGET || typeof c.processingEnabled !== 'boolean' || !isoDay(c.processingFromDate) ||
        c.processingBusinessHash !== business() || !isoDay(c.processingScanFromDate) ||
        !Number.isFinite(Date.parse(c.processingActivatedAt))) throw syncFailure('PROCESSING_CONTROL_INVALID', true);
    return c;
  };
  async function status() {
    if (!db) return null;
    const c = settings((await ref().get()).data());
    const rows = await db.collection(ROWS).orderBy('createdAt', 'desc').limit(30).get();
    return { enabled: c?.processingEnabled === true, fromDate: c?.processingFromDate || null,
      activatedAt: c?.processingActivatedAt || null, lastScanAt: c?.processingLastScanAt || null,
      lastScanFromDate: c?.processingLastScanFromDate || null, lastScanToDate: c?.processingLastScanToDate || null,
      issue: c?.processingIssue || '', jobs: rows.docs.map(s => { const r = s.data(); return {
        id: s.id, transactionId: r.charge?.transactionId, type: r.charge?.type, date: r.charge?.date,
        amount: r.charge?.amount, number: r.number, state: r.state, issue: r.issue || '' } }) };
  }
  async function preview(fromDate: string, toDate: string) { return readProcessingFees(fromDate, toDate, deps); }
  async function activate(uid: string, body: any) {
    if (!deps.configured()) throw syncFailure('SYNC_NOT_CONFIGURED');
    if (body.acknowledgement !== PROCESSING_ACK || !isoDay(body.fromDate) || !Array.isArray(body.expectedTransactionIds) ||
        body.expectedTransactionIds.length < 1 || body.expectedTransactionIds.length > 10 ||
        body.expectedTransactionIds.some((v: unknown) => typeof v !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(v)) ||
        new Set(body.expectedTransactionIds).size !== body.expectedTransactionIds.length) throw syncFailure('PROCESSING_APPROVAL_REQUIRED', true);
    // Activation proves the unfiltered API actually exposes known dashboard
    // deduction IDs. An empty/missing feed can never silently enable posting.
    const sampleTo = wibDay(Math.min(clock(), Date.parse(`${body.fromDate}T00:00:00+07:00`) + 30 * 86400000));
    const sample = await preview(body.fromDate, sampleTo);
    if (!body.expectedTransactionIds.every((id: string) => sample.charges.some(c => c.transactionId === id))) throw syncFailure('PROCESSING_APPROVAL_REQUIRED', true);
    const api = await deps.provider.connect(clock() + 45000); await api.feeMasters();
    await api.lookup('processing_fee', 'SHPF-PERMISSION-CHECK');
    await db!.runTransaction(async t => {
      await deps.authorizeManager(t, uid); const c = (await t.get(ref())).data(), prior = settings(c);
      if (!c?.enabled || c.databaseId !== TARGET) throw syncFailure('SYNC_PAUSED');
      if (prior && prior.processingFromDate !== body.fromDate) throw syncFailure('PROCESSING_CONTROL_INVALID', true);
      t.update(ref(), { processingEnabled: true, processingFromDate: body.fromDate,
        processingBusinessHash: business(), processingActivatedAt: prior?.processingActivatedAt || now(),
        processingScanFromDate: prior?.processingScanFromDate || body.fromDate, processingNextScanAt: 0,
        processingIssue: '', updatedAt: now(), updatedBy: uid });
    });
    return status();
  }
  async function pause(uid: string) {
    await db!.runTransaction(async t => { await deps.authorizeManager(t, uid); const c = settings((await t.get(ref())).data());
      if (c) t.update(ref(), { processingEnabled: false, updatedBy: uid, updatedAt: now() }); });
    return status();
  }
  async function runOnce() {
    if (!db || !deps.configured()) return { processingProcessed: 0 };
    const token = randomUUID();
    const claimed = await db.runTransaction(async t => {
      const c = settings((await t.get(ref())).data());
      if (!c?.enabled || !c.processingEnabled || c.leaseUntil > clock()) return null;
      t.update(ref(), { leaseToken: token, leaseUntil: clock() + 90000 }); return c;
    });
    if (!claimed) return { processingProcessed: 0 };
    let rowRef: any = null;
    async function guard(t: Transaction) {
      const c = settings((await t.get(ref())).data());
      if (!deps.configured() || !c?.enabled || !c.processingEnabled) throw syncFailure('PROCESSING_DISABLED');
      if (c.leaseToken !== token || c.leaseUntil <= clock()) throw syncFailure('SYNC_BUSY');
      return c;
    }
    try {
      const pending = await db.collection(ROWS).where('wakeAt', '<=', clock()).orderBy('wakeAt', 'asc').limit(1).get();
      // Scan and posting use separate runs to keep request deadlines bounded.
      if (pending.empty && (claimed.processingNextScanAt || 0) <= clock()) {
        const start = claimed.processingScanFromDate, today = wibDay(clock());
        const last = wibDay(Date.parse(`${start}T00:00:00+07:00`) + 6 * 86400000), to = last < today ? last : today;
        const result = await preview(start, to);
        for (const charge of result.charges) {
          const plan = processingJournal(charge), rr = db.collection(ROWS).doc(plan.key), fingerprint = digest(plan.payload);
          await db.runTransaction(async t => {
            await guard(t); const prior = (await t.get(rr)).data();
            if (prior && prior.fingerprint !== fingerprint) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
            if (!prior) t.create(rr, { schemaVersion: 1, databaseId: TARGET, charge, fingerprint,
              number: plan.payload.number, state: 'pending', wakeAt: clock(), createdAt: now(), updatedAt: now() });
          });
        }
        const rolling = wibDay(clock() - 30 * 86400000), reset = rolling > claimed.processingFromDate ? rolling : claimed.processingFromDate;
        const next = to < today ? wibDay(Date.parse(`${to}T00:00:00+07:00`) + 86400000) : reset;
        await db.runTransaction(async t => { await guard(t); t.update(ref(), { processingLastScanAt: now(),
          processingLastScanFromDate: start, processingLastScanToDate: to, processingScanFromDate: next,
          processingNextScanAt: to < today ? clock() : clock() + 600000, processingIssue: '' }); });
        return { processingProcessed: 0, processingScanned: result.charges.length };
      }
      if (pending.empty) return { processingProcessed: 0 };
      const snap = pending.docs[0], row = snap.data(); rowRef = snap.ref;
      const plan = processingJournal(row.charge as ProcessingCharge), payload = plan.payload;
      if (row.schemaVersion !== 1 || row.databaseId !== TARGET || snap.id !== plan.key || row.number !== payload.number || row.fingerprint !== digest(payload)) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
      // Re-read this day in full before posting. Do not trust a stale cache.
      const evidence = await preview(row.charge.date, row.charge.date);
      const current = evidence.charges.find(c => c.transactionId === row.charge.transactionId);
      if (!current || digest(processingJournal(current).payload) !== row.fingerprint) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
      const api = await deps.provider.connect(clock() + 45000); await api.feeMasters();
      const opRef = db.collection(OPS).doc(digest([TARGET, 'processing_fee', payload.number]));
      const op = await db.runTransaction(async t => { await guard(t); return (await t.get(opRef)).data(); });
      if (op && (op.fingerprint !== row.fingerprint || op.number !== payload.number || op.kind !== 'processing_fee' || op.databaseId !== TARGET)) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
      let document = await api.lookup('processing_fee', payload.number);
      if (!document) {
        if (op) throw syncFailure('PROCESSING_DOCUMENT_UNCERTAIN', true);
        await db.runTransaction(async t => {
          await guard(t); if ((await t.get(opRef)).exists) throw syncFailure('PROCESSING_DOCUMENT_UNCERTAIN', true);
          t.create(opRef, { schemaVersion: 1, databaseId: TARGET, kind: 'processing_fee', number: payload.number,
            fingerprint: row.fingerprint, state: 'sending', createdAt: now(), updatedAt: now() });
          t.update(rowRef, { state: 'sending', updatedAt: now() });
        });
        try { await api.save('processing_fee', payload); }
        catch { throw syncFailure('PROCESSING_DOCUMENT_UNCERTAIN', true); }
        document = await api.lookup('processing_fee', payload.number);
      }
      if (!document) throw syncFailure('PROCESSING_DOCUMENT_UNCERTAIN', true);
      if (!positiveId(document.id) || !matchesFeeJournal(document, payload)) throw syncFailure('PROCESSING_DOCUMENT_MISMATCH', true);
      await db.runTransaction(async t => { await guard(t);
        t.set(opRef, { schemaVersion: 1, databaseId: TARGET, kind: 'processing_fee', number: payload.number,
          fingerprint: row.fingerprint, state: 'confirmed', providerId: document.id, createdAt: op?.createdAt || now(), updatedAt: now() });
        t.update(rowRef, { state: 'confirmed', providerId: document.id, wakeAt: PARKED, issue: '', updatedAt: now() }); });
      return { processingProcessed: 1 };
    } catch (e: any) {
      const issue = [...Object.keys(PROCESSING_SYNC_ERRORS), 'PROCESSING_SCAN_INCOMPLETE', 'PROCESSING_PENDING', 'PROCESSING_READ_REJECTED',
        'PROCESSING_SOURCE_INVALID', 'PROCESSING_FORMAT_INVALID', 'PROCESSING_READ_UNAVAILABLE', 'SYNC_BUSY', 'SYNC_PAUSED', 'PROCESSING_DISABLED'].includes(e?.code) ? e.code : 'PROCESSING_READ_UNAVAILABLE';
      await db.runTransaction(async t => {
        const c = (await t.get(ref())).data(); if (c?.leaseToken !== token) return;
        t.update(ref(), { processingIssue: issue, processingNextScanAt: clock() + 60000 });
        if (rowRef) t.update(rowRef, { state: e?.review ? 'review' : 'retry', issue,
          wakeAt: e?.review ? PARKED : clock() + 60000, updatedAt: now() });
      }).catch(() => {});
      return { processingProcessed: 0 };
    } finally {
      await db.runTransaction(async t => { const c = (await t.get(ref())).data();
        if (c?.leaseToken === token) t.update(ref(), { leaseToken: null, leaseUntil: 0 }); }).catch(() => {});
    }
  }
  // Explicit reconciliation performs lookup only. It never resets sending or
  // sends a second POST after an uncertain result, even when lookup is empty.
  async function reconcile(uid: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw syncFailure('PROCESSING_CONTROL_INVALID', true);
    const rr = db!.collection(ROWS).doc(id), row = (await rr.get()).data();
    if (!row || row.databaseId !== TARGET || !['review', 'sending', 'retry'].includes(row.state)) throw syncFailure('PROCESSING_CONTROL_INVALID', true);
    const plan = processingJournal(row.charge), opRef = db!.collection(OPS).doc(digest([TARGET, 'processing_fee', plan.payload.number]));
    const op = (await opRef.get()).data();
    if (!op || op.fingerprint !== row.fingerprint || digest(plan.payload) !== row.fingerprint) throw syncFailure('PROCESSING_DOCUMENT_UNCERTAIN', true);
    const evidence = await preview(row.charge.date, row.charge.date);
    const current = evidence.charges.find(c => c.transactionId === row.charge.transactionId);
    if (!current || digest(processingJournal(current).payload) !== row.fingerprint) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
    const api = await deps.provider.connect(clock() + 45000); await api.feeMasters();
    const doc = await api.lookup('processing_fee', plan.payload.number);
    if (!doc || !positiveId(doc.id) || !matchesFeeJournal(doc, plan.payload)) throw syncFailure('PROCESSING_DOCUMENT_MISMATCH', true);
    await db!.runTransaction(async t => {
      await deps.authorizeManager(t, uid); const prior = (await t.get(rr)).data(), operation = (await t.get(opRef)).data();
      if (prior?.fingerprint !== row.fingerprint || operation?.fingerprint !== row.fingerprint) throw syncFailure('PROCESSING_EVIDENCE_CHANGED', true);
      t.update(rr, { state: 'confirmed', providerId: doc.id, issue: '', wakeAt: PARKED, updatedAt: now() });
      t.update(opRef, { state: 'confirmed', providerId: doc.id, updatedAt: now() });
    }); return status();
  }
  return { status, preview, activate, pause, runOnce, reconcile };
}
