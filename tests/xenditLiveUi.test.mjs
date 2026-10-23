// Real customer/return/Manager components and HTTP client, rendered in Chromium.
// Firebase identity, database reads and Xendit HTTP are local fixtures only.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import express from 'express';
const root=fileURLToPath(new URL('../',import.meta.url));
const playwright=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href : 'playwright');
let server,browser,origin,temp;
const booking={id:'bk_fixture_live',bookingCode:'SH-FIXTURE',customerId:'alice',customerAuthUid:'alice',authUserId:'alice',
  customerName:'Fixture',totalAmount:170000,paymentMethod:'Xendit',gatewayProvider:'xendit',gatewayEnvironment:'live',status:'Menunggu Pembayaran'};
const active=()=>({bookingId:booking.id,referenceId:'shl_'+'a'.repeat(48),amount:170000,currency:'IDR',environment:'live',
  creationState:'ready',sessionStatus:'ACTIVE',paymentStatus:'pending',sessionId:'ps-'+'1'.repeat(24),
  checkoutUrl:'https://xen.to/local_fixture',expiresAt:'2099-01-01T00:00:00Z',lastWebhookAt:null,lastCheckedAt:null,reconciliationRequired:false});
const mocks={
  metaSettings:`export async function getMetaAdsSettings(){return {enabled:false,pixels:[],events:[]};}`,
  firebase:`const listeners=new Set();const user=uid=>uid?{uid,getIdToken:async()=> 'fixture_token'}:null;
    export const auth={currentUser:user('alice')},db={};
    export function subscribe(callback){listeners.add(callback);queueMicrotask(()=>{if(listeners.has(callback))callback(auth.currentUser);});return()=>listeners.delete(callback);}
    window.__setAuth=uid=>{auth.currentUser=user(uid);for(const callback of listeners)callback(auth.currentUser);};`,
  auth:`import {subscribe} from 'fixture:firebase';export function onAuthStateChanged(_auth,callback){return subscribe(callback);}`,
  firestore:`export const doc=(_db,collection,id)=>({collection,id});export async function getDoc(ref){window.__fixture.docReads.push(ref);
    const data=window.__fixture.returnBooking;return {id:ref.id,exists:()=>Boolean(data),data:()=>data};}`,
};
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'senzu-live-ui-'));
  await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
    import{XenditLivePaymentPage}from'./src/components/customer/XenditLivePaymentPage';
    import{XenditLiveReturn}from'./src/components/customer/XenditLiveReturn';
    import{XenditLiveCard}from'./src/components/admin/XenditLiveCard';
    const screen=new URLSearchParams(location.search).get('screen');
    createRoot(document.getElementById('root')).render(screen==='return'?<XenditLiveReturn/>:screen==='manager'?
      <XenditLiveCard currentUser={{uid:'alice',role:new URLSearchParams(location.search).get('role')||'manager'}}/>:
      <XenditLivePaymentPage booking={window.__fixture.returnBooking}/>);`,resolveDir:root,loader:'tsx'},
    bundle:true,format:'esm',outfile:path.join(temp,'bundle.js'),plugins:[{name:'firebase-fixtures',setup(builder){
      builder.onResolve({filter:/.*/},args=>{
        const key=/(^|\/)metaAdsService$/.test(args.path)?'metaSettings':args.path.startsWith('fixture:')?args.path.slice(8):args.path==='firebase/auth'?'auth':args.path==='firebase/firestore'?'firestore':/(^|\/)firebase$/.test(args.path)?'firebase':null;
        if(key)return{path:key,namespace:'fixture'};
      });
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]});
  const app=express();app.get('/bundle.js',(_,res)=>res.sendFile(path.join(temp,'bundle.js')));
  app.get('/',(_,res)=>res.send(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div>
    <script>window.__fixture={docReads:[],meta:[],returnBooking:${JSON.stringify(booking)}};window.fbq=(...a)=>window.__fixture.meta.push(a);</script>
    <script type="module" src="/bundle.js"></script></body></html>`));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.XENDIT_CHROMIUM_EXECUTABLE?{executablePath:process.env.XENDIT_CHROMIUM_EXECUTABLE}:{}),
    args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(temp)await fs.rm(temp,{recursive:true,force:true});});
