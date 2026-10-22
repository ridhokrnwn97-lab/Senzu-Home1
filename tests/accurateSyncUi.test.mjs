// Local React + HTTP fixtures. Never uses the signed-in Cloud Browser or real APIs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import express from 'express';
import { ACCURATE_SYNC_DATABASE_ID as TARGET } from '../src/lib/accurateSyncContracts.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const playwright = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
let server, browser, origin, temp;
const id = 'a'.repeat(64);
const initial = { success: true, mode: 'posting_v1', databaseId: TARGET, writesConfigured: true, schedulerConfigured: false,
  enabled: false, activatedAt: null, taxPolicy: null, jobs: [] };
const previewFixture = { success: true, bookingCode: 'SH-261022-FIX01', amount: 160000, servicePrice: 160000, visitFee: 0, discount: 0,
  historical: true, eligible: false, itemCode: 'SH-SIG-030', note: 'Booking dibuat sebelum aktivasi. Tidak dimasukkan otomatis.',
  downPaymentNumber: `SHDP-${id.slice(0, 24)}`, receiptNumber: `SHRC-${id.slice(0, 24)}`, invoiceNumber: `SHIV-${id.slice(0, 24)}` };
const netFixture = { success: true, mode: 'xendit_net_preview_v1', environment: 'live', readOnly: true, bookingCode: 'SH-261022-FIX01',
  referenceId: 'shl_' + 'b'.repeat(48), paymentId: 'py-123e4567-e89b-12d3-a456-426614174000', productId: '123e4567-e89b-12d3-a456-426614174000',
  transactionId: '123e4567-e89b-12d3-a456-426614174111', channelCategory: 'VIRTUAL_ACCOUNT', channelCode: 'MANDIRI', currency: 'IDR',
  grossAmount: 160000, xenditFee: 9000, valueAddedTax: 990, xenditWithholdingTax: 0, thirdPartyWithholdingTax: 0, netAmount: 150010,
  feeStatus: 'COMPLETED', settlementStatus: 'SETTLED', transactionUpdatedAt: '2026-10-22T05:42:43Z', checkedAt: '2026-10-22T09:00:00Z',
  processingFeeIncluded: false, bankPayoutVerified: false };
