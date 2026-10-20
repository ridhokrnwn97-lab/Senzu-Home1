import type { Express, Request } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, timingSafeEqual } from 'node:crypto';

// This module deliberately has no access path to bookings, payments, dispatch,
// notifications or accounting. A Test session can never authorize real service.
const SESSIONS = 'xendit_test_sessions';
const EVENTS = 'xendit_test_webhook_events';
const AMOUNT = 10000;
const HASH = (value: string) => createHash('sha256').update(value).digest('hex');
const SESSION_ID = /^ps-[a-zA-Z0-9-]{16,80}$/;
const ATTEMPT_ID = /^[a-zA-Z0-9_-]{16,100}$/;
const REFERENCE = /^szt_[a-f0-9]{48}$/;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const STATUSES = ['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELED'];
const WEBHOOK_PATH = '/api/integrations/xendit/test/webhook';
const fail = (status: number, code: string, message = 'Layanan uji Xendit belum dapat memproses permintaan.') =>
  Object.assign(new Error(message), { status, code });
type Actor = { uid: string };
type Dependencies = {
  db: Firestore | null;
  verify: (token: string) => Promise<{ uid: string }>;
  authorizeManager: (transaction: Transaction, uid: string) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
};

export function safeTestCheckoutUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw fail(502, 'XENDIT_INVALID_CHECKOUT');
  let url: URL;
  try { url = new URL(raw); } catch { throw fail(502, 'XENDIT_INVALID_CHECKOUT'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['dev.xen.to', 'checkout-staging.xendit.co'].includes(url.hostname)) {
    throw fail(502, 'XENDIT_INVALID_CHECKOUT', 'Tautan checkout bukan endpoint Test Xendit yang diizinkan.');
  }
  return url.href;
}

function oneHeader(req: Request, name: string): string {
  const count = (req.rawHeaders || []).filter((_, index) => index % 2 === 0)
    .filter(key => key.toLowerCase() === name).length;
  const value = req.headers[name];
  if (count > 1 || typeof value !== 'string') throw fail(401, 'INVALID_AUTH_HEADER');
  return value;
}

function bodyOnly(body: any, keys: string[]): void {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !keys.includes(key))) throw fail(400, 'INVALID_TEST_PAYLOAD');
}

