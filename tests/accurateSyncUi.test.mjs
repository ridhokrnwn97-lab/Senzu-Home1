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
  const state = { calls: [], status: structuredClone(initial), preview: structuredClone(previewFixture), delay: null, html: false };
  await context.route('**/api/integrations/accurate/sync/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1), payload = route.request().postDataJSON();
    state.calls.push({ action, payload, authorization: route.request().headers().authorization });
    const result = structuredClone(action === 'preview' ? state.preview : state.status);
    if (action === 'activate') { result.enabled = true; result.activatedAt = '2026-10-22T04:00:00Z'; result.taxPolicy = 'no_extra_tax'; state.status = structuredClone(result); }
    if (action === 'pause') { result.enabled = false; state.status = structuredClone(result); }
    if (state.delay && action === 'preview') await state.delay;
    if (state.html) await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>private provider error</html>' }).catch(() => {});
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
