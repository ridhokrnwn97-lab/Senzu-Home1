// Offline FAT Accounting contract tests. No credentials, Firebase, or Accurate traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { createAccurateConnection, registerAccurateConnection } from '../src/server/accurateConnection.ts';
import { ACCURATE_MASTERS, ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY } from '../src/lib/accurateContracts.ts';
import { FINANCE_COLUMNS, FINANCE_TABLE_MIN_WIDTH, financeColumnVars } from '../src/components/fat/financeColumns.ts';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const token = 'aat.' + 'A'.repeat(64) + '.offline_fixture';
const secret = 'signature_fixture_not_a_real_secret';
const meta = { database: { id: 96400, alias: ACCURATE_COMPANY, host: 'https://odin.accurate.id', deleted: false, admin: true },
  application: { name: ACCURATE_APP_NAME, appKey: ACCURATE_APP_KEY }, tokenType: 'api' };
const req = (bearer = 'fat1', body = {}) => ({ body, headers: { authorization: `Bearer ${bearer}` },
  rawHeaders: ['Authorization', `Bearer ${bearer}`], ip: 'fixture', socket: {} });

function fixture({ allow = ['fat1'], db = true } = {}) {
  const calls = [];
  const records = new Map(ACCURATE_MASTERS.map((v, i) => [v.code, { id: 100 + i, no: v.code, name: v.name,
    ...(v.kind === 'account' ? { accountType: v.type } : { itemType: v.type, unitPrice: v.price }), suspended: false }]));
  const deps = { db: db ? { runTransaction: fn => fn({}) } : null,
    env: { ACCURATE_API_TOKEN: token, ACCURATE_SIGNATURE_SECRET: secret },
    verify: async value => {
      if (value === 'invalid') throw Object.assign(new Error(), { code: 'auth/id-token-expired' });
      if (value === 'outage') throw Object.assign(new Error(), { code: 'auth/internal-error' });
      return { uid: value };
    },
    authorizeManager: async () => assert.fail('manager authorizer must not be used for FAT routes'),
    authorizeReadOnly: async (_t, uid) => {
      if (!allow.includes(uid)) throw Object.assign(new Error('denied'), { status: 403, code: 'MANAGER_ROLE_REQUIRED' });
    },
    clock: () => Date.parse('2026-10-22T08:00:00Z'), pause: async () => {},
    fetch: async (input, init) => {
      const url = new URL(input); calls.push({ url, init });
      if (url.hostname === 'account.accurate.id') return Response.json({ s: true, d: meta });
      const no = url.searchParams.get('no');
      return records.has(no) ? Response.json({ s: true, d: records.get(no) }) : Response.json({ s: false, d: [] });
    } };
  return { deps, calls };
}
async function withApp(deps, fn) {
  const app = express(); app.use(express.json()); registerAccurateConnection(app, deps);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(origin); } finally { await new Promise(r => server.close(r)); }
}
const call = (origin, path, bearer = 'fat1') => fetch(origin + path, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: '{}' });

test('FAT configuration is available and never contacts Accurate', async () => {
  const f = fixture(); const result = await createAccurateConnection(f.deps).configuration(req(), true);
  assert.deepEqual(result, { configured: true, apiTokenPresent: true, signatureSecretPresent: true,
    databaseIdPinned: false, mode: 'connection_only', writesEnabled: false });
  assert.equal(f.calls.length, 0);
});

test('FAT connection check returns connected status and read-only master checks', async () => {
  const f = fixture(); const result = await createAccurateConnection(f.deps).check(req(), true);
  assert.equal(result.connected, true); assert.equal(result.mastersMatch, true);
  assert.equal(result.writesEnabled, false); assert.equal(result.mode, 'connection_only');
  assert.equal(result.checks.length, ACCURATE_MASTERS.length);
  assert.ok(f.calls.every(c => c.url.hostname === 'account.accurate.id' || c.init.method === 'GET'));
  assert.equal(f.calls.some(c => /\/save\.do|\/delete\.do/.test(c.url.pathname)), false);
});

