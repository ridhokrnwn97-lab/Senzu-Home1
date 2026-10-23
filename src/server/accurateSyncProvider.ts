import { createHmac } from 'node:crypto';
import { ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY, ACCURATE_MASTERS } from '../lib/accurateContracts.ts';
import { ACCURATE_SYNC_DATABASE_ID } from '../lib/accurateSyncContracts.ts';

export const syncFailure = (code: string, review = false) => Object.assign(new Error(code), { code, review });
export const normalizeAccurate = (v: unknown) => typeof v === 'string' ? v.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
export const positiveId = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export function matchesAccurateCustomerNo(expected: string, ...aliases: unknown[]) {
  const supplied = aliases.filter(v => v !== undefined);
  // Customer responses use customerNo; older projections may expose no.
  // Never prefer one alias when another supplied value contradicts it.
  return supplied.length > 0 && supplied.every(v => typeof v === 'string' && v === expected);
}
export type AccurateDocumentKind = 'customer' | 'down_payment' | 'receipt' | 'invoice' | 'fee' | 'processing_fee';
const resource = (kind: AccurateDocumentKind) => ['fee', 'processing_fee'].includes(kind) ? 'journal-voucher' : kind === 'customer' ? 'customer' : kind === 'receipt' ? 'sales-receipt' : 'sales-invoice';
export function syncCredentialsConfigured(env: NodeJS.ProcessEnv) {
  return /^aat\.[A-Za-z0-9+/=._-]{32,16380}$/.test(env.ACCURATE_API_TOKEN || '') &&
    /^[!-~]{16,512}$/.test(env.ACCURATE_SIGNATURE_SECRET || '') &&
    (env.ACCURATE_DATABASE_ID === undefined || env.ACCURATE_DATABASE_ID === String(ACCURATE_SYNC_DATABASE_ID));
}
function itemAccountNo(data: any, prefixes: string[]) {
  const detail = Array.isArray(data.detailItemAccount) ? data.detailItemAccount.filter((v: any) => (v?.currency?.code || v?.currencyCode) === 'IDR') : [];
  if (detail.length > 1) return null;
  const candidates: unknown[] = [];
  for (const record of [data, ...detail]) for (const prefix of prefixes) {
    if (record[`${prefix}No`] !== undefined && record[`${prefix}No`] !== null) candidates.push(record[`${prefix}No`]);
    const nested = record[prefix];
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && 'no' in nested) candidates.push(nested.no);
  }
  // Accurate documents item mappings as salesGlAccountNo / salesDiscountGlAccountNo;
  // detail responses can expose the corresponding GlAccount object. Keep the
  // previous shapes compatible, but never select one conflicting alias over another.
  if (!candidates.length || candidates.some(v => typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(v)) || new Set(candidates).size !== 1) return null;
  return candidates[0];
}
function cloud(value: unknown) {
  let u: URL;
  try { if (typeof value !== 'string') throw new Error(); u = new URL(value); } catch { throw syncFailure('ACCURATE_HOST_UNVERIFIED', true); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash ||
      !/^[a-z][a-z0-9-]{0,62}\.accurate\.id$/.test(u.hostname) || u.hostname === 'account.accurate.id') throw syncFailure('ACCURATE_HOST_UNVERIFIED', true);
  return u.origin;
}
type Dependencies = { env: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: () => number; pause?: (ms: number) => Promise<void> };
export function createAccurateSyncProvider(deps: Dependencies) {
  const fetcher = deps.fetch || fetch, clock = deps.clock || Date.now;
  const pause = deps.pause || ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let lastRequest: number | null = null;
  async function connect(deadline: number) {
    const env = deps.env;
    if (!syncCredentialsConfigured(env)) throw syncFailure('ACCURATE_SYNC_SECRETS_INVALID', true);
    async function request(target: string, method: 'GET' | 'POST', payload?: Record<string, any>, metadata = false): Promise<any> {
      const original = new URL(target);
      const read = /^\/accurate\/api\/(customer|sales-invoice|sales-receipt|journal-voucher)\/(list|detail)\.do$/.test(original.pathname) ||
        /^\/accurate\/api\/(glaccount|item)\/detail\.do$/.test(original.pathname);
      const write = /^\/accurate\/api\/(customer|sales-invoice|sales-receipt|journal-voucher)\/save\.do$/.test(original.pathname) ||
        original.pathname === '/accurate/api/sales-invoice/create-down-payment.do';
      if (metadata ? target !== 'https://account.accurate.id/api/api-token.do' || method !== 'POST' || payload !== undefined :
          !(method === 'GET' && read && !payload || method === 'POST' && write && payload)) throw syncFailure('ACCURATE_OPERATION_INVALID', true);
      if (!metadata) cloud(original.origin);
      let url = original;
      for (let hop = 0; hop < 3; hop++) {
        if (lastRequest !== null) await pause(Math.max(0, 500 - (clock() - lastRequest)));
        const remaining = deadline - clock();
        if (remaining < 1000) throw syncFailure('ACCURATE_RETRY');
        const timestamp = new Date(clock()).toISOString(); lastRequest = clock();
        let response: Response;
        try {
          response = await fetcher(url.href, { method, redirect: 'manual', signal: AbortSignal.timeout(Math.min(10000, remaining)),
            headers: { Authorization: `Bearer ${env.ACCURATE_API_TOKEN}`, 'X-Api-Timestamp': timestamp,
              'X-Api-Signature': createHmac('sha256', env.ACCURATE_SIGNATURE_SECRET!).update(timestamp).digest('base64'),
              Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
            ...(payload ? { body: JSON.stringify(payload) } : {}) });
        } catch { throw syncFailure('ACCURATE_RETRY'); }
        if (response.status === 308 && method === 'GET' && !metadata) {
          let next: URL;
          try { next = new URL(response.headers.get('location') || '', url); } catch { throw syncFailure('ACCURATE_HOST_UNVERIFIED', true); }
          cloud(next.origin);
          if (!response.headers.get('location') || next.username || next.password || next.port || next.hash ||
              next.pathname !== original.pathname || next.search !== original.search || hop === 2) throw syncFailure('ACCURATE_HOST_UNVERIFIED', true);
          url = next; continue;
        }
        if (response.status >= 300 && response.status < 400) throw syncFailure('ACCURATE_HOST_UNVERIFIED', true);
        if (response.status === 429 || response.status >= 500) throw syncFailure('ACCURATE_RETRY');
        if (!response.ok) throw syncFailure('ACCURATE_REQUEST_REJECTED', true);
        let value: any;
        try { value = await response.json(); } catch { throw syncFailure('ACCURATE_RESPONSE_UNVERIFIED', true); }
        if (value?.s !== true) throw syncFailure('ACCURATE_REQUEST_REJECTED', true);
        return value.d;
      }
      throw syncFailure('ACCURATE_HOST_UNVERIFIED', true);
    }
    const metadata = await request('https://account.accurate.id/api/api-token.do', 'POST', undefined, true);
    const identities = [metadata?.database, metadata?.['data usaha']].filter(v => v !== undefined);
    const db = identities.length === 1 ? identities[0] : null;
    if (!db || db.id !== ACCURATE_SYNC_DATABASE_ID || db.deleted !== false || typeof db.admin !== 'boolean' ||
        normalizeAccurate(db.alias) !== normalizeAccurate(ACCURATE_COMPANY) || metadata?.application?.appKey !== ACCURATE_APP_KEY ||
        normalizeAccurate(metadata.application.name) !== normalizeAccurate(ACCURATE_APP_NAME) || metadata.tokenType !== 'api') throw syncFailure('ACCURATE_TARGET_MISMATCH', true);
    const origin = cloud(db.host);
    const get = (path: string, query: Record<string, string>) => request(`${origin}/accurate/api/${path}?${new URLSearchParams(query)}`, 'GET');
    async function lookup(kind: AccurateDocumentKind, number: string) {
      const type = resource(kind), filterField = kind === 'customer' ? 'no' : 'number';
      const responseField = kind === 'customer' ? 'customerNo' : 'number';
      const matchesNumber = (row: any) => kind === 'customer' ? matchesAccurateCustomerNo(number, row?.customerNo, row?.no) : row?.number === number;
      // Accurate's customer filter is filter.no, but its response field is
      // customerNo. Keep the filter and projection distinct.
      const rows = await get(`${type}/list.do`, { fields: `id,${responseField}`, [`filter.${filterField}.op`]: 'EQUAL',
        [`filter.${filterField}.val`]: number, 'sp.page': '1', 'sp.pageSize': '2' });
      if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !positiveId(row?.id) || !matchesNumber(row))) throw syncFailure('ACCURATE_DOCUMENT_COLLISION', true);
      if (!rows.length) return null;
      const detail = await get(`${type}/detail.do`, { id: String(rows[0].id) });
      if (!detail || detail.id !== rows[0].id || !matchesNumber(detail)) throw syncFailure('ACCURATE_DOCUMENT_COLLISION', true);
      return detail;
    }
    async function masters(itemCode?: string) {
      const expected = [...ACCURATE_MASTERS.filter(v => v.kind === 'account' || !itemCode || v.code === itemCode),
        { kind: 'account', code: '110301', name: 'Piutang Usaha IDR', type: 'ACCOUNT_RECEIVABLE' },
        { kind: 'account', code: '400004', name: 'Diskon Penjualan', type: 'REVENUE' }];
      for (const row of expected) {
        const data = await get(`${row.kind === 'account' ? 'glaccount' : 'item'}/detail.do`, { no: row.code });
        if (!data || !positiveId(data.id) || data.no !== row.code || normalizeAccurate(data.name) !== normalizeAccurate(row.name) || data.suspended === true ||
            (row.kind === 'account' ? data.accountType : data.itemType) !== row.type || ('price' in row && data.unitPrice !== row.price)) {
          throw syncFailure('ACCURATE_MASTER_MISMATCH', true);
        }
        if (row.kind === 'account' && ['110103', '110301', '210102'].includes(row.code) && (data.currency?.code || data.currencyCode) !== 'IDR') throw syncFailure('ACCURATE_CURRENCY_UNVERIFIED', true);
        if (row.kind === 'item') {
          const sales = itemAccountNo(data, ['salesGlAccount', 'salesAccount']);
          const discount = itemAccountNo(data, ['salesDiscountGlAccount', 'salesDiscountAccount']);
          if (sales !== '400005' || discount !== '400004') throw syncFailure('ACCURATE_ITEM_ACCOUNTS_UNVERIFIED', true);
          if (data.tax1?.id || data.tax2?.id || data.tax3?.id || data.tax4?.id || data.tax1Id || data.tax2Id || data.tax3Id || data.tax4Id || data.usePpn === true) throw syncFailure('ACCURATE_TAX_REVIEW_REQUIRED', true);
        }
      }
    }
    async function feeMasters() {
      for (const code of ['600031', '110103']) {
        const expected = ACCURATE_MASTERS.find(v => v.kind === 'account' && v.code === code);
        const data = await get('glaccount/detail.do', { no: code });
        if (!expected || !data || !positiveId(data.id) || data.no !== code || data.suspended === true ||
            normalizeAccurate(data.name) !== normalizeAccurate(expected.name) || data.accountType !== expected.type ||
            code === '110103' && (data.currency?.code || data.currencyCode) !== 'IDR') throw syncFailure('ACCURATE_MASTER_MISMATCH', true);
      }
    }
    async function save(kind: AccurateDocumentKind, payload: Record<string, any>) {
      if (['fee', 'processing_fee'].includes(kind) && (Object.keys(payload).sort().join(',') !== 'description,detailJournalVoucher,number,transDate' ||
          !(kind === 'fee' ? /^SHXF-[a-f0-9]{24}$/ : /^SHPF-[a-f0-9]{24}$/).test(payload.number || '') || typeof payload.description !== 'string' ||
          !(kind === 'fee' ? /^SENZU_HOME_FEE_V1:[a-f0-9]{64} \| / : /^SENZU_HOME_PROCESSING_V1:[a-f0-9]{64} \| PROCESSING_FEE_(?:VAT_)?DEDUCTION \| /).test(payload.description) ||
          !Array.isArray(payload.detailJournalVoucher) || payload.detailJournalVoucher.length !== 2 ||
          payload.detailJournalVoucher.some((r: any, i: number) => Object.keys(r).sort().join(',') !== 'accountNo,amount,amountType' ||
            r.accountNo !== (i === 0 ? '600031' : '110103') || r.amountType !== (i === 0 ? 'DEBIT' : 'CREDIT') ||
            typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0 || r.amount > 10000000 ||
            !/^\d+(?:\.\d{1,2})?$/.test(String(r.amount))) ||
          payload.detailJournalVoucher[0].amount !== payload.detailJournalVoucher[1].amount)) throw syncFailure('ACCURATE_OPERATION_INVALID', true);
      const path = kind === 'down_payment' ? 'sales-invoice/create-down-payment.do' : `${resource(kind)}/save.do`;
      return request(`${origin}/accurate/api/${path}`, 'POST', payload);
    }
    return { lookup, masters, feeMasters, save };
  }
  return { connect };
}

