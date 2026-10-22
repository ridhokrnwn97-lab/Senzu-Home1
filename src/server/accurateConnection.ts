import type { Express, Request } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHmac } from 'node:crypto';
import { ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY, ACCURATE_MASTERS,
  type AccurateConfiguration, type AccurateConnectionCheck, type AccurateMasterCheck } from '../lib/accurateContracts.ts';

type Dependencies = {
  db: Firestore | null;
  verify: (token: string) => Promise<{ uid: string }>;
  authorizeManager: (transaction: Transaction, uid: string) => Promise<unknown>;
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: () => number;
  pause?: (ms: number) => Promise<void>;
};
const BASE = '/api/integrations/accurate';
const META = 'https://account.accurate.id/api/api-token.do';
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Silakan masuk sebagai Manager atau Admin.', AUTH_INVALID: 'Sesi login tidak valid. Silakan masuk kembali.',
  INVALID_AUTH_HEADER: 'Header autentikasi tidak valid.', AUTH_UNAVAILABLE: 'Verifikasi login belum tersedia. Coba kembali.',
  DATABASE_UNAVAILABLE: 'Database aplikasi belum tersedia.', MANAGER_ROLE_REQUIRED: 'Akses Manager atau Admin aktif diperlukan.',
  INVALID_ACCURATE_REQUEST: 'Permintaan pemeriksaan tidak valid.', RATE_LIMITED: 'Terlalu banyak pemeriksaan. Coba sebentar lagi.',
  ACCURATE_NOT_CONFIGURED: 'Pasang ACCURATE_API_TOKEN dan ACCURATE_SIGNATURE_SECRET di Secrets server.',
  ACCURATE_DATABASE_PIN_INVALID: 'ACCURATE_DATABASE_ID harus berupa ID database Accurate yang valid.',
  ACCURATE_IDENTITY_MISMATCH: 'Token tidak cocok dengan aplikasi Senzu Home atau data usaha PT KSBONE UNTUK KITA.',
  ACCURATE_DATABASE_MISMATCH: 'ID database Accurate tidak cocok dengan ID yang ditetapkan di server.',
  ACCURATE_TOKEN_REJECTED: 'Accurate menolak token atau signature. Periksa Secrets server dan waktu server.',
  ACCURATE_ACCESS_DENIED: 'Hak akses token belum mengizinkan pemeriksaan ini.',
  ACCURATE_UPSTREAM_REJECTED: 'Accurate belum dapat memverifikasi data master ini.',
  ACCURATE_UNAVAILABLE: 'Accurate belum dapat dihubungi. Coba periksa kembali.',
  ACCURATE_INVALID_RESPONSE: 'Respons Accurate belum dapat diverifikasi.',
  ACCURATE_UNSAFE_REDIRECT: 'Alamat server Accurate belum dapat diverifikasi.',
  ACCURATE_CHECK_BUSY: 'Pemeriksaan Accurate masih berjalan. Tunggu sampai selesai.',
};
const fail = (status: number, code: string) => Object.assign(new Error(MESSAGES[code] || 'Pemeriksaan Accurate belum berhasil.'), { status, code });
const normalize = (v: unknown) => typeof v === 'string' ? v.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
const validId = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;

