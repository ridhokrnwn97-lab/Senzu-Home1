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
    processingCard: `export const AccurateProcessingFeeCard=()=>null;`,
    firebase: `const listeners=new Set();const makeUser=uid=>uid?{uid,getIdToken:async()=> 'fixture_'+uid}:null;
      export const auth={currentUser:makeUser('manager1')};
      export function subscribe(fn){listeners.add(fn);queueMicrotask(()=>{if(listeners.has(fn))fn(auth.currentUser);});return()=>listeners.delete(fn);}
      window.__setAuth=uid=>{auth.currentUser=makeUser(uid);for(const fn of listeners)fn(auth.currentUser);};`,
    auth: `import{subscribe}from'fixture:firebase';export const onAuthStateChanged=(_,fn)=>subscribe(fn);`,
  };
  await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{AccurateProcessingFeeCard}from'./src/components/admin/AccurateProcessingFeeCard';
    createRoot(document.getElementById('root')).render(<AccurateProcessingFeeCard currentUser={{uid:'manager1',role:new URLSearchParams(location.search).get('role')||'manager'}}/>);`,
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

const blank={enabled:false,fromDate:null,activatedAt:null,lastScanAt:null,lastScanFromDate:null,lastScanToDate:null,issue:'',jobs:[]};
const charge={transactionId:'11111111-1111-4111-8111-111111111111',referenceId:'33333333-3333-4333-8333-333333333333',
productId:'33333333-3333-4333-8333-333333333333',businessId:'offline_fixture_business',type:'PROCESSING_FEE_DEDUCTION',amount:8000,date:'2026-10-23',createdAt:'2026-10-22T17:46:00Z'};
const sample={fromDate:'2026-10-23',toDate:'2026-10-23',checkedAt:'2026-10-23T03:00:00Z',complete:true,charges:[charge],feeAmount:8000,vatAmount:0,totalAmount:8000,otherOutflowCount:0};
async function fixture(query=''){
 const context=await browser.newContext({viewport:{width:390,height:844}}), state={calls:[],status:structuredClone(blank),preview:structuredClone(sample),error:false,delay:null};
 await context.route('**/api/integrations/accurate/sync/*',async route=>{
 const action=new URL(route.request().url()).pathname.split('/').at(-1),payload=route.request().postDataJSON();state.calls.push({action,payload});
 if(state.delay&&action==='processingPreview')await state.delay;
 if(state.error)return route.fulfill({status:502,json:{success:false,code:'PROCESSING_READ_UNAVAILABLE',error:'private upstream secret body'}}).catch(()=>{});
 if(action==='activateProcessing')state.status={...blank,enabled:true,fromDate:payload.fromDate,activatedAt:'2026-10-23T03:00:00Z'};
 if(action==='pauseProcessing')state.status.enabled=false;
 await route.fulfill({json:action==='processingPreview'?{success:true,preview:state.preview}:{success:true,processing:state.status}}).catch(()=>{});
 });
 const page=await context.newPage();page.setDefaultTimeout(7000);await page.goto(origin+'/'+query);
 return {context,page,state};
}
async function ready(f){await f.page.getByRole('button',{name:'Muat Ulang Processing Fee',exact:true}).waitFor();await f.page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='Muat Ulang Processing Fee')?.disabled);}
async function preview(f){await f.page.getByLabel('Tanggal awal processing fee',{exact:true}).fill('2026-10-23');await f.page.getByLabel('Tanggal akhir processing fee',{exact:true}).fill('2026-10-23');await f.page.getByRole('button',{name:'Pratinjau Potongan Harian',exact:true}).click();await f.page.getByRole('table',{name:'Potongan aktual dari Xendit'}).waitFor();}
test('mount and preview only read; no Meta conversion',async()=>{const f=await fixture();try{await ready(f);assert.deepEqual(f.state.calls.map(c=>c.action),['processingStatus']);await preview(f);assert.deepEqual(f.state.calls.map(c=>c.action),['processingStatus','processingPreview']);assert.deepEqual(await f.page.evaluate(()=>window.__events),[]);assert.equal(await f.page.getByRole('button',{name:'Aktifkan Processing Fee Otomatis',exact:true}).isDisabled(),true);}finally{await f.context.close();}});
test('activation needs preview, matching dashboard ID and consent; pause is separate',async()=>{const f=await fixture();try{await ready(f);await preview(f);const button=f.page.getByRole('button',{name:'Aktifkan Processing Fee Otomatis',exact:true});await f.page.getByRole('checkbox').check();assert.equal(await button.isDisabled(),true);await f.page.getByLabel('ID contoh potongan Xendit').fill('wrong');await f.page.getByRole('checkbox').check();assert.equal(await button.isDisabled(),true);await f.page.getByLabel('ID contoh potongan Xendit').fill(charge.transactionId);await f.page.getByRole('checkbox').check();await button.click();await f.page.getByText('Aktif',{exact:true}).waitFor();assert.equal(f.state.calls.at(-1).action,'activateProcessing');assert.equal(f.state.calls.at(-1).payload.expectedTransactionIds[0],charge.transactionId);await f.page.getByRole('button',{name:'Jeda Processing Fee',exact:true}).click();await f.page.getByText('Belum aktif / dijeda',{exact:true}).waitFor();assert.equal(f.state.calls.at(-1).action,'pauseProcessing');}finally{await f.context.close();}});
test('changing range invalidates evidence and acknowledgement',async()=>{const f=await fixture();try{await ready(f);await preview(f);await f.page.getByLabel('ID contoh potongan Xendit').fill(charge.transactionId);await f.page.getByRole('checkbox').check();await f.page.getByLabel('Tanggal awal processing fee',{exact:true}).fill('2026-10-22');assert.equal(await f.page.getByRole('checkbox').isChecked(),false);assert.equal(await f.page.getByRole('table').count(),0);assert.equal(await f.page.getByRole('button',{name:'Aktifkan Processing Fee Otomatis',exact:true}).isDisabled(),true);}finally{await f.context.close();}});
test('late preview cannot repopulate after account switch',async()=>{const f=await fixture();let done;try{await ready(f);f.state.delay=new Promise(r=>done=r);await f.page.getByLabel('Tanggal awal processing fee',{exact:true}).fill('2026-10-23');await f.page.getByLabel('Tanggal akhir processing fee',{exact:true}).fill('2026-10-23');await f.page.getByRole('button',{name:'Pratinjau Potongan Harian',exact:true}).click();await f.page.evaluate(()=>window.__setAuth(null));done();await f.page.waitForTimeout(100);assert.equal(await f.page.getByRole('table').count(),0);assert.equal(await f.page.getByRole('button',{name:'Aktifkan Processing Fee Otomatis',exact:true}).isDisabled(),true);}finally{done?.();await f.context.close();}});
test('upstream errors and malformed totals cannot show usable financial evidence',async()=>{const f=await fixture();try{await ready(f);f.state.preview.totalAmount=9999;await f.page.getByLabel('Tanggal awal processing fee',{exact:true}).fill('2026-10-23');await f.page.getByLabel('Tanggal akhir processing fee',{exact:true}).fill('2026-10-23');await f.page.getByRole('button',{name:'Pratinjau Potongan Harian',exact:true}).click();await f.page.getByRole('alert').waitFor();assert.equal(await f.page.getByRole('table').count(),0);f.state.error=true;await f.page.getByRole('button',{name:'Pratinjau Potongan Harian',exact:true}).click();await f.page.getByText(/PROCESSING_READ_UNAVAILABLE/).waitFor();assert.equal((await f.page.locator('body').innerText()).includes('private upstream'),false);}finally{await f.context.close();}});
test('other staff roles request no private data',async()=>{for(const role of ['css','therapist','supervisor']){const f=await fixture('?role='+role);try{await f.page.waitForLoadState('networkidle');assert.deepEqual(f.state.calls,[]);assert.equal(await f.page.locator('section').count(),0);}finally{await f.context.close();}}});
test('uncertain journal button only invokes lookup reconciliation',async()=>{const f=await fixture();try{f.state.status={...blank,enabled:true,fromDate:'2026-10-23',activatedAt:'2026-10-23T03:00:00Z',jobs:[{id:'a'.repeat(64),transactionId:charge.transactionId,type:charge.type,date:charge.date,amount:charge.amount,number:'SHPF-'+ 'a'.repeat(24),state:'review',issue:'PROCESSING_DOCUMENT_UNCERTAIN'}]};await ready(f);await f.page.getByRole('button',{name:'Muat Ulang Processing Fee',exact:true}).click();await f.page.getByRole('button',{name:'Cocokkan Jurnal Tersimpan',exact:true}).click();await f.page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='Cocokkan Jurnal Tersimpan')?.disabled);assert.equal(f.state.calls.at(-1).action,'reconcileProcessing');assert.equal(f.state.calls.some(c=>c.action==='runProcessing'),false);}finally{await f.context.close();}});
