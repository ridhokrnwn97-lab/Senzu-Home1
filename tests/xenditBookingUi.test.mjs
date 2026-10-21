// Local browser integration test: real BookingForm, XenditSandboxCard and client
// request code; Firebase, customer writes, Meta delivery and Xendit are fixtures.
// Never imports server startup or contacts a real account/payment service.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import express from 'express';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwright = await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href : 'playwright');
let browser, server, origin, temporary;
const mock = {
  firebase: `export const auth = { currentUser: { uid: 'manager1', getIdToken: async () => 'fixture_token' } };`,
  authSdk: `import { auth } from 'fixture:firebase'; export function onAuthStateChanged(_, callback) {
    let active = true; queueMicrotask(() => { if(active) callback(auth.currentUser); }); return () => {active=false;}; }`,
  staff: `export function useAuth() { return { currentUser: window.__fixture.role === 'customer' ? null :
    { uid:'manager1', role:window.__fixture.role, name:'Fixture Manager', email:'fixture@example.invalid' } }; }`,
  customer: `import { auth } from 'fixture:firebase';
    const customer = { id:'fixture_customer',authUserId:'manager1',name:'Fixture Customer',phone:'081234567890',gender:'Laki-laki' };
    export function useCustomerAuth() {return {currentCustomer:customer,firebaseUser:auth.currentUser,updateCustomerProfile:async()=>{}};}`,
  db: `export { calculateHomeServiceFee } from ${JSON.stringify(path.join(root, 'src/lib/distanceFeeService.ts'))};
    export async function createBooking(data) { window.__fixture.bookings++; return { ...data,id:'booking_fixture',bookingCode:'BOOK-FIXTURE',
    status:'Menunggu Pembayaran',paymentStatus:'UNPAID',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() }; }`,
  loyalty: `export async function getLoyaltySettings(){return null;} export async function getMembershipTiers(){return [];}
    export async function getLoyaltyAccountByCustomerId(){return null;} export async function getCustomerVouchers(){return [];}
    export async function validateReferralCode(){return {valid:false};} export async function getVoucherByCode(){return null;}
    export async function validatePromoCodeForBooking(){return {valid:false};}`,
  master: `export async function getServiceAreas(){return [];}`,
  crm: `export async function getCustomerSavedAddresses(){return [];}`,
  meta: `export async function trackMetaAdsAction(action, context){window.__fixture.meta.push({action,context});}`,
  payment: `import React from 'react'; export function CustomerPaymentPage(){return <div>Manual payment fixture opened</div>;}`,
  map: `import React,{useEffect} from 'react'; export function AddressAutocompleteMap(p){useEffect(()=>{
    p.setAddress('Fixture address');p.setDistanceKm(12);p.setDistanceMeters(12000);
  },[]);return <input aria-label="Fixture address" value={p.address} onChange={e=>p.setAddress(e.target.value)}/>;}`,
};
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'senzu-xendit-ui-'));
  await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {BookingForm} from './src/components/BookingForm';
    const services=[{id:'srv-test',name:'Signature fixture',price:250000,duration:90,isActive:true,description:'Fixture service'}];
    createRoot(document.getElementById('root')).render(<BookingForm services={services} settings={{}}
      onBookingSuccess={()=>{window.__fixture.successCallbacks++;}}/>);`, resolveDir: root, loader: 'tsx' },
    bundle: true, outfile: path.join(temporary, 'bundle.js'), format: 'esm', plugins: [{ name: 'fixtures', setup(builder) {
      builder.onResolve({filter:/.*/}, args => {
        let name;
        if(args.path.startsWith('fixture:')) name=args.path.slice(8);
        else if(args.path==='firebase/auth') name='authSdk';
        else if(/(^|\/)firebase$/.test(args.path)) name='firebase';
        else if(args.path.endsWith('/AuthContext')) name='staff';
        else if(args.path.endsWith('/CustomerAuthContext')) name='customer';
        else for(const [suffix,key] of [['dbService','db'],['loyaltyService','loyalty'],['masterDataService','master'],
          ['crmService','crm'],['metaPixel','meta'],['CustomerPaymentPage','payment'],['AddressAutocompleteMap','map']]) {
          if(args.path.endsWith('/'+suffix)) name=key;
        }
        if(name) return {path:name,namespace:'fixture'};
      });
      builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:mock[args.path],loader:'tsx',resolveDir:root}));
    }}] });
  const app=express(); app.get('/bundle.js',(_,res)=>res.sendFile(path.join(temporary,'bundle.js')));
  app.get('/app.css',async (_,res)=>{
    try {const files=await fs.readdir(path.join(root,'dist/assets'));res.sendFile(path.join(root,'dist/assets',files.find(f=>f.endsWith('.css'))));}
    catch {res.type('css').send('');}
  });
  app.get('/',(_,res)=>res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
    <body style="background:#f8fafc;padding:16px"><div id="root"></div><script>window.__fixture={role:new URLSearchParams(location.search).get('role')||'manager',bookings:0,meta:[],successCallbacks:0};</script><script type="module" src="/bundle.js"></script></body></html>`));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,
    ...(process.env.XENDIT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.XENDIT_CHROMIUM_EXECUTABLE} : {}),
    args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(temporary)await fs.rm(temporary,{recursive:true,force:true});});