test('FAT routes return informative 401, 403, 404 and 503 and surface status in UI errors', async () => {
  for (const [setup, bearer, expected] of [
    [{}, 'invalid', 401], [allow => fixture({ allow }), 'css1', 403], [{ db: false }, 'fat1', 503],
  ]) {
    const f = typeof setup === 'function' ? setup([]) : fixture(setup);
    await withApp(f.deps, async origin => {
      const res = await call(origin, '/api/integrations/accurate/fat/configuration', bearer);
      assert.equal(res.status, expected);
      const body = await res.json(); assert.equal(body.success, false); assert.ok(body.code || body.error);
    });
  }
  await withApp(fixture().deps, async origin => {
    assert.equal((await call(origin, '/api/integrations/accurate/fat/not-a-route')).status, 404);
  });
  const ui = read('src/components/fat/FatAccountingTab.tsx');
  assert.match(ui, /json\?\.message \|\| json\?\.error/);
  assert.match(ui, /\(HTTP \$\{res\.status\}\)/);
});

test('one failed source cannot break the Accounting tab', () => {
  const ui = read('src/components/fat/FatAccountingTab.tsx');
  assert.match(ui, /Promise\.allSettled/);
  for (const setter of ['setConfig', 'setConnection', 'setSync', 'setError', 'setLoading']) assert.match(ui, new RegExp(setter));
  assert.doesNotMatch(ui, /Promise\.all\(/);
});

test('FAT cannot configure or mutate Accurate', () => {
  const conn = read('src/server/accurateConnection.ts');
  assert.match(conn, /\['configuration', 'check'\] as const/);
  assert.match(conn, /\$\{BASE\}\/fat\/\$\{action\}/);
  for (const action of ['configureManual', 'activate', 'pause', 'retry', 'run', 'activateFees', 'pauseFees']) {
    assert.doesNotMatch(conn, new RegExp(`fat/.*${action}`));
  }
  const server = read('server.ts');
  assert.match(server, /\['manager', 'admin', 'fat'\]\.includes\(roleName\)/);
  assert.match(server, /authorizeReadActor\(req, \['manager', 'admin', 'fat'\]\)/);
});

test('Accounting tab performs no Accurate sync or Firestore mutation', () => {
  const ui = read('src/components/fat/FatAccountingTab.tsx');
  const urls = [...ui.matchAll(/\/api\/integrations\/accurate\/[a-zA-Z0-9/_]+/g)].map(m => m[0]);
  assert.deepEqual(urls.sort(), [
    '/api/integrations/accurate/fat/check',
    '/api/integrations/accurate/fat/configuration',
    '/api/integrations/accurate/fat/sync/status',
  ]);
  assert.equal((ui.match(/method: 'POST'/g) || []).length, 1);
  for (const forbidden of ['onSnapshot', 'updateDoc', 'setDoc', 'addDoc', 'deleteDoc', 'sync/activate', 'sync/run', 'sync/configureManual']) {
    assert.doesNotMatch(ui, new RegExp(forbidden));
  }
  assert.match(ui, /writesEnabled === false/);
});

test('Finance table layout stays read-only; Tax component untouched', () => {
  const changed = execFileSync('git', ['diff', '--name-only'], { cwd: new URL('.', root), encoding: 'utf8' });
  assert.doesNotMatch(changed, /FatTaxTab\.tsx/);
  const finance = read('src/components/fat/FatFinanceTab.tsx');
  assert.match(finance, /export const FatFinanceTab/);
  for (const forbidden of ['onSnapshot', 'updateDoc', 'setDoc', 'addDoc', 'deleteDoc', "method: 'POST'"]) {
    assert.doesNotMatch(finance, new RegExp(forbidden));
  }
  assert.match(read('src/components/fat/FatTaxTab.tsx'), /export const FatTaxTab/);
});

test('Finance table declares nine explicit widths shared by headers, bodies and sticky offsets', () => {
  assert.equal(FINANCE_COLUMNS.length, 9);
  assert.equal(new Set(FINANCE_COLUMNS.map(c => c.key)).size, 9);
  for (const col of FINANCE_COLUMNS) {
    assert.ok(col.label && col.key, 'every column has a key and label');
    assert.equal(Number.isInteger(col.width) && col.width > 0, true, `${col.key} has an explicit positive width`);
  }
  assert.equal(FINANCE_TABLE_MIN_WIDTH, FINANCE_COLUMNS.reduce((sum, c) => sum + c.width, 0));
  const vars = financeColumnVars();
  assert.equal(Object.keys(vars).length, 9);
  FINANCE_COLUMNS.forEach((col, i) => assert.equal(vars[`--finance-col-${i}`], `${col.width}px`));

  const finance = read('src/components/fat/FatFinanceTab.tsx');
  assert.match(finance, /<colgroup>/);
  assert.match(finance, /FINANCE_COLUMNS\.map\(\(col, i\) => <col key=\{col\.key\} style=\{\{ width: `var\(--finance-col-\$\{i\}\)` \}\} \/>\)/);
  assert.match(finance, /minWidth: FINANCE_TABLE_MIN_WIDTH/);
  // Header and body both map the same config, so their structures cannot drift.
  assert.match(finance, /FINANCE_COLUMNS\.slice\(2\)\.map\(/);
  const bodyCells = finance.match(/<td className="[^"]*truncate[^"]*"/g) || [];
  assert.equal(bodyCells.length, 9, 'all nine body cells clip and ellipsize their content');
  const headerCells = finance.match(/<th className="[^"]*truncate[^"]*"/g) || [];
  assert.equal(headerCells.length, 2, 'first two headers are explicit sticky/non-sticky cells');
  assert.match(finance, /FINANCE_COLUMNS\.slice\(2\)\.map\(\(col\) => <th key=\{col\.key\} className="truncate py-2 pr-3"/);
  assert.equal(FINANCE_COLUMNS.slice(2).length, 7, 'remaining seven headers map the same config');
  assert.doesNotMatch(finance, /whitespace-nowrap/);
});

test('Finance sticky columns track the first width and never cover all mobile content', () => {
  const finance = read('src/components/fat/FatFinanceTab.tsx');
  assert.match(finance, /className="sticky left-0 z-30 truncate/);
  assert.match(finance, /className="sticky left-0 z-20 truncate/);
  // Second column offset is derived from the first column's CSS variable, not a duplicated literal.
  assert.match(finance, /sm:sticky sm:left-\[var\(--finance-col-0\)\]/);
  assert.match(finance, /sm:z-30/);
  assert.match(finance, /sm:z-10/);
  assert.equal((finance.match(/sm:sticky/g) || []).length, 2, 'only header and body second cells stick at sm+');
  // 390px viewport: first sticky column is 150px, second is revealed by scrolling.
  assert.ok(FINANCE_COLUMNS[0].width < 390, 'first sticky column cannot consume a 390px viewport');
  assert.match(finance, /w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x/);
  assert.doesNotMatch(finance, /overflow-hidden[^>]*>\s*<table/);
});

test('Finance display truncation keeps full values available in titles and export', () => {
  const finance = read('src/components/fat/FatFinanceTab.tsx');
  assert.match(finance, /title=\{p\.id\}/, 'full transaction id is available on hover');
  assert.match(finance, /title=\{p\.customerName \|\| '-'\}/, 'full customer name is available');
  assert.match(finance, /Nama Pemesan/);
  assert.match(finance, /'ID Transaksi': p\.id/, 'export uses the untruncated transaction id');
  assert.match(finance, /'Dibuat': fmtDate\(p\.createdAt\)/, 'export uses full dates');
  assert.match(finance, /'Diverifikasi': fmtDate\(p\.verifiedAt\)/);
  for (const control of ['setSearch', 'setStatusFilter', 'setMethodFilter', 'void load()', 'exportExcel']) {
    assert.match(finance, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${control} remains functional`);
  }
});