const stateDiagnosticFixture = { success: true, mode: 'xendit_state_diagnostic_v1', environment: 'live', readOnly: true, verified: false,
  bookingCode: 'SH-261022-FIX01', checkedAt: '2026-10-22T09:00:00Z', checks: {
    type: { kind: 'known', value: 'PAYMENT' }, status: { kind: 'known', value: 'SUCCESS' }, cashflow: { kind: 'missing', value: null },
  } };
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'senzu-accurate-sync-ui-'));
  const mocks = {
    firebase: `const listeners=new Set();const makeUser=uid=>uid?{uid,getIdToken:async()=> 'fixture_'+uid}:null;
      export const auth={currentUser:makeUser('manager1')};
      export function subscribe(fn){listeners.add(fn);queueMicrotask(()=>{if(listeners.has(fn))fn(auth.currentUser);});return()=>listeners.delete(fn);}
      window.__setAuth=uid=>{auth.currentUser=makeUser(uid);for(const fn of listeners)fn(auth.currentUser);};`,
    auth: `import{subscribe}from'fixture:firebase';export const onAuthStateChanged=(_,fn)=>subscribe(fn);`,
  };
  await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{AccurateSyncCard}from'./src/components/admin/AccurateSyncCard';
    createRoot(document.getElementById('root')).render(<AccurateSyncCard currentUser={{uid:'manager1',role:new URLSearchParams(location.search).get('role')||'manager'}}/>);`,
    resolveDir: root, loader: 'tsx' }, bundle: true, format: 'esm', outfile: path.join(temp, 'bundle.js'),
    plugins: [{ name: 'firebase-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = args.path.startsWith('fixture:') ? args.path.slice(8) : args.path === 'firebase/auth' ? 'auth' : /(^|\/)firebase$/.test(args.path) ? 'firebase' : null;
        if (key) return { path: key, namespace: 'fixture' };
      }); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const app = express(); app.get('/bundle.js', (_, res) => res.sendFile(path.join(temp, 'bundle.js')));
  app.get('/', (_, res) => res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.__events=[];window.fbq=(...args)=>window.__events.push(args);</script><script type="module" src="/bundle.js"></script>'));
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.XENDIT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.XENDIT_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); if (temp) await fs.rm(temp, { recursive: true, force: true }); });
async function fixture(query = '') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const state = { calls: [], status: structuredClone(initial), preview: structuredClone(previewFixture), net: structuredClone(netFixture), netError: null, delay: null, html: false };
  await context.route('**/api/integrations/accurate/sync/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1), payload = route.request().postDataJSON();
    state.calls.push({ action, payload, authorization: route.request().headers().authorization });
    const result = structuredClone(action === 'preview' ? state.preview : action === 'netPreview' ? state.net : state.status);
    if (action === 'activate') { result.enabled = true; result.activatedAt = '2026-10-22T04:00:00Z'; result.taxPolicy = 'no_extra_tax'; state.status = structuredClone(result); }
    if (action === 'pause') { result.enabled = false; state.status = structuredClone(result); }
    if (state.delay && ['preview', 'netPreview'].includes(action)) await state.delay;
    if (state.html) await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>private provider error</html>' }).catch(() => {});
    else if (action === 'netPreview' && state.netError) await route.fulfill({ status: 502, json: { success: false, code: state.netError, error: 'untrusted private provider text' } }).catch(() => {});
    else await route.fulfill({ json: result }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/' + query); return { context, page, state, errors };
}
async function ready(page) { await page.getByText('Pengiriman dari server belum diizinkan.', { exact: true }).count(); await page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Muat Ulang Status Pencatatan')?.disabled); }
async function preview(page) {
  await page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX01');
  await page.getByRole('button', { name: 'Pratinjau Tanpa Mencatat' }).click(); await page.getByText(previewFixture.note, { exact: true }).waitFor();
}
test('mount only reads status; historical preview has no activation, financial write or Meta event', async () => {
  const f = await fixture(); try {
    await ready(f.page); assert.deepEqual(f.state.calls.map(c => c.action), ['status']);
    await preview(f.page); assert.deepEqual(f.state.calls.map(c => c.action), ['status', 'preview']);
    assert.deepEqual(f.state.calls[1].payload, { bookingId: 'bk_SH-261022-FIX01' });
    assert.equal(await f.page.getByRole('button', { name: 'Aktifkan Pencatatan Booking Baru' }).isDisabled(), true);
    assert.equal(await f.page.locator('input[type=password],textarea').count(), 0); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});
test('activation requires preview plus both confirmations and server enablement', async () => {
  const f = await fixture(); try {
    await ready(f.page); const activate = f.page.getByRole('button', { name: 'Aktifkan Pencatatan Booking Baru' });
    await f.page.getByRole('checkbox').nth(0).check(); await f.page.getByRole('checkbox').nth(1).check(); assert.equal(await activate.isDisabled(), true);
    await preview(f.page); assert.equal(await f.page.getByRole('checkbox').nth(0).isChecked(), false);
    await f.page.getByRole('checkbox').nth(0).check(); assert.equal(await activate.isDisabled(), true);
    await f.page.getByRole('checkbox').nth(1).check(); assert.equal(await activate.isEnabled(), true);
    await activate.click(); await f.page.getByText('Aktif', { exact: true }).waitFor();
    assert.deepEqual(f.state.calls.at(-1).payload, { acknowledgement: 'NEW_LIVE_XENDIT_PAYMENTS_ONLY', taxPolicy: 'no_extra_tax' });
    await f.page.getByRole('button', { name: 'Jeda Pengiriman Accurate' }).click(); await f.page.getByText('Dijeda', { exact: true }).waitFor();
    assert.deepEqual(await f.page.evaluate(() => window.__events), []);
  } finally { await f.context.close(); }
  const g = await fixture(); try {
    await ready(g.page); g.state.status.writesConfigured = false; await g.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click();
    await g.page.getByText('Pengiriman dari server belum diizinkan.', { exact: true }).waitFor(); await preview(g.page);
    await g.page.getByRole('checkbox').nth(0).check(); await g.page.getByRole('checkbox').nth(1).check(); assert.equal(await g.page.getByRole('button', { name: 'Aktifkan Pencatatan Booking Baru' }).isDisabled(), true);
  } finally { await g.context.close(); }
});
test('non-managers never request private queue status', async () => {
  for (const role of ['customer', 'therapist', 'supervisor', 'css']) {
    const f = await fixture('?role=' + role); try { await f.page.waitForLoadState('networkidle'); assert.deepEqual(f.state.calls, []); assert.equal(await f.page.locator('section').count(), 0); } finally { await f.context.close(); }
  }
});
test('uncertain numbers remain distinct from documents confirmed by the backend', async () => {
  const f = await fixture(); try {
    await ready(f.page); f.state.status.jobs = [{ id, bookingCode: 'SH-261022-FIX01', amount: 160000, state: 'review', createdAt: '2026-10-22T04:00:00Z', updatedAt: '2026-10-22T04:01:00Z',
      note: 'Perlu pemeriksaan Manager.', downPaymentNumber: `SHDP-${id.slice(0, 24)}`, receiptNumber: `SHRC-${id.slice(0, 24)}`, invoiceNumber: `SHIV-${id.slice(0, 24)}`, confirmed: ['down_payment'] }];
    await f.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click(); await f.page.locator('tbody tr').waitFor();
    const text = await f.page.locator('tbody').innerText(); assert.match(text, /Uang muka:.*\(terverifikasi\)/); assert.match(text, /Penerimaan:.*\(belum terverifikasi\)/);
    assert.equal(f.state.calls.some(c => ['activate', 'run', 'retry'].includes(c.action)), false);
  } finally { await f.context.close(); }
});
test('late preview after account switch or logout cannot retain preview or consent', async () => {
  const f = await fixture(); let release; try {
    await ready(f.page); f.state.delay = new Promise(r => release = r);
    await f.page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX01'); await f.page.getByRole('button', { name: 'Pratinjau Tanpa Mencatat' }).click();
    await f.page.evaluate(() => window.__setAuth('manager2')); release(); await ready(f.page);
    assert.equal(await f.page.getByLabel('Booking untuk pratinjau Accurate').inputValue(), ''); assert.equal(await f.page.getByText(previewFixture.note, { exact: true }).count(), 0);
    assert.equal(await f.page.getByRole('checkbox').nth(0).isChecked(), false);
    await f.page.evaluate(() => window.__setAuth(null)); assert.equal(await f.page.getByRole('button', { name: 'Aktifkan Pencatatan Booking Baru' }).isDisabled(), true);
    assert.deepEqual(f.errors, []); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
  } finally { release?.(); await f.context.close(); }
});
test('wrong database and raw HTML errors cannot show a usable queue or leak details', async () => {
  const f = await fixture(); try {
    await ready(f.page); f.state.status.databaseId = 123; await f.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click();
    await f.page.getByRole('alert').waitFor(); assert.equal((await f.page.locator('body').innerText()).includes('123'), false);
    f.state.html = true; await f.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click(); await f.page.getByRole('alert').waitFor();
    assert.equal((await f.page.locator('body').innerText()).includes('private provider error'), false);
  } finally { await f.context.close(); }
});
async function netPreview(page) {
  await page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX01');
  await page.getByRole('button', { name: 'Pratinjau Biaya & Neto Xendit' }).click();
}
test('net preview displays gross, actual fees and net with separate processing and bank evidence boundaries, without posting or Meta events', async () => {
  const f = await fixture(); try {
    await ready(f.page); await netPreview(f.page);
    const result = f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }); await result.waitFor();
    const text = await result.innerText();
    for (const expected of [/160\.000/, /9\.000/, /990/, /150\.010/, /Processing fee harian dan PPN-nya belum termasuk/,
      /belum membuktikan dana masuk rekening bank/, /Tidak mencatat biaya ke Accurate/, /Finance/]) assert.match(text, expected);
    assert.deepEqual(f.state.calls.map(c => c.action), ['status', 'netPreview']); assert.deepEqual(f.state.calls.at(-1).payload, { bookingId: 'bk_SH-261022-FIX01' });
    assert.equal(f.state.calls.at(-1).authorization, 'Bearer fixture_manager1');
    assert.equal(await f.page.getByRole('button', { name: 'Aktifkan Pencatatan Booking Baru' }).isDisabled(), true);
    assert.deepEqual(await f.page.evaluate(() => window.__events), []); assert.deepEqual(f.errors, []);
    await f.page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX02'); assert.equal(await result.count(), 0);
  } finally { await f.context.close(); }
});
test('net preview refuses malformed, wrong booking, nonfinal, miscalculated or posting-capable responses', async () => {
  for (const change of [v => v.netAmount = 145570, v => v.bookingCode = 'SH-261022-OTHER', v => v.readOnly = false,
    v => v.feeStatus = 'PENDING', v => delete v.valueAddedTax, v => v.bankPayoutVerified = true,
    v => v.processingFeeIncluded = true, v => v.grossAmount = '160000', v => v.productId = 'foreign', v => v.currency = 'USD',
    v => v.referenceId = [v.referenceId], v => v.xenditWithholdingTax = 100]) {
    const f = await fixture(); try {
      await ready(f.page); change(f.state.net); await netPreview(f.page); await f.page.getByRole('alert').waitFor();
      assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
      assert.deepEqual(f.state.calls.map(c => c.action), ['status', 'netPreview']); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    } finally { await f.context.close(); }
  }
});
test('a failed net reread clears prior values and explains permission or pending fees without raw provider details', async () => {
  for (const [code, pattern] of [['XENDIT_TRANSACTION_PERMISSION_REQUIRED', /Transaction Read/], ['XENDIT_FEES_PENDING', /belum berstatus COMPLETED/],
    ['XENDIT_PRODUCT_MISMATCH', /Product ID/], ['XENDIT_LIST_MULTIPLE_RESULTS', /lebih dari satu hasil/],
    ['XENDIT_FEE_WITHHOLDING_UNVERIFIED', /withholding.*tidak lengkap/], ['XENDIT_NET_AMOUNT_UNVERIFIED', /Nominal neto/]]) {
    const f = await fixture(); try {
      await ready(f.page); await netPreview(f.page); await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).waitFor();
      f.state.netError = code; await f.page.getByRole('button', { name: 'Pratinjau Biaya & Neto Xendit' }).click();
      const alert = f.page.getByRole('alert'); await alert.waitFor(); assert.match(await alert.innerText(), pattern);
      assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
      assert.equal((await f.page.locator('body').innerText()).includes('untrusted private provider text'), false);
      assert.equal(f.state.calls.some(c => ['activate', 'retry', 'run'].includes(c.action)), false);
    } finally { await f.context.close(); }
  }
});
test('a known Xendit read error preserves the loaded active accounting queue without showing an activation form', async () => {
  const f = await fixture(); try {
    await ready(f.page); Object.assign(f.state.status, { enabled: true, activatedAt: '2026-10-22T05:21:20Z', taxPolicy: 'no_extra_tax',
      jobs: [{ id, bookingCode: 'SH-261022-FIX01', amount: 160000, state: 'waiting_service', createdAt: '2026-10-22T05:42:43Z', updatedAt: '2026-10-22T05:42:43Z',
        note: 'Uang muka dan penerimaan tercatat. Menunggu treatment selesai.', downPaymentNumber: `SHDP-${id.slice(0,24)}`,
        receiptNumber: `SHRC-${id.slice(0,24)}`, invoiceNumber: `SHIV-${id.slice(0,24)}`, confirmed: ['down_payment','receipt'] }] });
    await f.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click(); await f.page.getByText('Aktif', { exact: true }).waitFor();
    f.state.netError = 'XENDIT_PRODUCT_MISMATCH'; await netPreview(f.page); await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.getByText('Aktif', { exact: true }).count(), 1); assert.equal(await f.page.locator('tbody tr').count(), 1);
    assert.equal(await f.page.getByRole('heading', { name: 'Aktivasi pencatatan booking baru' }).count(), 0);
    assert.equal(await f.page.getByRole('button', { name: 'Proses Antrean Sekarang' }).isEnabled(), true);
    assert.deepEqual(f.state.calls.map(c => c.action), ['status', 'status', 'netPreview']); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    await f.page.evaluate(() => window.__setAuth(null)); assert.equal(await f.page.locator('tbody tr').count(), 0);
    assert.equal(await f.page.getByText('Aktif', { exact: true }).count(), 0); assert.equal(await f.page.getByLabel('Booking untuk pratinjau Accurate').inputValue(), '');
  } finally { await f.context.close(); }
});
test('late net results after account switch or logout are discarded and reads are guarded against duplicate clicks', async () => {
  for (const nextUser of ['manager2', null]) {
    const f = await fixture(); let release; try {
      await ready(f.page); f.state.delay = new Promise(r => release = r);
      await f.page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX01');
      await f.page.getByRole('button', { name: 'Pratinjau Biaya & Neto Xendit' }).evaluate(button => { button.click(); button.click(); });
      await f.page.getByText('Memeriksa data…', { exact: true }).waitFor();
      await f.page.evaluate(uid => window.__setAuth(uid), nextUser); release(); if (nextUser) await ready(f.page);
      assert.equal(await f.page.getByLabel('Booking untuk pratinjau Accurate').inputValue(), '');
      assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
      assert.ok(f.state.calls.filter(c => c.action === 'netPreview').length <= 1); assert.equal(f.state.calls.some(c => ['activate', 'retry', 'run'].includes(c.action)), false);
      assert.deepEqual(await f.page.evaluate(() => window.__events), []); assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.context.close(); }
  }
});
test('an unverified state diagnostic replaces old net values, compares all three fields, and preserves the active accounting status without Meta events', async () => {
  const f = await fixture(); try {
    await ready(f.page); Object.assign(f.state.status, { enabled: true, activatedAt: '2026-10-22T05:21:20Z', taxPolicy: 'no_extra_tax' });
    await f.page.getByRole('button', { name: 'Muat Ulang Status Pencatatan' }).click(); await f.page.getByText('Aktif', { exact: true }).waitFor();
    await netPreview(f.page); await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).waitFor();
    f.state.net = structuredClone(stateDiagnosticFixture); await f.page.getByRole('button', { name: 'Pratinjau Biaya & Neto Xendit' }).click();
    const result = f.page.getByRole('alert', { name: 'Pemeriksaan status API Xendit' }); await result.waitFor();
    const text = await result.innerText(); for (const value of [/type/, /PAYMENT/, /status/, /SUCCESS/, /cashflow/, /Tidak disediakan/, /MONEY_IN/, /Neto belum terverifikasi/]) assert.match(text, value);
    assert.equal(await result.getByRole('row').count(), 4); assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
    assert.equal(text.includes('150.010'), false); assert.equal(await f.page.getByText('Aktif', { exact: true }).count(), 1);
    assert.equal(await f.page.getByRole('heading', { name: 'Aktivasi pencatatan booking baru' }).count(), 0);
    assert.equal(f.state.calls.some(c => ['activate', 'retry', 'run'].includes(c.action)), false); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    await f.page.getByLabel('Booking untuk pratinjau Accurate').fill('SH-261022-FIX02'); assert.equal(await result.count(), 0);
  } finally { await f.context.close(); }
});
test('a SUCCESSFUL money-out diagnostic lists both accepted success spellings while withholding net and Meta events', async () => {
  const f = await fixture(); try {
    await ready(f.page); f.state.net = structuredClone(stateDiagnosticFixture);
    f.state.net.checks.status = { kind: 'known', value: 'SUCCESSFUL' };
    f.state.net.checks.cashflow = { kind: 'known', value: 'MONEY_OUT' };
    await netPreview(f.page); const result = f.page.getByRole('alert', { name: 'Pemeriksaan status API Xendit' }); await result.waitFor();
    const text = await result.innerText(); assert.match(text, /SUCCESS \/ SUCCESSFUL/); assert.match(text, /MONEY_OUT/);
    assert.match(text, /Neto belum terverifikasi/); assert.equal(text.includes('150.010'), false);
    assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
    assert.deepEqual(f.state.calls.map(c => c.action), ['status', 'netPreview']); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
  } finally { await f.context.close(); }
});
test('forged diagnostic values, identifiers, verification or financial fields cannot be rendered', async () => {
  for (const change of [v => v.verified = true, v => v.readOnly = false, v => v.bookingCode = 'SH-261022-OTHER',
    v => v.checks.status.value = 'private_fixture_secret', v => v.checks.cashflow.kind = 'known', v => v.netAmount = 150010,
    v => v.checks.cashflow = { kind: 'known', value: 'MONEY_IN' },
    v => { v.checks.status.value = 'SUCCESSFUL'; v.checks.cashflow = { kind: 'known', value: 'MONEY_IN' }; }]) {
    const f = await fixture(); try {
      await ready(f.page); f.state.net = structuredClone(stateDiagnosticFixture); change(f.state.net); await netPreview(f.page);
      await f.page.getByRole('alert').waitFor(); assert.equal(await f.page.getByRole('alert', { name: 'Pemeriksaan status API Xendit' }).count(), 0);
      assert.equal((await f.page.locator('body').innerText()).includes('private_fixture_secret'), false);
      assert.equal(await f.page.getByRole('status', { name: 'Hasil biaya dan neto Xendit' }).count(), 0);
    } finally { await f.context.close(); }
  }
});
test('late diagnostics cannot survive account switch or logout', async () => {
  for (const nextUser of ['manager2', null]) {
    const f = await fixture(); let release; try {
      await ready(f.page); f.state.net = structuredClone(stateDiagnosticFixture); f.state.delay = new Promise(r => release = r);
      await netPreview(f.page); await f.page.getByText('Memeriksa data…', { exact: true }).waitFor();
      await f.page.evaluate(uid => window.__setAuth(uid), nextUser); release(); if (nextUser) await ready(f.page);
      assert.equal(await f.page.getByRole('alert', { name: 'Pemeriksaan status API Xendit' }).count(), 0);
      assert.equal(await f.page.getByLabel('Booking untuk pratinjau Accurate').inputValue(), ''); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    } finally { release?.(); await f.context.close(); }
  }
});
