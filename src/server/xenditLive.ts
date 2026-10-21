import type { Express, Request } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, timingSafeEqual } from 'node:crypto';
import { safeLiveCheckoutUrl } from '../lib/xenditLiveContracts.ts';
import { assertPaymentLink, bookingDeadline } from './paymentAcceptance.ts';
import { liveError as fail, liveQuoteSeal, quoteLiveDrivingDistance } from './xenditLiveQuote.ts';

const SESSIONS = 'xendit_live_sessions', EVENTS = 'xendit_live_webhook_events';
const WEBHOOK = '/api/integrations/xendit/live/webhook';
const SESSION_ID = /^ps-[a-zA-Z0-9-]{16,80}$/, REFERENCE = /^shl_[a-f0-9]{48}$/;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const reference = (uid: string, id: string) => `shl_${hash(JSON.stringify([uid, id])).slice(0, 48)}`;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const closed = (s: string) => ['cancelled', 'canceled', 'completed', 'expired', 'refunded', 'rescheduled', 'rejected'].includes(String(s).toLowerCase());
type Dependencies = {
  db: Firestore | null;
  verify: (token: string) => Promise<{ uid: string }>;
  authorizeManager: (t: Transaction, uid: string) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  clock?: () => number;
  onPaid?: (bookingId: string) => Promise<unknown>;
};