async function pageFixture(role='manager', failure=false) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const state={session:null,calls:[]};
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){await route.abort();return;}
    if(!url.pathname.startsWith('/api/')){await route.continue();return;}
    const action=url.pathname.split('/').pop();const body=route.request().postDataJSON();state.calls.push({action,body});
    let response;
    if(action==='status')response={configured:true,environment:'test',amount:10000,currency:'IDR',webhookPath:'/api/integrations/xendit/test/webhook',realBookingAffected:false,message:''};
    else if(action==='latest')response={session:state.session};
    else if(action==='checkout'){
      const q=body.bookingPreview;
      state.session={referenceId:'szt_'+'a'.repeat(48),sessionId:failure?null:'ps-'+'1'.repeat(24),checkoutUrl:failure?null:'https://checkout-staging.xendit.co/fixture',
        sessionStatus:failure?null:'ACTIVE',creationState:failure?'uncertain':'created',amount:q.expectedAmount,currency:'IDR',environment:'test',
        expiresAt:'2099-10-21T02:30:00Z',lastWebhookAt:null,lastCheckedAt:null,realBookingAffected:false,reviewCloseAllowed:false,
        bookingPreview:{source:'internal_booking_simulation',serviceId:q.serviceId,serviceName:'Signature fixture',servicePrice:250000,
          distanceKm:q.distanceKm,homeServiceFee:30000,discountAmount:q.discountAmount,totalAmount:q.expectedAmount}};
      if(failure){await route.fulfill({status:502,json:{success:false,message:'Fixture uncertain outcome'}});return;}
      await new Promise(resolve=>setTimeout(resolve,100));response={session:state.session};
    }else {await route.fulfill({status:500,json:{success:false,message:'Unexpected fixture route'}});return;}
    await route.fulfill({json:{success:true,...response}});
  });
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?role='+role);await page.locator('#btn-submit-booking').waitFor();
  return {context,page,state,errors};
}
test('real booking form Test selection blocks booking/Meta, creates once, and reload reads webhook-updated fixture without status API', async()=>{
  const {context,page,state,errors}=await pageFixture();
  try {
    await page.locator('#payment-xendit-test').click();
    const create=page.getByRole('button',{name:'Buat Checkout Test sesuai Ringkasan',exact:true});await create.waitFor();
    await page.waitForFunction(()=>!document.querySelector('section button:last-child')?.disabled);
    assert.equal(await page.locator('#btn-submit-booking').isDisabled(),true);
    await page.locator('#booking-form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.length,window.__fixture.successCallbacks]),[0,0,0]);
    await create.click();await page.getByText('Menunggu simulasi pembayaran',{exact:true}).waitFor();
    assert.deepEqual(state.calls.filter(c=>c.action==='checkout').map(c=>c.body.bookingPreview),[
      {serviceId:'srv-test',distanceKm:12,discountAmount:0,expectedAmount:280000}]);
    state.session.sessionStatus='COMPLETED';state.session.lastWebhookAt=new Date().toISOString();
    await page.reload();await page.getByText('Sesi Test selesai',{exact:true}).waitFor();
    assert.equal(state.calls.filter(c=>c.action==='checkout').length,1);
    assert.equal(state.calls.filter(c=>c.action==='read').length,0);
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.length,window.__fixture.successCallbacks]),[0,0,0]);
    if(process.env.XENDIT_UI_SCREENSHOTS){await fs.mkdir(process.env.XENDIT_UI_SCREENSHOTS,{recursive:true});
      const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Xendit — Uji Checkout Booking',exact:true})});
      await panel.screenshot({path:path.join(process.env.XENDIT_UI_SCREENSHOTS,'desktop.png')});
      await page.setViewportSize({width:390,height:844});await panel.screenshot({path:path.join(process.env.XENDIT_UI_SCREENSHOTS,'mobile.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
test('ordinary customer keeps manual checkout and its existing Meta booking event; no Test option or API request', async()=>{
  const {context,page,state,errors}=await pageFixture('customer');
  try {
    assert.equal(await page.locator('#payment-xendit-test').count(),0);
    await page.locator('#btn-submit-booking').click();await page.getByText('Manual payment fixture opened',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.map(e=>e.action),window.__fixture.successCallbacks]),[1,['booking_submitted'],1]);
    assert.equal(state.calls.length,0);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
test('Manager can switch from Test back to manual; only the explicit real form submission invokes the existing booking/Meta flow', async()=>{
  const {context,page,state,errors}=await pageFixture();
  try {
    await page.locator('#payment-xendit-test').click();
    await page.getByRole('heading',{name:'Xendit — Uji Checkout Booking',exact:true}).waitFor();
    assert.equal(await page.locator('#btn-submit-booking').isDisabled(),true);
    await page.getByText('Transfer BNI',{exact:true}).click();
    assert.equal(await page.locator('#btn-submit-booking').isEnabled(),true);
    assert.equal(await page.getByRole('heading',{name:'Xendit — Uji Checkout Booking',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('senzu:xendit-booking-test:manager1')),null);
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.length]),[0,0]);
    await page.locator('#btn-submit-booking').click();await page.getByText('Manual payment fixture opened',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.map(e=>e.action)]),[1,['booking_submitted']]);
    assert.equal(state.calls.filter(c=>c.action==='checkout').length,0);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
test('uncertain creation survives reload without a duplicate checkout and keeps recovery controls', async()=>{
  const {context,page,state,errors}=await pageFixture('admin',true);
  try {
    await page.locator('#payment-xendit-test').click();
    await page.getByRole('button',{name:'Buat Checkout Test sesuai Ringkasan',exact:true}).click();
    await page.getByText('Hasil pembuatan belum pasti',{exact:true}).waitFor();
    await page.reload();await page.getByText('Hasil pembuatan belum pasti',{exact:true}).waitFor();
    assert.equal(state.calls.filter(c=>c.action==='checkout').length,1);
    await page.getByRole('button',{name:'Cocokkan Sesi Xendit',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.bookings,window.__fixture.meta.length]),[0,0]);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
