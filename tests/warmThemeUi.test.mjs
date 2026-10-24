// Real home/navigation components. Data and side effects are local fixtures;
// external requests are blocked, so this never creates bookings or Meta events.
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
  ? pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
let temp,browser,server,origin;
const mocks={
  staff:`export function useAuth(){return {currentUser:null,logout:async()=>{}};}`,
  customer:`export function useCustomerAuth(){return {currentCustomer:null,isCustomerAuthenticated:false,firebaseUser:null,isCustomerPreviewMode:false};}`,
  crm:`export async function findCustomerByPhoneOrEmail(){return null;} export async function getCustomerSavedAddresses(){return [];}`,
  loyalty:`export async function getLoyaltyAccountByCustomerId(){return null;} export async function getCustomerVouchers(){return [];} export async function getAllVouchers(){return [];}`,
  persistence:`export function filterCustomerBookings(){return [];} export function getActiveBooking(){return null;} export async function reconcileCustomerBookingsInFirestore(){throw new Error('Unexpected write in preview');}`,
  support:`export const DEFAULT_CS_MESSAGE='Fixture support';export function useCustomerServiceWhatsApp(){return {isAvailable:true,getWhatsAppUrl:()=> 'https://example.invalid/support',unavailableNotice:''};}`,
  pending:`export function PendingPaymentCard(){return null;}`,
  chat:`export function ChatButtonWithBadge(){return null;}`,
};
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'senzu-warm-ui-'));
  await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{Navbar}from'./src/components/Navbar';import{MobileHomeView}from'./src/components/MobileHomeView';import{MobileBottomNav}from'./src/components/MobileBottomNav';
    const services=[{id:'signature-30',name:'Signature Treatment',duration:30,price:160000},
      {id:'signature-60',name:'Senzu Home Signature 60 Menit',duration:60,price:225000},
      {id:'signature-90',name:'Senzu Home Signature 90 Menit',duration:90,price:325000,isPopular:true},
      {id:'signature-120',name:'Senzu Home Signature 120 Menit',duration:120,price:425000}];
    const record=(action,...args)=>window.__fixture.actions.push({action,args});
    function Preview(){const[tab,setTab]=useState('home');const choose=t=>{record('tab',t);setTab(t);};return <div className="senzu-shell min-h-screen bg-senzu-canvas font-sans">
      <Navbar onGoHome={()=>choose('home')} onOpenTracking={()=>record('tracking')} onOpenCustomerPortal={()=>choose('orders')} onOpenAccount={()=>choose('account')}
        onOpenLogin={()=>record('staff-login')} activeStaffTab="home" setActiveStaffTab={()=>{}} onOpenNotifications={()=>record('notifications')} customerTab={tab}/>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 pb-28">
        <p className="senzu-eyebrow mb-4 text-slate-500">Pratinjau UI · Data contoh</p>
        <MobileHomeView services={services} bookings={[]} settings={{}} onStartBooking={(...args)=>record('booking',...args)} onOpenTracking={(...args)=>record('tracking',...args)} onRepeatBooking={()=>{}}
          onOpenRewards={()=>choose('rewards')} onOpenOrders={()=>choose('orders')} onOpenAccount={()=>choose('account')}/>
      </main><MobileBottomNav activeTab={tab} onChangeTab={choose} activeOrdersCount={2}/></div>;}
    createRoot(document.getElementById('root')).render(<Preview/>);`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',outfile:path.join(temp,'bundle.js'),
    plugins:[{name:'local-fixtures',setup(b){b.onResolve({filter:/.*/},args=>{
      const key=[['AuthContext','staff'],['CustomerAuthContext','customer'],['crmService','crm'],['loyaltyService','loyalty'],['bookingPersistenceService','persistence'],['supportWhatsApp','support'],['PendingPaymentCard','pending'],['ChatButtonWithBadge','chat']]
        .find(([suffix])=>args.path.endsWith('/'+suffix))?.[1];
      if(key)return{path:key,namespace:'fixture'};
    });b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
  const assets=await fs.readdir(path.join(root,'dist/assets')),css=assets.find(f=>f.endsWith('.css'));
  const app=express();app.get('/bundle.js',(_,res)=>res.sendFile(path.join(temp,'bundle.js')));app.get('/app.css',(_,res)=>res.sendFile(path.join(root,'dist/assets',css)));
  app.use('/assets/brand',express.static(path.join(root,'public/assets/brand')));
  app.get('/',(_,res)=>res.send('<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__fixture={actions:[]};</script><script type="module" src="/bundle.js"></script></body></html>'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.XENDIT_CHROMIUM_EXECUTABLE?{executablePath:process.env.XENDIT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));if(temp)await fs.rm(temp,{recursive:true,force:true});});
async function fixture(width){
  const context=await browser.newContext({viewport:{width,height:width<768?844:1000}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.goto(origin);await page.locator('#senzu-hero-title').waitFor();return{context,page,errors};
}
test('warm palette and responsive home remain readable at 320, 390, 768, 1024, 1280 and 1440 px',async()=>{
  for(const width of [320,390,768,1024,1280,1440]){const{context,page,errors}=await fixture(width);try{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}`);
    assert.equal(await page.locator('#btn-hero-order-now').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(117, 76, 49)');
    assert.equal(await page.locator('.senzu-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 243, 236)');
    for(const el of [page.locator('#btn-hero-order-now'),page.locator('#btn-hero-track-booking'),page.getByRole('button',{name:'Pilih Signature Treatment',exact:true})])
      assert.ok((await el.boundingBox()).height>=44,'primary touch target is at least 44px');
    assert.deepEqual(errors,[]);
    if(process.env.SENZU_UI_SCREENSHOTS&&(width===390||width===1440)){
      await fs.mkdir(process.env.SENZU_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SENZU_UI_SCREENSHOTS,width===390?'warm-mobile.png':'warm-desktop.png'),fullPage:false});
    }
  }finally{await context.close();}}
});
test('service selection works by keyboard and card click; hero booking/tracking callbacks stay separate',async()=>{
  const{context,page,errors}=await fixture(390);try{
    const service=page.getByRole('button',{name:'Pilih Signature Treatment',exact:true});await service.focus();await page.keyboard.press('Enter');
    await page.locator('.senzu-service-card').nth(1).click({position:{x:20,y:20}});
    await page.locator('#btn-hero-order-now').click();await page.locator('#btn-hero-track-booking').click();
    const calls=await page.evaluate(()=>window.__fixture.actions);
    assert.deepEqual(calls.map(x=>[x.action,x.args[0]??null]),[['booking','signature-30'],['booking','signature-60'],['booking',null],['tracking',null]]);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('all five mobile tabs keep their routes and expose the selected tab to assistive technology',async()=>{
  const{context,page,errors}=await fixture(390);try{
    const nav=page.getByRole('navigation',{name:'Navigasi Utama Mobile',exact:true});
    for(const[name,id]of [['Pesanan Saya','orders'],['Pesan Layanan Sekarang','booking'],['Rewards & Loyalty','rewards'],['Akun Saya','account'],['Beranda','home']]){
      const button=nav.getByRole('button',{name,exact:true});await button.click();assert.equal(await button.getAttribute('aria-current'),'page');
      assert.equal((await page.evaluate(()=>window.__fixture.actions)).at(-1).args[0],id);
    }
    assert.equal(await nav.getByRole('button',{name:'Pesanan Saya',exact:true}).textContent().then(x=>x.includes('2')),true);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('reduced motion and larger text do not hide the booking action or overflow mobile',async()=>{
  const{context,page}=await fixture(390);try{
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    await page.addStyleTag({content:'html {font-size: 20px !important;}'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#btn-hero-order-now').click();assert.equal((await page.evaluate(()=>window.__fixture.actions)).at(-1).action,'booking');
  }finally{await context.close();}
});