export function createXenditLive(deps: Dependencies) {
  const env = deps.env || process.env, fetcher = deps.fetch || fetch, clock = deps.clock || Date.now;
  const db = deps.db;
  const now = () => new Date(clock()).toISOString();
  const rates = new Map<string, { count: number; until: number }>();
  function rate(key: string, max = 60) {
    const time = clock();
    for (const [k, v] of rates) if (v.until <= time) rates.delete(k);
    const v = rates.get(key);
    if ((v && v.count >= max) || (!v && rates.size >= 5000)) throw fail(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba sebentar lagi.');
    rates.set(key, { count: (v?.count || 0) + 1, until: v?.until || time + 60000 });
  }
  function config(newCheckout = false) {
    // Independent credentials and switch: the isolated Test integration remains unchanged.
    if (!/^xnd_production_[A-Za-z0-9_-]+$/.test(env.XENDIT_LIVE_SECRET_KEY || '') ||
        !env.XENDIT_LIVE_WEBHOOK_TOKEN || env.XENDIT_LIVE_WEBHOOK_TOKEN.trim() !== env.XENDIT_LIVE_WEBHOOK_TOKEN ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(env.XENDIT_LIVE_BUSINESS_ID || '') || !db) {
      throw fail(503, 'XENDIT_LIVE_NOT_CONFIGURED', 'Pembayaran online belum tersedia. Silakan gunakan pembayaran manual.');
    }
    let returnUrl: URL;
    try { returnUrl = new URL(env.XENDIT_LIVE_RETURN_URL || 'https://senzu-home.ai.studio/?xendit=returned'); }
    catch { throw fail(503, 'XENDIT_LIVE_RETURN_INVALID'); }
    if (returnUrl.protocol !== 'https:' || returnUrl.username || returnUrl.password || returnUrl.port ||
        !['senzu-home.ai.studio', 'senzuhome.com', 'www.senzuhome.com'].includes(returnUrl.hostname)) throw fail(503, 'XENDIT_LIVE_RETURN_INVALID');
    if (newCheckout && env.XENDIT_LIVE_ENABLED !== 'true') throw fail(503, 'XENDIT_LIVE_DISABLED', 'Pembayaran online sedang tidak tersedia.');
    return { key: env.XENDIT_LIVE_SECRET_KEY!, token: env.XENDIT_LIVE_WEBHOOK_TOKEN!, businessId: env.XENDIT_LIVE_BUSINESS_ID!, returnUrl: returnUrl.href };
  }
  function header(req: Request, name: string) {
    const count = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(k => k.toLowerCase() === name).length;
    const value = req.headers[name];
    if (count > 1 || typeof value !== 'string') throw fail(401, 'INVALID_AUTH_HEADER');
    return value;
  }
  async function actor(req: Request, manager = false) {
    rate(`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`, 150);
    const match = /^Bearer (\S+)$/.exec(header(req, 'authorization'));
    if (!match) throw fail(401, 'AUTH_REQUIRED', 'Silakan masuk untuk mengakses pembayaran.');
    let identity;
    try { identity = await deps.verify(match[1]); } catch { throw fail(401, 'AUTH_INVALID', 'Sesi login sudah tidak valid.'); }
    if (!id(identity?.uid)) throw fail(401, 'AUTH_INVALID');
    if (!db) throw fail(503, 'DATABASE_UNAVAILABLE');
    rate(`uid:${identity.uid}`, 60);
    if (manager) await db.runTransaction(t => deps.authorizeManager(t, identity.uid));
    return identity.uid;
  }
  function body(req: Request, keys: string[]) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(k => !keys.includes(k)) || !id(req.body.bookingId)) {
      throw fail(400, 'INVALID_LIVE_REQUEST');
    }
    return req.body;
  }
  function availability() {
    let configured = false;
    try { config(); configured = true; } catch {}
    return { configured, available: configured && Boolean(env.GOOGLE_MAPS_SERVER_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY)
      && env.XENDIT_LIVE_ENABLED === 'true', environment: 'live' as const };
  }
  async function api(path: string, payload?: any) {
    const cfg = config();
    let r: Response;
    try {
      r = await fetcher(`https://api.xendit.co${path}`, {
        method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch { throw fail(503, 'XENDIT_LIVE_UNCERTAIN', 'Hasil pembuatan pembayaran belum pasti. Periksa pesanan ini; jangan mengajukan pesanan ulang.'); }
    if (!r.ok) {
      const definite = [400, 401, 403, 404, 422].includes(r.status);
      // Raw API messages can contain secrets or personal data; never persist or return them.
      throw Object.assign(fail(502, definite ? 'XENDIT_LIVE_REJECTED' : 'XENDIT_LIVE_UNCERTAIN',
        definite ? 'Xendit belum dapat menerima permintaan pembayaran ini. Hubungi Customer Service.' : 'Hasil permintaan belum pasti. Periksa pembayaran pesanan yang sama.'), { definite });
    }
    try { return await r.json(); } catch { throw fail(503, 'XENDIT_LIVE_UNCERTAIN'); }
  }
  async function load(t: Transaction, bookingId: string, uid?: string) {
    const bookingRef = db!.collection('bookings').doc(bookingId), bookingSnap = await t.get(bookingRef);
    const booking = bookingSnap.data();
    assertPaymentLink({}, booking, uid);
    if (!booking || booking.id !== bookingId || booking.paymentMethod !== 'Xendit' || booking.gatewayEnvironment !== 'live' ||
        booking.gatewayProvider !== 'xendit' || !id(booking.gatewayReceiptId)) throw fail(409, 'LIVE_BOOKING_REQUIRED');
    const owner = booking.customerAuthUid;
    if (!id(owner) || booking.authUserId !== owner) throw fail(409, 'LIVE_BOOKING_OWNER_CONFLICT');
    const ref = reference(owner, bookingId), intentRef = db!.collection(SESSIONS).doc(ref);
    const receiptSnap = await t.get(db!.collection('voucher_checkout_receipts').doc(booking.gatewayReceiptId));
    const receipt = receiptSnap.data();
    if (!receipt || receipt.schemaVersion !== 2 || receipt.bookingId !== bookingId || receipt.customerAuthUid !== owner ||
        receipt.paymentMethod !== 'Xendit' || receipt.gatewayEnvironment !== 'live' || receipt.gatewayProvider !== 'xendit' ||
        typeof receipt.gatewayQuoteHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.gatewayQuoteHash) ||
        !Number.isInteger(receipt.totalAmount) || receipt.totalAmount < 10000 || receipt.totalAmount > 10000000) throw fail(409, 'LIVE_QUOTE_REQUIRED');
    const paymentRef = db!.collection('payments').doc(`PAY-${bookingId}`);
    const paymentSnap = await t.get(paymentRef), intentSnap = await t.get(intentRef);
    const intent = intentSnap.data(), payment = paymentSnap.data();
    if (intent && (intent.environment !== 'live' || intent.bookingId !== bookingId || intent.ownerUid !== owner ||
        intent.referenceId !== ref || intent.amount !== receipt.totalAmount || intent.quoteHash !== receipt.gatewayQuoteHash)) throw fail(409, 'LIVE_INTENT_CONFLICT');
    if (payment) {
      assertPaymentLink(payment, booking, uid);
      if (payment.provider !== 'xendit' || payment.gatewayEnvironment !== 'live' || payment.bookingId !== bookingId ||
          payment.amount !== receipt.totalAmount || payment.providerReferenceId !== ref) throw fail(409, 'LIVE_PAYMENT_CONFLICT');
    }
    return { bookingRef, bookingSnap, booking, receipt, owner, ref, intentRef, intent, paymentRef, payment };
  }
  function publicSession(value: any) {
    if (!value.intent) return null;
    const i = value.intent;
    return { bookingId: i.bookingId, referenceId: i.referenceId, amount: i.amount, currency: 'IDR', environment: 'live',
      creationState: i.creationState, sessionStatus: i.sessionStatus || null, paymentStatus: value.payment?.status || 'unpaid',
      sessionId: i.sessionId || null, checkoutUrl: i.checkoutUrl ? safeLiveCheckoutUrl(i.checkoutUrl) : null,
      expiresAt: i.expiresAt || null, lastWebhookAt: i.lastWebhookAt || null, lastCheckedAt: i.lastCheckedAt || null,
      paidSource: i.paidSource || null,
      reconciliationRequired: Boolean(value.payment?.reconciliationRequired) };
  }
  function canonical(session: any, i: any) {
    if (!session || !SESSION_ID.test(session.payment_session_id || '') || session.reference_id !== i.referenceId ||
        session.business_id !== config().businessId || session.amount !== i.amount || session.currency !== 'IDR' ||
        session.country !== 'ID' || session.session_type !== 'PAY' || session.mode !== 'PAYMENT_LINK' ||
        (session.capture_method !== undefined && session.capture_method !== 'AUTOMATIC') ||
        !['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELED'].includes(session.status) ||
        (i.sessionId && i.sessionId !== session.payment_session_id) || !Number.isFinite(Date.parse(session.expires_at)) ||
        (session.status === 'COMPLETED' && (typeof session.payment_id !== 'string' || !/^py-[A-Za-z0-9-]{16,100}$/.test(session.payment_id)))) {
      throw fail(409, 'XENDIT_LIVE_SESSION_CONFLICT');
    }
    return { sessionId: session.payment_session_id, sessionStatus: session.status,
      checkoutUrl: safeLiveCheckoutUrl(session.payment_link_url), expiresAt: session.expires_at,
      paymentId: session.payment_id || null };
  }
  async function apply(bookingId: string, session: any, source: 'create' | 'check' | 'webhook' | 'recovery', eventId?: string) {
    const result = await db!.runTransaction(async t => {
      const v = await load(t, bookingId);
      if (!v.intent || !v.payment) throw fail(409, 'LIVE_INTENT_REQUIRED');
      const s = canonical(session, v.intent);
      const eventRef = eventId ? db!.collection(EVENTS).doc(eventId) : null;
      const eventSnap = eventRef ? await t.get(eventRef) : null;
      if (eventSnap?.exists) return { session: publicSession(v), newlyPaid: false };
      const stamp = now(), alreadyPaid = v.payment.status === 'paid';
      // Completed is irreversible, even when an older response arrives after the webhook.
      const effective = alreadyPaid || v.intent.sessionStatus === 'COMPLETED' ? 'COMPLETED' :
        (['EXPIRED', 'CANCELED'].includes(v.intent.sessionStatus) && s.sessionStatus === 'ACTIVE' ? v.intent.sessionStatus : s.sessionStatus);
      const needsReview = effective === 'COMPLETED' && (closed(v.booking.status) && !alreadyPaid ||
        liveQuoteSeal(v.booking) !== v.receipt.gatewayQuoteHash ||
        v.booking.activePaymentId && v.booking.activePaymentId !== v.paymentRef.id);
      const newIntent = { ...v.intent, ...s, paymentId: s.paymentId || v.intent.paymentId || null, sessionStatus: effective, creationState: 'ready', updatedAt: stamp,
        ...(effective === 'COMPLETED' ? { paidSource: v.intent.paidSource || source } : {}),
        ...(source === 'webhook' ? { lastWebhookAt: stamp } : source === 'check' || source === 'recovery' ? { lastCheckedAt: stamp } : {}) };
      const paymentStatus = effective === 'COMPLETED' ? 'paid' : effective === 'EXPIRED' ? 'expired' : effective === 'CANCELED' ? 'cancelled' : 'pending';
      const update = { status: paymentStatus, gatewaySessionId: s.sessionId, gatewayCheckoutUrl: s.checkoutUrl,
        updatedAt: stamp, reconciliationRequired: Boolean(v.payment.reconciliationRequired || needsReview),
        ...(source === 'webhook' ? { gatewayLastWebhookAt: stamp } : {}),
        ...(paymentStatus === 'paid' ? { paidAt: v.payment.paidAt || stamp, verifiedAt: v.payment.verifiedAt || stamp,
          verifiedBy: 'xendit', verifiedByName: 'Xendit', providerTransactionId: s.paymentId || v.payment.providerTransactionId } : {}) };
      t.set(v.intentRef, newIntent);
      t.update(v.paymentRef, update);
      if (paymentStatus !== v.payment.status) {
        const event = `xendit_${v.ref}_${paymentStatus}`;
        t.set(db!.collection('payment_status_history').doc(event), { id: event, bookingId, bookingCode: v.booking.bookingCode,
          paymentId: v.paymentRef.id, oldStatus: v.payment.status, newStatus: paymentStatus, source: 'payment_gateway',
          gatewaySource: source,
          eventType: paymentStatus === 'paid' ? 'payment_verified' : 'payment_expired', createdAt: stamp });
      }
      const safeToSettle = liveQuoteSeal(v.booking) === v.receipt.gatewayQuoteHash &&
        (!v.booking.activePaymentId || v.booking.activePaymentId === v.paymentRef.id);
      if (paymentStatus === 'paid' && !alreadyPaid) {
        t.update(v.bookingRef, { updatedAt: stamp, gatewayReviewRequired: Boolean(needsReview),
          ...(safeToSettle ? { paymentStatus: 'PAID', paymentVerifiedAt: stamp, paymentVerifiedBy: 'Xendit',
            gatewayPaymentId: s.paymentId, activePaymentId: v.paymentRef.id } : {}),
          ...(!needsReview && ['Menunggu Pembayaran', 'awaiting_payment', 'Draft', 'Pending'].includes(v.booking.status) ? { status: 'Confirmed' } : {}) });
        if (!needsReview) t.set(db!.collection('booking_status_history').doc(`hist_xendit_${v.ref}_paid`), {
          id: `hist_xendit_${v.ref}_paid`, bookingId, bookingCode: v.booking.bookingCode,
          status: ['Menunggu Pembayaran', 'awaiting_payment', 'Draft', 'Pending'].includes(v.booking.status) ? 'Confirmed' : v.booking.status,
          updatedByRole: 'system', updatedByName: 'Xendit', note: 'Pembayaran penuh dikonfirmasi dari API Xendit Live.',
          timestamp: stamp, formattedWIB: `${new Date(stamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`, createdAt: stamp,
        });
      } else if (!alreadyPaid && ['expired', 'cancelled'].includes(paymentStatus)) {
        t.update(v.bookingRef, { paymentStatus, updatedAt: stamp });
      }
      if (eventRef) t.create(eventRef, { bookingId, referenceId: v.ref, sessionId: s.sessionId,
        sessionStatus: effective, environment: 'live', receivedAt: stamp });
      return { session: publicSession({ ...v, intent: newIntent, payment: { ...v.payment, ...update } }), newlyPaid: !alreadyPaid && paymentStatus === 'paid' && !needsReview };
    });
    if (result.newlyPaid && deps.onPaid) await deps.onPaid(bookingId).catch(() => {});
    return result.session;
  }
  async function status(req: Request) {
    const uid = await actor(req), input = body(req, ['bookingId']);
    return db!.runTransaction(async t => publicSession(await load(t, input.bookingId, uid)));
  }
  async function inspect(req: Request) {
    await actor(req, true); const input=body(req, ['bookingId']);
    return db!.runTransaction(async t => publicSession(await load(t, input.bookingId)));
  }
  async function checkout(req: Request) {
    const uid = await actor(req), input = body(req, ['bookingId']);
    rate(`create:${uid}`, 5);
    const intent = await db!.runTransaction(async t => {
      const v = await load(t, input.bookingId, uid);
      if (v.intent) return { existing: true, value: publicSession(v) };
      if (v.payment) throw fail(409, 'LIVE_PAYMENT_CONFLICT');
      config(true);
      if (closed(v.booking.status) || ['paid', 'PAID', 'pending_manual_verification'].includes(v.booking.paymentStatus) ||
          liveQuoteSeal(v.booking) !== v.receipt.gatewayQuoteHash || v.booking.gatewayReviewRequired) throw fail(409, 'LIVE_BOOKING_CLOSED');
      const deadline = bookingDeadline(v.booking, v.bookingSnap.createTime!.toMillis());
      // Xendit requires expires_at at least ten minutes ahead. Leave one minute
      // for network latency rather than issuing a request that cannot be accepted.
      if (!deadline || Date.parse(deadline) <= clock() + 11 * 60000) throw fail(409, 'LIVE_BOOKING_EXPIRED', 'Waktu yang tersisa tidak cukup untuk membuat sesi pembayaran. Hubungi Customer Service untuk pesanan ini.');
      const stamp = now(), i = { bookingId: input.bookingId, referenceId: v.ref, ownerUid: uid,
        amount: v.receipt.totalAmount, currency: 'IDR', environment: 'live', quoteHash: v.receipt.gatewayQuoteHash,
        creationState: 'creating', createdAt: stamp, updatedAt: stamp,
        expiresAt: new Date(Math.min(Date.parse(deadline), clock() + 30 * 60000)).toISOString() };
      const p = { id: v.paymentRef.id, bookingId: input.bookingId, bookingCode: v.booking.bookingCode,
        customerId: v.booking.customerId, customerAuthUid: uid, authUserId: uid,
        customerName: v.booking.customerName, customerWhatsApp: v.booking.customerWhatsApp,
        provider: 'xendit', gatewayEnvironment: 'live', providerReferenceId: v.ref, paymentType: 'gateway', methodType: 'gateway',
        paymentMethod: 'Xendit', amount: i.amount, currency: 'IDR', status: 'pending', paymentDeadline: deadline, createdAt: stamp, updatedAt: stamp };
      t.create(v.intentRef, i); t.create(v.paymentRef, p);
      t.update(v.bookingRef, { activePaymentId: v.paymentRef.id, paymentDeadline: deadline });
      return { existing: false, intent: i, customerName: v.booking.customerName, bookingCode: v.booking.bookingCode };
    });
    if (intent.existing) return intent.value;
    try {
      const i = intent.intent!, cfg = config();
      const session = await api('/sessions', { reference_id: i.referenceId, session_type: 'PAY', mode: 'PAYMENT_LINK',
        amount: i.amount, currency: 'IDR', country: 'ID', capture_method: 'AUTOMATIC', allow_save_payment_method: 'DISABLED',
        locale: 'id', expires_at: i.expiresAt, success_return_url: cfg.returnUrl, cancel_return_url: cfg.returnUrl,
        allowed_payment_channels: ['QRIS', 'BNI_VIRTUAL_ACCOUNT', 'BRI_VIRTUAL_ACCOUNT', 'MANDIRI_VIRTUAL_ACCOUNT'],
        customer: { reference_id: `shc_${hash(i.referenceId).slice(0, 40)}`, type: 'INDIVIDUAL',
          individual_detail: { given_names: String(intent.customerName).slice(0, 100) } },
        description: `Pembayaran penuh Senzu Home ${intent.bookingCode}`, metadata: { purpose: 'senzu_booking_live', booking_id: input.bookingId },
      });
      canonical(session, i);
      return await apply(input.bookingId, session, 'create');
    } catch (error: any) {
      await db!.runTransaction(async t => {
        const v = await load(t, input.bookingId, uid);
        // A webhook or a delayed valid response wins over a lost create response.
        if (v.intent?.creationState === 'creating' && !v.intent.sessionId) {
          t.update(v.intentRef, { creationState: error.definite ? 'rejected' : 'uncertain', updatedAt: now() });
          if (error.definite) t.update(v.paymentRef, { status: 'failed', updatedAt: now() });
        }
      }).catch(() => {});
      throw error;
    }
  }
  async function refresh(req: Request, recovery = false) {
    const uid = await actor(req, recovery), input = body(req, recovery ? ['bookingId', 'sessionId'] : ['bookingId']);
    const v = await db!.runTransaction(t => load(t, input.bookingId, recovery ? undefined : uid));
    if (!v.intent) throw fail(409, 'LIVE_INTENT_REQUIRED');
    const sessionId = recovery ? input.sessionId : v.intent.sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw fail(409, 'LIVE_SESSION_NOT_STORED', 'ID pembayaran belum tersedia. Hubungi Customer Service untuk memeriksa pesanan yang sama.');
    rate(`read:${uid}`, 10);
    return apply(input.bookingId, await api(`/sessions/${encodeURIComponent(sessionId)}`), recovery ? 'recovery' : 'check');
  }
  async function webhook(req: Request) {
    const cfg = config(), supplied = header(req, 'x-callback-token');
    const expected = Buffer.from(cfg.token), actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw fail(401, 'INVALID_WEBHOOK_TOKEN');
    rate(`webhook:${req.ip || 'unknown'}`, 300);
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail(400, 'INVALID_LIVE_WEBHOOK');
    const data = payload.data;
    if (!data || !REFERENCE.test(data.reference_id || '')) return { received: true, ignored: true, reason: 'UNRELATED_LIVE_SESSION', environment: 'live' };
    if (!['payment_session.completed', 'payment_session.expired'].includes(payload.event)) throw fail(400, 'INVALID_LIVE_EVENT');
    const sessionId = data.payment_session_id || data.id;
    if (!SESSION_ID.test(sessionId || '')) throw fail(400, 'INVALID_LIVE_SESSION_ID');
    const snap = await db!.collection(SESSIONS).doc(data.reference_id).get(), i = snap.data();
    if (!i) return { received: true, ignored: true, reason: 'UNKNOWN_LIVE_SESSION', environment: 'live' };
    if (data.business_id && data.business_id !== cfg.businessId || payload.business_id && payload.business_id !== cfg.businessId) throw fail(409, 'XENDIT_LIVE_MERCHANT_CONFLICT');
    const session = await api(`/sessions/${encodeURIComponent(sessionId)}`);
    canonical(session, i);
    const eventStatus = payload.event === 'payment_session.completed' ? 'COMPLETED' : 'EXPIRED';
    if (session.status !== eventStatus) {
      if (session.status === 'COMPLETED' && eventStatus === 'EXPIRED') {
        await apply(i.bookingId, session, 'webhook', hash(`${sessionId}:COMPLETED`));
      } else throw fail(503, 'XENDIT_LIVE_EVENT_PENDING');
    } else await apply(i.bookingId, session, 'webhook', hash(`${sessionId}:${eventStatus}`));
    return { received: true, environment: 'live' };
  }
  return { availability, checkout, status, inspect, refresh, webhook,
    assertBookingAllowed: () => config(true),
    prepareBookingRoute: async (lat: number, lng: number) => { config(true); return quoteLiveDrivingDistance(lat, lng, env, fetcher); },
    async managerStatus(req: Request) {
      await actor(req, true);
      return { ...availability(), webhookPath: WEBHOOK,
        liveKeyPresent: Boolean(env.XENDIT_LIVE_SECRET_KEY), liveTokenPresent: Boolean(env.XENDIT_LIVE_WEBHOOK_TOKEN),
        businessIdPresent: Boolean(env.XENDIT_LIVE_BUSINESS_ID), routeKeyPresent: Boolean(env.GOOGLE_MAPS_SERVER_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY),
        enabled: env.XENDIT_LIVE_ENABLED === 'true' };
    },
  };
}

export function registerXenditLive(app: Express, deps: Dependencies) {
  const service = createXenditLive(deps);
  const route = (fn: (r: Request) => Promise<any>, key?: string) => async (req: any, res: any) => {
    try { const value = await fn(req); res.json({ success: true, ...(key ? { [key]: value } : value) }); }
    catch (e: any) { res.status(e.status || 503).json({ success: false, code: e.code || 'XENDIT_LIVE_UNAVAILABLE',
      error: e.status ? e.message : 'Pembayaran belum dapat dimuat. Silakan coba kembali.' }); }
  };
  app.get('/api/integrations/xendit/live/availability', (_req, res) => {
    const value = service.availability(); res.set('Cache-Control', 'no-store').json({ success: true, available: value.available, environment: 'live' });
  });
  app.post('/api/integrations/xendit/live/checkout', route(service.checkout, 'session'));
  app.post('/api/integrations/xendit/live/status', route(service.status, 'session'));
  app.post('/api/integrations/xendit/live/inspect', route(service.inspect, 'session'));
  app.post('/api/integrations/xendit/live/refresh', route(req => service.refresh(req), 'session'));
  app.post('/api/integrations/xendit/live/recover', route(req => service.refresh(req, true), 'session'));
  app.post('/api/integrations/xendit/live/configuration', route(service.managerStatus));
  app.post(WEBHOOK, route(service.webhook));
  return service;
}