async function fixture(query=''){
  const context=await browser.newContext({viewport:{width:390,height:844}}),state={session:null,calls:[],failure:false,invalidUrl:false,delayStatus:null};
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==origin){await route.abort();return;}
    if(!url.pathname.startsWith('/api/')){await route.continue();return;}
    const action=url.pathname.split('/').pop(),body=route.request().postDataJSON();state.calls.push({action,body});
    assert.equal(route.request().headers().authorization,'Bearer fixture_token');
    if(action==='configuration') {await route.fulfill({json:{success:true,available:false,enabled:false,environment:'live',
      liveKeyPresent:false,liveTokenPresent:false,businessIdPresent:false,routeKeyPresent:true,webhookPath:'/api/integrations/xendit/live/webhook'}});return;}
    if(action==='checkout'){
      state.session=state.failure?{...active(),creationState:'uncertain',sessionStatus:null,sessionId:null,checkoutUrl:null}:active();
      if(state.failure){await route.fulfill({status:503,json:{success:false,error:'Fixture uncertain'}});return;}
      if(state.invalidUrl)state.session.checkoutUrl='https://checkout-staging.xendit.co/fixture';
    }else if(action==='refresh'||action==='recover')state.session={...active(),lastCheckedAt:new Date().toISOString()};
    else if(action!=='status'&&action!=='inspect')throw new Error('Unexpected fixture endpoint '+action);
    const result=state.session?structuredClone(state.session):null;
    if(state.delayStatus&&action==='status')await state.delayStatus;
    await route.fulfill({json:{success:true,session:result}}).catch(()=>{});
  });
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+query);
  return{context,page,state,errors};
}
test('customer opens with read-only status; explicit prepare creates once and return never creates or settles',async()=>{
  const{context,page,state,errors}=await fixture();try{
    const prepare=page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true});await prepare.waitFor();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Siapkan Pembayaran Xendit'&&!b.disabled));
    assert.deepEqual(state.calls.map(c=>c.action),['status']);
    await prepare.click();const link=page.getByRole('link',{name:'Lanjut ke Pembayaran Xendit',exact:true});await link.waitFor();
    assert.equal(await link.getAttribute('href'),'https://xen.to/local_fixture');assert.equal(state.calls.filter(c=>c.action==='checkout').length,1);
    assert.deepEqual(state.calls.find(c=>c.action==='checkout').body,{bookingId:booking.id});
    assert.equal(await page.locator('input[type=file]').count(),0);
    await link.evaluate(el=>el.addEventListener('click',event=>event.preventDefault()));await link.click();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('senzu:xendit-live-return:alice')),booking.id);
    await page.goto(origin+'/?screen=return&xendit=returned');await page.getByRole('dialog').waitFor();await link.waitFor();
    assert.equal(await page.getByText('Pembayaran diterima',{exact:true}).count(),0);
    assert.equal(state.calls.filter(c=>c.action==='checkout').length,1);assert.equal(state.calls.filter(c=>c.action==='refresh').length,0);
    state.session={...state.session,sessionStatus:'COMPLETED',paymentStatus:'paid',lastWebhookAt:new Date().toISOString()};
    await page.getByRole('button',{name:'Muat Ulang Status',exact:true}).click();await page.getByText('Pembayaran diterima',{exact:true}).waitFor();
    assert.equal(state.calls.filter(c=>c.action==='refresh').length,0);assert.deepEqual(await page.evaluate(()=>window.__fixture.meta),[]);
    await page.getByRole('button',{name:'Tutup',exact:true}).click();assert.equal(new URL(page.url()).searchParams.has('xendit'),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('uncertain create survives refresh without replacement; explicit API check is separately requested',async()=>{
  const{context,page,state,errors}=await fixture();try{
    state.failure=true;const prepare=page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true});await prepare.click();
    await page.getByText('Pembayaran sedang diproses.',{exact:false}).waitFor();
    await page.reload();await page.getByText('Pembayaran sedang diproses.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true}).count(),0);
    assert.equal(state.calls.filter(c=>c.action==='checkout').length,1);
    state.session=active();await page.getByRole('button',{name:'Muat Ulang Status',exact:true}).click();
    await page.getByRole('button',{name:'Periksa ke Xendit',exact:true}).click();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Periksa ke Xendit')?.disabled);
    assert.equal(state.calls.filter(c=>c.action==='refresh').length,1);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('Live UI rejects staging links and never treats redirect or another account as payment evidence',async()=>{
  const{context,page,state,errors}=await fixture();try{
    state.invalidUrl=true;await page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.equal(await page.locator('a').count(),0);
    assert.equal(await page.getByText('Pembayaran diterima',{exact:true}).count(),0);
    await page.evaluate(()=>{sessionStorage.setItem('senzu:xendit-live-return:alice','bk_fixture_live');window.__setAuth('bob');});
    assert.equal(await page.locator('a').count(),0);
    await page.goto(origin+'/?screen=return&xendit=returned');
    await page.evaluate(()=>window.__setAuth('bob'));
    await page.getByText('Buka Pesanan Saya untuk melihat status pembayaran Anda.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Pembayaran diterima',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('account change while a status response is pending clears the previous payment',async()=>{
  const{context,page,state,errors}=await fixture();try{
    await page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true}).click();await page.locator('a').waitFor();
    let release;state.delayStatus=new Promise(r=>release=r);
    await page.getByRole('button',{name:'Muat Ulang Status',exact:true}).click();
    await page.evaluate(()=>window.__setAuth(null));release();
    await page.getByText('Masuk ke akun pemesan untuk melihat status pembayaran.',{exact:true}).waitFor();
    assert.equal(await page.locator('a').count(),0);assert.equal(await page.getByRole('button',{name:'Siapkan Pembayaran Xendit',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('Manager panel exposes configuration booleans and explicit recovery without secret fields or automatic checkout',async()=>{
  const{context,page,state,errors}=await fixture('?screen=manager');try{
    await page.getByText('Secret Live:',{exact:false}).waitFor();
    assert.deepEqual(state.calls.map(c=>c.action),['configuration']);
    assert.equal(await page.locator('input[type=password]').count(),0);
    assert.equal(await page.getByRole('textbox',{name:'URL webhook Live'}).inputValue(),origin+'/api/integrations/xendit/live/webhook');
    await page.getByRole('textbox',{name:'ID Booking',exact:true}).fill(booking.id);
    state.session={...active(),sessionStatus:'COMPLETED',paymentStatus:'paid',lastWebhookAt:new Date().toISOString()};
    await page.getByRole('button',{name:'Lihat Status Tersimpan',exact:true}).click();await page.getByText('Status tersimpan.',{exact:false}).waitFor();
    assert.equal(state.calls.filter(c=>c.action==='inspect').length,1);assert.equal(state.calls.filter(c=>c.action==='refresh').length,0);
    await page.getByText('Pemeriksaan API terakhir: Belum ada.',{exact:true}).waitFor();
    await page.locator('summary').click();
    await page.getByRole('textbox',{name:'Payment Session ID',exact:true}).fill('ps-'+'1'.repeat(24));
    await page.getByRole('button',{name:'Cocokkan Sesi Live',exact:true}).click();await page.getByText('Sesi cocok.',{exact:false}).waitFor();
    assert.equal(state.calls.filter(c=>c.action==='recover').length,1);assert.equal(state.calls.filter(c=>c.action==='checkout').length,0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('internal Test return query does not open customer Live status view',async()=>{
  const{context,page,state,errors}=await fixture('?screen=return&xendit_test=returned');try{
    await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(state.calls.length,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
