// Real Manager settings, manual customer page, paid client and Pixel routing.
// External SDK/Firebase/payment data are isolated local fixtures; no live events.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import express from 'express';
const root=process.cwd();
const playwright=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
let server,browser,origin,temp;
const mocks={
  firebase:`export const auth={currentUser:{uid:'alice',getIdToken:async()=>'fixture_token'}};`,
  settings:`import{validateMetaAdsSettings}from ${JSON.stringify(path.join(root,'src/lib/metaAdsSettings.ts'))};
    export async function getMetaAdsSettings(){return validateMetaAdsSettings(window.__fixture.settings);}
    export async function saveMetaAdsSettings(value){const next=validateMetaAdsSettings(value);window.__fixture.saved=next;
      window.__fixture.settings=next;return next;}`,
  staff:`export function useAuth(){return{currentUser:window.__fixture.staff?{uid:'alice',role:'manager'}:null};}`,
  customer:`export function useCustomerAuth(){return{currentCustomer:{name:'Fixture Customer'},isCustomerAuthenticated:true};}`,
  support:`export function useCustomerServiceWhatsApp(){return{isAvailable:false,getWhatsAppUrl:()=>null,unavailableNotice:'Fixture'};}`,
  dialogs:`export function CustomerRegisterModal(){return null;}export function CustomerLoginModal(){return null;}export function XenditLivePaymentPage(){return null;}`,
  payments:`import{DEFAULT_PAYMENT_SETTINGS}from ${JSON.stringify(path.join(root,'src/lib/paymentDefaults.ts'))};
    export async function getPaymentSettings(){return DEFAULT_PAYMENT_SETTINGS;}
    export async function createOrGetPaymentForBooking(){return window.__fixture.payment;}
    export function subscribeToPaymentByBookingId(_,callback){window.__emitPayment=p=>{window.__fixture.payment=p;callback(p)};return()=>{};}
    export async function uploadPaymentProof(){throw new Error('No real uploads in fixtures');}
    export async function expirePaymentIfEligible(){return{expired:false};}
    export function getPaymentStatusLabel(s){return s==='paid'?'Pembayaran Terverifikasi':s;}
    export function getPaymentStatusBadgeStyle(){return{bg:'',text:'',border:'',label:'Fixture'};}
    export function isPaymentPaid(s){return String(s).toLowerCase()==='paid';}`,
};
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'senzu-meta-manual-ui-'));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{MetaAdsSettingsCard}from'./src/components/admin/MetaAdsSettingsCard';
    import{CustomerPaymentPage}from'./src/components/CustomerPaymentPage';
    function App(){const[open,setOpen]=useState(true);return new URLSearchParams(location.search).has('settings')
      ?<MetaAdsSettingsCard currentUser={{uid:'alice',role:new URLSearchParams(location.search).get('role')||'manager'}}/>
      :open?<><button onClick={()=>setOpen(false)}>Tutup halaman lokal</button><CustomerPaymentPage booking={window.__fixture.booking}/></>:<p>Halaman ditutup</p>;}
    createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:root},bundle:true,format:'esm',outfile:path.join(temp,'bundle.js'),
    plugins:[{name:'local-fixtures',setup(b){
      b.onResolve({filter:/.*/},a=>{
        const key=/(^|\/)firebase$/.test(a.path)?'firebase':/(^|\/)metaAdsService$/.test(a.path)?'settings'
          :/(^|\/)paymentService$/.test(a.path)?'payments':/(^|\/)AuthContext$/.test(a.path)?'staff'
          :/(^|\/)CustomerAuthContext$/.test(a.path)?'customer':/(^|\/)supportWhatsApp$/.test(a.path)?'support'
          :/(^|\/)(CustomerRegisterModal|CustomerLoginModal|XenditLivePaymentPage)$/.test(a.path)?'dialogs':null;
        if(key)return{path:key,namespace:'fixture'};
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:root,loader:'js'}));
    }}]});
  const app=express();app.get('/bundle.js',(_,r)=>r.sendFile(path.join(temp,'bundle.js')));
  app.get('/',(_,r)=>r.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script>'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,executablePath:process.env.XENDIT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));if(temp)await fs.rm(temp,{force:true,recursive:true});});
async function fixture({query='',paid=false,staff=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844}}),requests=[];
  await context.addInitScript(({paid,staff})=>{
    const booking={id:'booking_fixture',bookingCode:'SH-FIXTURE',customerName:'Fixture',customerAuthUid:'alice',authUserId:'alice',
      serviceName:'Deep Sleep Relaxations',serviceDuration:90,servicePrice:200000,homeServiceFee:0,totalAmount:200000,
      paymentMethod:'Transfer BNI',paymentStatus:'UNPAID',status:'Menunggu Pembayaran',date:'2026-11-05',time:'13:30',createdAt:'2026-11-05T01:00:00Z'};
    const payment={id:'PAY-booking_fixture',bookingId:booking.id,paymentType:'manual',status:paid?'paid':'unpaid',amount:200000,
      bankCode:'BNI',provider:'manual_senzu',currency:'IDR',createdAt:booking.createdAt};
    window.__fixture={booking,payment,staff,meta:[],lookups:0,settings:{schemaVersion:1,revision:1,enabled:true,
      pixels:[{id:'pixel',name:'Fixture Pixel',pixelId:'123456789012',enabled:true}],events:[
        {id:'lead',trigger:'payment_verified',kind:'standard',eventName:'Lead',pixelIds:'all',enabled:true}]}};
    const fbq=(...a)=>window.__fixture.meta.push(a);fbq.callMethod=fbq;window.fbq=fbq;
  },{paid,staff});
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!==origin){await route.abort();return;}
    if(u.pathname!=='/api/payments/lookup'){await route.continue();return;}
    requests.push(route.request().postDataJSON());
    assert.equal(route.request().headers().authorization,'Bearer fixture_token');
    const data=await route.request().frame().evaluate(()=>window.__fixture.payment);
    await route.fulfill({json:{success:true,payment:data,manualPaidLead:data.status==='paid'&&!staff?{
      schemaVersion:1,source:'staff_verified_manual',bookingId:'booking_fixture',paymentId:data.id,
      amount:data.amount,currency:'IDR',verifiedAt:'2026-11-05T02:00:00Z'}:null}});
    await route.request().frame().evaluate(()=>window.__fixture.lookups++).catch(()=>{});
  });
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/'+query);
  return{page,context,requests,errors};
}
test('Manager can select and save manual or both verified sources for Lead; early actions are unavailable',async()=>{
  const{page,context,errors}=await fixture({query:'?settings'});
  try{
    const trigger=page.getByRole('combobox',{name:/^Pemicu/});await trigger.waitFor();
    assert.equal(await trigger.isEnabled(),true);
    assert.deepEqual(await trigger.locator('option').evaluateAll(el=>el.map(x=>x.value)),['payment_verified','manual_payment_verified','xendit_live_paid']);
    for(const value of ['manual_payment_verified','payment_verified','xendit_live_paid']){
      await trigger.selectOption(value);await page.getByRole('button',{name:'Simpan Pengaturan Meta Pixel'}).click();
      await page.getByRole('status').filter({hasText:'berhasil disimpan'}).waitFor();
      assert.equal(await page.evaluate(()=>window.__fixture.saved.events[0].trigger),value);
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('staff without Manager/Admin access cannot edit the Lead trigger',async()=>{
  const{page,context}=await fixture({query:'?settings&role=css'});
  try{await page.getByText('Mode lihat saja.',{exact:false}).waitFor();assert.equal(await page.getByRole('combobox',{name:/^Pemicu/}).isEnabled(),false);}
  finally{await context.close();}
});
test('customer page emits no Lead for method selection or pending proof; verified update sends once for all manual banks',async()=>{
  for(const bankCode of ['BNI','MANDIRI','BRI','QRIS']){
    const{page,context,requests,errors}=await fixture();
    try{
      await page.waitForFunction(()=>typeof window.__emitPayment==='function');
      await page.evaluate(()=>window.__emitPayment({...window.__fixture.payment,status:'pending_manual_verification',paymentProofUrl:'fixture-proof'}));
      assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>window.__fixture.meta.filter(c=>c[2]==='Lead').length),0);
      await page.evaluate(channel=>window.__emitPayment({...window.__fixture.payment,status:'paid',bankCode:channel,provider:channel==='QRIS'?'bni_merchant':'manual_senzu'}),bankCode);
      await page.waitForFunction(()=>window.__fixture.meta.some(c=>c[2]==='Lead'));
      await page.evaluate(()=>window.__emitPayment({...window.__fixture.payment}));
      await page.waitForFunction(()=>window.__fixture.lookups>=2);
      assert.equal(await page.evaluate(()=>window.__fixture.meta.filter(c=>c[2]==='Lead').length),1);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
});
test('reopening verified manual page tracks once in the same browser; operator and stale callback never track',async()=>{
  const{page,context,errors}=await fixture({paid:true});
  try{
    await page.waitForFunction(()=>window.__fixture.meta.some(c=>c[2]==='Lead'));
    const first=await page.evaluate(()=>window.__fixture.meta.find(c=>c[2]==='Lead')[4].eventID);
    await page.reload();await page.waitForFunction(()=>window.__fixture.lookups>=1);
    assert.equal(await page.evaluate(()=>window.__fixture.meta.filter(c=>c[2]==='Lead').length),0);
    assert.match(first,/^sh_[a-f0-9]{64}$/);assert.deepEqual(errors,[]);
  }finally{await context.close();}
  const operator=await fixture({paid:true,staff:true});
  try{await operator.page.waitForFunction(()=>window.__fixture.lookups>=1);
    assert.equal(await operator.page.evaluate(()=>window.__fixture.meta.filter(c=>c[2]==='Lead').length),0);
  }finally{await operator.context.close();}
  const closed=await fixture();
  try{await closed.page.waitForFunction(()=>typeof window.__emitPayment==='function');
    await closed.page.getByRole('button',{name:'Tutup halaman lokal'}).click();await closed.page.getByText('Halaman ditutup').waitFor();
    await closed.page.evaluate(()=>window.__emitPayment({...window.__fixture.payment,status:'paid'}));assert.equal(closed.requests.length,0);
  }finally{await closed.context.close();}
});