// Accept only Accurate's public cloud database origins. No URL comes from the caller.
function cloudOrigin(value: unknown): string {
  let u: URL;
  try { if (typeof value !== 'string') throw new Error(); u = new URL(value); }
  catch { throw fail(502, 'ACCURATE_UNSAFE_REDIRECT'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash ||
      !/^[a-z][a-z0-9-]{0,62}\.accurate\.id$/.test(u.hostname) || u.hostname === 'account.accurate.id') {
    throw fail(502, 'ACCURATE_UNSAFE_REDIRECT');
  }
  return u.origin;
}

export function createAccurateConnection(deps: Dependencies) {
  const env = deps.env || process.env, fetcher = deps.fetch || fetch, clock = deps.clock || Date.now;
  const pause = deps.pause || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const rates = new Map<string, { count: number; until: number }>();
  let busy = false;
  let lastRequestAt: number | null = null;
  function rate(key: string, maximum: number) {
    const time = clock();
    for (const [k, v] of rates) if (v.until <= time) rates.delete(k);
    const v = rates.get(key);
    if ((v && v.count >= maximum) || (!v && rates.size >= 5000)) throw fail(429, 'RATE_LIMITED');
    rates.set(key, { count: (v?.count || 0) + 1, until: v?.until || time + 60000 });
  }
  async function actor(req: Request) {
    rate(`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`, 120);
    const count = (req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(k => k.toLowerCase() === 'authorization').length;
    if (count > 1 || Object.keys(req.headers).some(k => k.toLowerCase() === 'x-firebase-auth')) throw fail(401, 'INVALID_AUTH_HEADER');
    const match = typeof req.headers.authorization === 'string' && /^Bearer (\S+)$/.exec(req.headers.authorization);
    if (!match) throw fail(401, 'AUTH_REQUIRED');
    let identity: { uid: string };
    try { identity = await deps.verify(match[1]); }
    catch (e: any) {
      const invalid = /^auth\/(id-token-expired|id-token-revoked|invalid-id-token|argument-error|user-disabled|user-not-found)$/.test(e?.code || '');
      throw fail(invalid ? 401 : 503, invalid ? 'AUTH_INVALID' : 'AUTH_UNAVAILABLE');
    }
    if (!identity?.uid || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)) throw fail(401, 'AUTH_INVALID');
    rate(`uid:${identity.uid}`, 60);
    if (!deps.db) throw fail(503, 'DATABASE_UNAVAILABLE');
    await deps.db.runTransaction(t => deps.authorizeManager(t, identity.uid));
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
      throw fail(400, 'INVALID_ACCURATE_REQUEST');
    }
    return identity.uid;
  }
  const tokenValid = () => /^aat\.[A-Za-z0-9+/=._-]{32,16380}$/.test(env.ACCURATE_API_TOKEN || '');
  const signatureValid = () => /^[!-~]{16,512}$/.test(env.ACCURATE_SIGNATURE_SECRET || '');
  function config() {
    if (!tokenValid() || !signatureValid()) throw fail(503, 'ACCURATE_NOT_CONFIGURED');
    const pin = env.ACCURATE_DATABASE_ID;
    if (pin !== undefined && (!/^[1-9][0-9]{0,14}$/.test(pin) || !validId(Number(pin)))) throw fail(503, 'ACCURATE_DATABASE_PIN_INVALID');
    return { token: env.ACCURATE_API_TOKEN!, secret: env.ACCURATE_SIGNATURE_SECRET!, databaseId: pin ? Number(pin) : null };
  }
  async function configuration(req: Request): Promise<AccurateConfiguration> {
    await actor(req);
    let configured = false;
    try { config(); configured = true; } catch {}
    return { mode: 'connection_only', writesEnabled: false, configured,
      apiTokenPresent: tokenValid(), signatureSecretPresent: signatureValid(), databaseIdPinned: Boolean(env.ACCURATE_DATABASE_ID) };
  }
  async function check(req: Request): Promise<AccurateConnectionCheck> {
    const uid = await actor(req), cfg = config();
    rate(`check:${uid}`, 3);
    if (busy) throw fail(409, 'ACCURATE_CHECK_BUSY');
    busy = true;
    const deadline = clock() + 60000;
    // These are the complete upstream operations. There is no financial save/delete API.
    async function request(url: string, metadata = false): Promise<any> {
      const original = new URL(url);
      if (metadata ? url !== META : !/^\/accurate\/api\/(glaccount|item)\/detail\.do$/.test(original.pathname)) {
        throw fail(502, 'ACCURATE_INVALID_RESPONSE');
      }
      if (!metadata) cloudOrigin(original.origin);
      let target = original;
      for (let hop = 0; hop < 3; hop++) {
        if (lastRequestAt !== null) await pause(Math.max(0, 250 - (clock() - lastRequestAt)));
        const remaining = deadline - clock();
        if (remaining <= 0) throw fail(503, 'ACCURATE_UNAVAILABLE');
        const timestamp = new Date(clock()).toISOString();
        lastRequestAt = clock();
        let response: Response;
        try {
          response = await fetcher(target.href, { method: metadata ? 'POST' : 'GET', redirect: 'manual',
            signal: AbortSignal.timeout(Math.min(10000, remaining)), headers: {
              Authorization: `Bearer ${cfg.token}`, 'X-Api-Timestamp': timestamp,
              'X-Api-Signature': createHmac('sha256', cfg.secret).update(timestamp).digest('base64'), Accept: 'application/json',
            } });
        } catch { throw fail(503, 'ACCURATE_UNAVAILABLE'); }
        if (response.status === 308 && !metadata) {
          const location = response.headers.get('location');
          if (!location) throw fail(502, 'ACCURATE_UNSAFE_REDIRECT');
          let next: URL;
          try { next = new URL(location, target); } catch { throw fail(502, 'ACCURATE_UNSAFE_REDIRECT'); }
          cloudOrigin(next.origin);
          if (next.username || next.password || next.port || next.hash || next.pathname !== original.pathname || next.search !== original.search || hop === 2) {
            throw fail(502, 'ACCURATE_UNSAFE_REDIRECT');
          }
          target = next; continue;
        }
        if (response.status >= 300 && response.status < 400) throw fail(502, 'ACCURATE_UNSAFE_REDIRECT');
        if (response.status === 401) throw fail(502, 'ACCURATE_TOKEN_REJECTED');
        if (response.status === 403) throw fail(502, 'ACCURATE_ACCESS_DENIED');
        if (response.status === 429 || response.status >= 500) throw fail(503, 'ACCURATE_UNAVAILABLE');
        if (!response.ok) throw fail(502, 'ACCURATE_UPSTREAM_REJECTED');
        let value: any;
        try { value = await response.json(); } catch { throw fail(502, 'ACCURATE_INVALID_RESPONSE'); }
        if (value?.s !== true) throw fail(502, 'ACCURATE_UPSTREAM_REJECTED');
        return value.d;
      }
      throw fail(502, 'ACCURATE_UNSAFE_REDIRECT');
    }
    try {
      const metadata = await request(META, true);
      // The vendor's Token guide labels this object "data usaha"; some API
      // versions use "database". Never accept two conflicting identities.
      const identities = [metadata?.database, metadata?.['data usaha']].filter(v => v !== undefined);
      const database = identities.length === 1 ? identities[0] : null;
      if (!database || !validId(database.id) || database.deleted !== false ||
          normalize(database.alias) !== normalize(ACCURATE_COMPANY) ||
          metadata?.application?.appKey !== ACCURATE_APP_KEY || normalize(metadata.application.name) !== normalize(ACCURATE_APP_NAME) ||
          metadata.tokenType !== 'api' || typeof database.admin !== 'boolean') throw fail(409, 'ACCURATE_IDENTITY_MISMATCH');
      if (cfg.databaseId && database.id !== cfg.databaseId) throw fail(409, 'ACCURATE_DATABASE_MISMATCH');
      const origin = cloudOrigin(database.host);
      const checks: AccurateMasterCheck[] = [];
      for (const expected of ACCURATE_MASTERS) {
        const row: AccurateMasterCheck = { kind: expected.kind, code: expected.code, name: expected.name, status: 'unverified', note: 'Data belum dapat diverifikasi.' };
        try {
          const data = await request(`${origin}/accurate/api/${expected.kind === 'account' ? 'glaccount' : 'item'}/detail.do?no=${encodeURIComponent(expected.code)}`);
          if (!data || typeof data !== 'object' || Array.isArray(data) || !validId(data.id)) throw fail(502, 'ACCURATE_INVALID_RESPONSE');
          const identityMatches = data.no === expected.code && normalize(data.name) === normalize(expected.name);
          const typeMatches = (expected.kind === 'account' ? data.accountType : data.itemType) === expected.type;
          const priceMatches = expected.kind === 'account' || (typeof data.unitPrice === 'number' && data.unitPrice === expected.price);
          row.status = identityMatches && typeMatches && priceMatches && data.suspended !== true ? 'match' : 'mismatch';
          row.note = row.status === 'match' ? (expected.kind === 'item' ? 'Kode, nama, jenis Service, dan harga cocok.' : 'Kode, nama, dan jenis akun cocok.') :
            data.suspended === true ? 'Master tidak aktif.' : !identityMatches ? 'Kode atau nama master tidak cocok.' : !typeMatches ? 'Jenis master tidak cocok.' : 'Harga dasar layanan tidak cocok.';
        } catch (e: any) {
          // A rejected detail can mean a missing master. Do not infer success or expose provider errors.
          if (e?.code !== 'ACCURATE_UPSTREAM_REJECTED') throw e;
        }
        checks.push(row);
      }
      // A Manager may lose their Staff Master permissions while the network
      // check is running. Re-authorize before returning any provider result.
      await deps.db!.runTransaction(t => deps.authorizeManager(t, uid));
      return { mode: 'connection_only', writesEnabled: false, connected: true, companyName: ACCURATE_COMPANY,
        applicationName: ACCURATE_APP_NAME, databaseId: database.id, databaseIdPinned: Boolean(cfg.databaseId),
        access: database.admin ? 'administrator' : 'operator', checkedAt: new Date(clock()).toISOString(),
        mastersMatch: checks.every(c => c.status === 'match'), checks };
    } finally { busy = false; }
  }
  return { configuration, check };
}

export function registerAccurateConnection(app: Express, deps: Dependencies) {
  const service = createAccurateConnection(deps);
  for (const action of ['configuration', 'check'] as const) {
    app.post(`${BASE}/${action}`, async (req, res) => {
      res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
      try { res.json({ success: true, ...await service[action](req) }); }
      catch (e: any) {
        const known = Boolean(e?.code && MESSAGES[e.code]);
        const code = known ? e.code : e?.status === 403 ? 'MANAGER_ROLE_REQUIRED' : 'ACCURATE_UNAVAILABLE';
        res.status(known ? e.status : e?.status === 403 ? 403 : 503).json({ success: false, code, error: MESSAGES[code] });
      }
    });
  }
  return service;
}
