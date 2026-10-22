// Local component fixtures: no credentials, Firebase or Accurate requests.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import express from 'express';
import { ACCURATE_MASTERS, ACCURATE_APP_NAME, ACCURATE_COMPANY } from '../src/lib/accurateContracts.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const playwright = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
let server, browser, origin, temp;
const configuration = { success: true, configured: true, apiTokenPresent: true, signatureSecretPresent: true,
  databaseIdPinned: false, mode: 'connection_only', writesEnabled: false };
const result = { success: true, connected: true, companyName: ACCURATE_COMPANY, applicationName: ACCURATE_APP_NAME,
  databaseId: 96400, databaseIdPinned: false, access: 'administrator', checkedAt: '2026-10-22T08:00:00Z',
  mode: 'connection_only', writesEnabled: false, mastersMatch: true,
  checks: ACCURATE_MASTERS.map(r => ({ code: r.code, kind: r.kind, name: r.name, status: 'match', note: 'Data cocok.' })) };
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'senzu-accurate-ui-'));
  const mocks = {
    firebase: `const listeners=new Set();const makeUser=uid=>uid?{uid,getIdToken:async()=> 'fixture_'+uid}:null;
      export const auth={currentUser:makeUser('manager1')};
      export function subscribe(fn){listeners.add(fn);queueMicrotask(()=>{if(listeners.has(fn))fn(auth.currentUser);});return()=>listeners.delete(fn);}
      window.__setAuth=uid=>{auth.currentUser=makeUser(uid);for(const fn of listeners)fn(auth.currentUser);};`,
    auth: `import{subscribe}from'fixture:firebase';export const onAuthStateChanged=(_,fn)=>subscribe(fn);`,
  };
  await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';
    import{AccurateConnectionCard}from'./src/components/admin/AccurateConnectionCard';
    createRoot(document.getElementById('root')).render(<AccurateConnectionCard currentUser={{uid:'manager1',role:new URLSearchParams(location.search).get('role')||'manager'}}/>);`,
    resolveDir: root, loader: 'tsx' }, bundle: true, format: 'esm', outfile: path.join(temp, 'bundle.js'),
    plugins: [{ name: 'firebase-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = args.path.startsWith('fixture:') ? args.path.slice(8) : args.path === 'firebase/auth' ? 'auth' : /(^|\/)firebase$/.test(args.path) ? 'firebase' : null;
        if (key) return { path: key, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
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
  const state = { calls: [], checkResult: structuredClone(result), configured: true, html: false, delay: null };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    assert.match(url.pathname, /^\/api\/integrations\/accurate\/(configuration|check)$/);
    assert.deepEqual(request.postDataJSON(), {}); assert.equal(request.method(), 'POST');
    assert.match(request.headers().authorization, /^Bearer fixture_/);
    const action = url.pathname.split('/').at(-1); state.calls.push({ action, auth: request.headers().authorization });
    if (action === 'configuration') { await route.fulfill({ json: { ...configuration, configured: state.configured } }); return; }
    const response = structuredClone(state.checkResult);
    if (state.delay) await state.delay;
    if (state.html) await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>private provider response</html>' }).catch(() => {});
    else await route.fulfill({ json: response }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/' + query); return { page, context, state, errors };
}
test('Manager mount reads configuration only; explicit check shows eight masters and never fires Meta', async () => {
  const { page, context, state, errors } = await fixture();
  try {
    const check = page.getByRole('button', { name: 'Periksa Koneksi dan Master', exact: true }); await check.waitFor();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Periksa Koneksi dan Master')?.disabled);
    assert.deepEqual(state.calls.map(c => c.action), ['configuration']); assert.equal(await page.locator('input,textarea').count(), 0);
    await check.click(); await page.getByText('Koneksi berhasil. Seluruh master yang diperiksa cocok.', { exact: true }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 8); assert.equal(state.calls.filter(c => c.action === 'check').length, 1);
    await page.getByText('Panel ini hanya memeriksa koneksi.', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__events), []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('missing configuration disables the check and non-manager roles make no API requests', async () => {
  const f = await fixture(); try {
    f.state.configured = false; await f.page.getByRole('button', { name: 'Muat Ulang Konfigurasi Accurate' }).click();
    await f.page.getByText('perlu dilengkapi', { exact: true }).waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).isDisabled(), true);
    assert.equal(f.state.calls.some(c => c.action === 'check'), false);
  } finally { await f.context.close(); }
  for (const role of ['supervisor', 'css', 'therapist', 'customer']) {
    const g = await fixture('?role=' + role); try {
      await g.page.waitForLoadState('networkidle'); assert.equal(await g.page.locator('section').count(), 0); assert.deepEqual(g.state.calls, []);
    } finally { await g.context.close(); }
  }
});
test('master mismatch, invalid identity, writable mode and HTML errors cannot show successful verification', async () => {
  for (const mutate of [v => { v.mastersMatch = false; v.checks[0].status = 'mismatch'; v.checks[0].note = 'Jenis akun tidak cocok.'; },
    v => v.companyName = 'OTHER COMPANY', v => v.writesEnabled = true, v => v.databaseId = -1]) {
    const f = await fixture(); try {
      mutate(f.state.checkResult); await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).click();
      if (!f.state.checkResult.mastersMatch) await f.page.getByText('Koneksi berhasil. Ada master yang perlu diperiksa.', { exact: true }).waitFor();
      else await f.page.getByRole('alert').waitFor();
      assert.equal(await f.page.getByText('Koneksi berhasil. Seluruh master yang diperiksa cocok.', { exact: true }).count(), 0);
      assert.deepEqual(await f.page.evaluate(() => window.__events), []);
    } finally { await f.context.close(); }
  }
  const f = await fixture(); try {
    f.state.html = true; await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).click(); await f.page.getByRole('alert').waitFor();
    assert.equal((await f.page.locator('body').innerText()).includes('private provider response'), false);
  } finally { await f.context.close(); }
});
test('account switch or logout clears results and ignores a late check response', async () => {
  const f = await fixture(); let release;
  try {
    await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).click(); await f.page.locator('tbody tr').first().waitFor();
    f.state.delay = new Promise(r => release = r);
    await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).click();
    await f.page.evaluate(() => window.__setAuth('manager2')); release();
    await f.page.getByText('siap diperiksa', { exact: true }).waitFor();
    assert.equal(await f.page.locator('tbody tr').count(), 0); assert.equal((await f.page.locator('body').innerText()).includes('96400'), false);
    await f.page.evaluate(() => window.__setAuth(null)); assert.equal(await f.page.locator('tbody tr').count(), 0);
    assert.equal(await f.page.getByRole('button', { name: 'Periksa Koneksi dan Master' }).isDisabled(), true);
    assert.deepEqual(f.errors, []); assert.deepEqual(await f.page.evaluate(() => window.__events), []);
  } finally { release?.(); await f.context.close(); }
});