export function createXenditSandbox(deps: Dependencies) {
  const env = deps.env || process.env;
  const fetcher = deps.fetch || globalThis.fetch;
  const clock = deps.clock || Date.now;
  const rates = new Map<string, { count: number; until: number }>();
  const now = () => new Date(clock()).toISOString();
  function rate(key: string, max: number): void {
    const ms = clock();
    for (const [id, item] of rates) if (item.until <= ms) rates.delete(id);
    const item = rates.get(key);
    if ((item && item.count >= max) || (!item && rates.size >= 5000)) throw fail(429, 'RATE_LIMITED');
    rates.set(key, { count: (item?.count || 0) + 1, until: item?.until || ms + 60000 });
  }
  function config() {
    if ((env.XENDIT_ENVIRONMENT || 'test') !== 'test' ||
        !/^xnd_development_[A-Za-z0-9_-]+$/.test(env.XENDIT_SECRET_KEY || '') ||
        !env.XENDIT_WEBHOOK_TOKEN || env.XENDIT_WEBHOOK_TOKEN.trim() !== env.XENDIT_WEBHOOK_TOKEN) {
      throw fail(503, 'XENDIT_TEST_NOT_CONFIGURED', 'Pasang Secret Key Mode Tes dan token webhook pada Secrets server. Key Live tidak diterima.');
    }
    let returnUrl: URL;
    try { returnUrl = new URL(env.XENDIT_TEST_RETURN_URL || 'https://senzuhome.com/?xendit_test=returned'); }
    catch { throw fail(503, 'XENDIT_RETURN_URL_INVALID'); }
    if (returnUrl.protocol !== 'https:' || returnUrl.username || returnUrl.password) throw fail(503, 'XENDIT_RETURN_URL_INVALID');
    if (!deps.db) throw fail(503, 'DATABASE_UNAVAILABLE');
    return { key: env.XENDIT_SECRET_KEY!, token: env.XENDIT_WEBHOOK_TOKEN!, returnUrl: returnUrl.href };
  }
  async function actor(req: Request): Promise<Actor> {
    rate(`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`, 100);
    if (Object.keys(req.headers).some(key => key.toLowerCase() === 'x-firebase-auth')) throw fail(401, 'INVALID_AUTH_HEADER');
    const match = /^Bearer (\S+)$/.exec(oneHeader(req, 'authorization'));
    if (!match) throw fail(401, 'AUTH_REQUIRED');
    let identity: { uid: string };
    try { identity = await deps.verify(match[1]); }
    catch (error: any) {
      const invalid = /^auth\/(id-token-expired|id-token-revoked|invalid-id-token|argument-error|user-disabled|user-not-found)$/.test(error?.code || '');
      throw fail(invalid ? 401 : 503, invalid ? 'AUTH_INVALID' : 'AUTH_UNAVAILABLE');
    }
    if (!identity?.uid || typeof identity.uid !== 'string' || identity.uid.includes('/')) throw fail(401, 'AUTH_INVALID');
    rate(`uid:${identity.uid}`, 30);
    if (!deps.db) throw fail(503, 'DATABASE_UNAVAILABLE');
    await deps.db.runTransaction(t => deps.authorizeManager(t, identity.uid));
    return { uid: identity.uid };
  }
  async function api(path: string, payload?: any): Promise<any> {
    const cfg = config();
    let response: Response;
    try {
      response = await fetcher(`https://api.xendit.co${path}`, {
        method: payload ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw fail(503, 'XENDIT_REQUEST_UNCERTAIN', 'Respons Xendit belum pasti. Gunakan percobaan yang sama; jangan membuat transaksi baru.'); }
    if (!response.ok) {
      const definite = [400, 401, 403, 404, 422].includes(response.status);
      throw Object.assign(fail(502, definite ? 'XENDIT_REQUEST_REJECTED' : 'XENDIT_REQUEST_UNCERTAIN',
        definite ? 'Xendit menolak permintaan. Periksa izin API key dan akses Payment Sessions Mode Tes.' : 'Hasil permintaan Xendit belum pasti. Periksa kembali percobaan yang sama.'), { definite });
    }
    try { return await response.json(); }
    catch { throw fail(503, 'XENDIT_REQUEST_UNCERTAIN'); }
  }
  function validateSession(session: any, intent: any): any {
    if (!session || !matches(session.payment_session_id, SESSION_ID) || session.reference_id !== intent.referenceId ||
        session.amount !== AMOUNT || session.currency !== 'IDR' || session.country !== 'ID' ||
        session.session_type !== 'PAY' || session.mode !== 'PAYMENT_LINK' ||
        (session.capture_method !== undefined && session.capture_method !== 'AUTOMATIC') ||
        !STATUSES.includes(session.status) || typeof session.business_id !== 'string' || !session.business_id ||
        (env.XENDIT_BUSINESS_ID && session.business_id !== env.XENDIT_BUSINESS_ID) ||
        (intent.businessId && intent.businessId !== session.business_id) ||
        (intent.sessionId && intent.sessionId !== session.payment_session_id) ||
        !Number.isFinite(Date.parse(session.expires_at))) throw fail(409, 'XENDIT_SESSION_CONFLICT');
    return { sessionId: session.payment_session_id, businessId: session.business_id,
      checkoutUrl: safeTestCheckoutUrl(session.payment_link_url), sessionStatus: session.status,
      expiresAt: session.expires_at, paymentId: typeof session.payment_id === 'string' ? session.payment_id : null };
  }
  function assertIntent(intent: any, uid?: string): void {
    if (!intent || intent.environment !== 'test' || intent.amount !== AMOUNT || intent.currency !== 'IDR' ||
        !matches(intent.referenceId, REFERENCE) || typeof intent.ownerUid !== 'string' ||
        !intent.ownerUid || (uid && intent.ownerUid !== uid)) throw fail(403, 'TEST_SESSION_FORBIDDEN');
  }
  function publicSession(intent: any) {
    return { referenceId: intent.referenceId, sessionId: intent.sessionId || null,
      checkoutUrl: intent.checkoutUrl ? safeTestCheckoutUrl(intent.checkoutUrl) : null,
      sessionStatus: intent.sessionStatus || null, creationState: intent.creationState,
      amount: AMOUNT, currency: 'IDR', environment: 'test', expiresAt: intent.expiresAt || null,
      lastWebhookAt: intent.lastWebhookAt || null, lastCheckedAt: intent.lastCheckedAt || null,
      realBookingAffected: false };
  }
  async function persistSession(referenceId: string, session: any, webhook?: { event: string; businessId: string }) {
    const ref = deps.db!.collection(SESSIONS).doc(referenceId);
    return deps.db!.runTransaction(async t => {
      const snap = await t.get(ref);
      if (!snap.exists) throw fail(503, 'TEST_SESSION_PENDING');
      const intent = snap.data()!; assertIntent(intent);
      if (intent.referenceId !== referenceId) throw fail(409, 'TEST_REFERENCE_CONFLICT');
      const verified = validateSession(session, intent);
      if (webhook && webhook.businessId !== verified.businessId) throw fail(409, 'XENDIT_MERCHANT_CONFLICT');
      if (webhook && ((webhook.event === 'payment_session.completed' && verified.sessionStatus !== 'COMPLETED') ||
          (webhook.event === 'payment_session.expired' && verified.sessionStatus === 'ACTIVE'))) {
        throw fail(503, 'WEBHOOK_AWAITING_CANONICAL_STATE');
      }
      const eventRef = webhook ? deps.db!.collection(EVENTS).doc(HASH(`${verified.sessionId}:${webhook.event}`)) : null;
      const prior = eventRef ? await t.get(eventRef) : null;
      // COMPLETED wins over delayed ACTIVE/EXPIRED observations. Terminal sessions
      // cannot regress to ACTIVE when parallel API reads return out of order.
      const status = intent.sessionStatus === 'COMPLETED' ? 'COMPLETED'
        : ['EXPIRED', 'CANCELED'].includes(intent.sessionStatus) && verified.sessionStatus === 'ACTIVE'
          ? intent.sessionStatus : verified.sessionStatus;
      const update = { ...verified, sessionStatus: status, creationState: 'created', lastCheckedAt: now(),
        ...(webhook ? { lastWebhookAt: now() } : {}) };
      if (eventRef && !prior?.exists) t.create(eventRef, { environment: 'test', referenceId,
        sessionId: verified.sessionId, businessId: verified.businessId, event: webhook!.event,
        observedSessionStatus: verified.sessionStatus, receivedAt: now(), realBookingAffected: false });
      t.update(ref, update);
      return publicSession({ ...intent, ...update });
    });
  }
  return {
    async status(req: Request) {
      await actor(req);
      let configured = true, message = '';
      try { config(); } catch (error: any) { configured = false; message = error.message; }
      return { configured, environment: 'test', amount: AMOUNT, currency: 'IDR', webhookPath: WEBHOOK_PATH,
        realBookingAffected: false, message };
    },
    async checkout(req: Request) {
      const caller = await actor(req); config();
      bodyOnly(req.body, ['attemptId']);
      if (!matches(req.body.attemptId, ATTEMPT_ID)) throw fail(400, 'INVALID_ATTEMPT_ID');
      rate(`create:${caller.uid}`, 5);
      const referenceId = `szt_${HASH(`${caller.uid}:${req.body.attemptId}`).slice(0, 48)}`;
      const ref = deps.db!.collection(SESSIONS).doc(referenceId);
      const ownerRef = deps.db!.collection(SESSIONS).doc(`owner_${HASH(caller.uid)}`);
      const claim = await deps.db!.runTransaction(async t => {
        await deps.authorizeManager(t, caller.uid);
        const [snap, owner] = await Promise.all([t.get(ref), t.get(ownerRef)]);
        if (snap.exists) {
          const value = snap.data()!; assertIntent(value, caller.uid);
          if (value.referenceId !== referenceId) throw fail(409, 'TEST_REFERENCE_CONFLICT');
          return { send: false, intent: value };
        }
        if (owner.exists) {
          const previousId = owner.data()!.referenceId;
          if (!matches(previousId, REFERENCE)) throw fail(409, 'TEST_LOCK_CONFLICT');
          const previous = await t.get(deps.db!.collection(SESSIONS).doc(previousId));
          if (!previous.exists) throw fail(409, 'TEST_LOCK_CONFLICT');
          const prior = previous.data()!; assertIntent(prior, caller.uid);
          if (prior.referenceId !== previousId) throw fail(409, 'TEST_REFERENCE_CONFLICT');
          if (prior.creationState !== 'rejected' && !['COMPLETED', 'EXPIRED', 'CANCELED'].includes(prior.sessionStatus)) {
            throw fail(409, 'TEST_ATTEMPT_PENDING', 'Masih ada percobaan aktif atau belum pasti. Periksa percobaan sebelumnya dahulu.');
          }
        }
        const intent = { referenceId, ownerUid: caller.uid, environment: 'test', amount: AMOUNT,
          currency: 'IDR', creationState: 'creating', createdAt: now(), realBookingAffected: false };
        t.create(ref, intent); t.set(ownerRef, { ownerUid: caller.uid, referenceId, environment: 'test' });
        return { send: true, intent };
      });
      if (!claim.send) return { session: publicSession(claim.intent), isIdempotent: true };
      try {
        const cfg = config();
        const session = await api('/sessions', {
          reference_id: referenceId, session_type: 'PAY', mode: 'PAYMENT_LINK', capture_method: 'AUTOMATIC',
          allow_save_payment_method: 'DISABLED', amount: AMOUNT, currency: 'IDR', country: 'ID', locale: 'id',
          customer: { reference_id: `senzutest${HASH(caller.uid).slice(0, 32)}`, type: 'INDIVIDUAL', individual_detail: { given_names: 'Senzu Test' } },
          description: 'SIMULASI SENZU HOME - BUKAN PEMBAYARAN BOOKING',
          allowed_payment_channels: ['BNI_VIRTUAL_ACCOUNT', 'BRI_VIRTUAL_ACCOUNT', 'MANDIRI_VIRTUAL_ACCOUNT', 'PERMATA_VIRTUAL_ACCOUNT'],
          expires_at: new Date(clock() + 30 * 60 * 1000).toISOString(),
          success_return_url: cfg.returnUrl, cancel_return_url: cfg.returnUrl,
          metadata: { environment: 'test', purpose: 'isolated_senzu_integration_test' },
        });
        return { session: await persistSession(referenceId, session), isIdempotent: false };
      } catch (error: any) {
        // No automatic POST retry: Payment Sessions documentation does not promise
        // an idempotency header. An ambiguous create must be reconciled, not repeated.
        await deps.db!.runTransaction(async t => {
          const snap = await t.get(ref);
          if (snap.exists && snap.data()!.creationState === 'creating') t.update(ref, {
            creationState: error.definite ? 'rejected' : 'uncertain', lastCheckedAt: now(),
          });
        }).catch(() => {});
        throw error;
      }
    },
    async read(req: Request) {
      const caller = await actor(req); config();
      bodyOnly(req.body, ['referenceId']);
      if (!matches(req.body.referenceId, REFERENCE)) throw fail(400, 'INVALID_REFERENCE');
      const snap = await deps.db!.collection(SESSIONS).doc(req.body.referenceId).get();
      if (!snap.exists) throw fail(404, 'TEST_SESSION_NOT_FOUND');
      const intent = snap.data()!; assertIntent(intent, caller.uid);
      if (intent.referenceId !== req.body.referenceId) throw fail(409, 'TEST_REFERENCE_CONFLICT');
      if (!intent.sessionId) return { session: publicSession(intent) };
      if (!matches(intent.sessionId, SESSION_ID)) throw fail(409, 'XENDIT_SESSION_CONFLICT');
      const session = await api(`/sessions/${encodeURIComponent(intent.sessionId)}`);
      // Re-check live role and ownership after the external request, before returning.
      await deps.db!.runTransaction(t => deps.authorizeManager(t, caller.uid));
      return { session: await persistSession(intent.referenceId, session) };
    },
    async latest(req: Request) {
      const caller = await actor(req);
      const lock = await deps.db!.collection(SESSIONS).doc(`owner_${HASH(caller.uid)}`).get();
      if (!lock.exists) return { session: null };
      const referenceId = lock.data()!.referenceId;
      if (!matches(referenceId, REFERENCE)) throw fail(409, 'TEST_LOCK_CONFLICT');
      const snap = await deps.db!.collection(SESSIONS).doc(referenceId).get();
      if (!snap.exists) throw fail(409, 'TEST_LOCK_CONFLICT');
      const intent = snap.data()!; assertIntent(intent, caller.uid);
      if (intent.referenceId !== referenceId) throw fail(409, 'TEST_REFERENCE_CONFLICT');
      return { session: publicSession(intent) };
    },
    async webhook(req: Request) {
      const cfg = config();
      const received = oneHeader(req, 'x-callback-token');
      if (!timingSafeEqual(Buffer.from(HASH(received), 'hex'), Buffer.from(HASH(cfg.token), 'hex'))) throw fail(401, 'WEBHOOK_TOKEN_INVALID');
      rate('trusted-webhook', 300);
      const body = req.body;
      if (!body || !['payment_session.completed', 'payment_session.expired'].includes(body.event)) throw fail(400, 'WEBHOOK_EVENT_UNSUPPORTED');
      const data = body.data;
      if (!data || !matches(data.payment_session_id, SESSION_ID) || !matches(data.reference_id, REFERENCE) ||
          typeof body.business_id !== 'string' || !body.business_id) throw fail(400, 'WEBHOOK_INVALID_PAYLOAD');
      const snap = await deps.db!.collection(SESSIONS).doc(data.reference_id).get();
      // Never import unrelated sessions, including events from a Live integration.
      if (!snap.exists) return { ignored: true };
      const intent = snap.data()!; assertIntent(intent);
      if (intent.referenceId !== data.reference_id) throw fail(409, 'TEST_REFERENCE_CONFLICT');
      if (data.amount !== AMOUNT || data.currency !== 'IDR' || data.country !== 'ID' || data.session_type !== 'PAY' ||
          data.mode !== 'PAYMENT_LINK' || (data.business_id && data.business_id !== body.business_id) ||
          data.status !== (body.event === 'payment_session.completed' ? 'COMPLETED' : 'EXPIRED')) throw fail(409, 'WEBHOOK_LINKAGE_CONFLICT');
      // Authenticated callback is a wake-up signal, not financial truth. Re-fetch
      // using our Test credential and compare merchant, amount and session linkage.
      const session = await api(`/sessions/${encodeURIComponent(data.payment_session_id)}`);
      if (session?.payment_session_id !== data.payment_session_id) throw fail(409, 'WEBHOOK_LINKAGE_CONFLICT');
      await persistSession(intent.referenceId, session, { event: body.event, businessId: body.business_id });
      return { received: true, environment: 'test', realBookingAffected: false };
    },
  };
}

export function registerXenditSandbox(app: Express, deps: Dependencies) {
  const service = createXenditSandbox(deps);
  const route = (action: keyof typeof service) => async (req: Request, res: any) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ success: true, ...await service[action](req) }); }
    catch (error: any) {
      // Never log SDK responses, headers, secrets, customer profiles or tokens.
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      res.status(status).json({ success: false, code: error.code && error.status ? error.code : 'XENDIT_TEST_UNAVAILABLE',
        message: error.status ? error.message : 'Layanan uji Xendit sedang tidak tersedia. Silakan periksa kembali.' });
    }
  };
  app.post('/api/integrations/xendit/test/status', route('status'));
  app.post('/api/integrations/xendit/test/checkout', route('checkout'));
  app.post('/api/integrations/xendit/test/read', route('read'));
  app.post('/api/integrations/xendit/test/latest', route('latest'));
  app.post(WEBHOOK_PATH, route('webhook'));
}
