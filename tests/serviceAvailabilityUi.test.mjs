// Actual customer components and catalog reader, with a local Firestore stream.
// No production database, authentication, payment, Meta or accounting service is contacted.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build, transformSync } from 'esbuild';
import express from 'express';
import { getCustomerServices } from '../src/lib/customerServices.ts';
import { calculateHomeServiceFee, SENZU_BASE_LOCATION } from '../src/lib/distanceFeeService.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(path.join(root, 'src/lib/dbService.ts'), 'utf8');
const ast = ts.createSourceFile('dbService.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Map();
for (const node of ast.statements) if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast).replace(/^export\s+/, ''));
const catalogFunctions = ['servicesFromSnapshot', 'getServices', 'subscribeToServices'].map(name => functions.get(name)).join('\n');
const compile = code => transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const rows = [
  { id:'s30',name:'Signature Treatment',duration:30,price:160000,isActive:false,sortOrder:3 },
  { id:'s60',name:'Senzu Home Signature 60 Menit',duration:60,price:225000,isActive:false,sortOrder:4 },
  { id:'s90',name:'Senzu Home Signature 90 Menit',duration:90,price:325000,isActive:true,isPopular:true,sortOrder:2 },
  { id:'s120',name:'Senzu Home Signature 120 Menit',duration:120,price:425000,isActive:true,isPopular:true,sortOrder:1 },
].map(service => ({...service,description:'Fixture service',serviceType:'HOME_SERVICE'}));
const snap = (list, fromCache=false, hasPendingWrites=false) => ({
  docs:list.map(row => ({id:row.id,data:()=>structuredClone(row)})),metadata:{fromCache,hasPendingWrites},empty:list.length===0,
});

test('customer catalog accepts only explicitly active Home Service/BOTH entries', () => {
  const services=[...rows,{...rows[0],id:'outlet',isActive:true,serviceType:'OUTLET'},
    {...rows[0],id:'unknown',isActive:undefined},{...rows[0],id:'legacy',isActive:true,serviceType:undefined},
    {...rows[0],id:'both',isActive:true,serviceType:'BOTH'}];
  assert.deepEqual(getCustomerServices(services).map(s=>s.id),['s90','s120','legacy','both']);
  assert.deepEqual(getCustomerServices(null),[]);
  assert.equal(services.length,8,'customer filtering must not mutate Manager history/catalog');
});
test('actual catalog functions ignore stale cache, publish server toggles/empty state and unsubscribe', async () => {
  let receive, failure, stopped=false, mode='ok';
  const sdkSnapshot=snap(rows);
  const factory=new Function('db','collection','getDocsFromServer','onSnapshot','console','window','localStorage','DEFAULT_SERVICES',
    compile(`${catalogFunctions}\nreturn {getServices,subscribeToServices};`));
  const catalog=factory({},(_,name)=>({name}),async()=>{if(mode==='error')throw {code:'unavailable'};return mode==='empty'?snap([]):sdkSnapshot;},
    (ref,options,callback,onError)=>{assert.equal(ref.name,'services');assert.equal(options.includeMetadataChanges,true);receive=callback;failure=onError;return()=>{stopped=true;};},
    {warn(){}},{},{getItem:()=>JSON.stringify(rows.map(s=>({...s,isActive:true})))},rows);
  assert.deepEqual((await catalog.getServices()).map(s=>s.id),['s120','s90','s30','s60']);
  mode='empty';assert.deepEqual(await catalog.getServices(),[]);
  mode='error';assert.deepEqual(await catalog.getServices(),[]);
  const events=[],unsubscribe=catalog.subscribeToServices(list=>events.push(list));
  receive(snap(rows.map(s=>({...s,isActive:true})),true));assert.deepEqual(events.at(-1),[]);
  receive(sdkSnapshot);assert.deepEqual(getCustomerServices(events.at(-1)).map(s=>s.id),['s120','s90']);
  receive(snap(rows.map(s=>({...s,isActive:true})),false,true));assert.equal(events.length,2,'uncommitted writes are not catalog authority');
  receive(snap(rows.map(s=>({...s,isActive:s.id==='s60'}))));assert.deepEqual(getCustomerServices(events.at(-1)).map(s=>s.id),['s60']);
  receive(snap([]));assert.deepEqual(events.at(-1),[]);
  failure({code:'permission-denied'});assert.deepEqual(events.at(-1),[]);
  unsubscribe();assert.equal(stopped,true);
});
test('actual manual booking function rechecks the service in its write transaction and rolls back on deactivation', async () => {
  for (const mode of ['inactive','missing','outlet','retry','active']) {
    let service=mode==='missing'?undefined:{isActive:mode!=='inactive',serviceType:mode==='outlet'?'OUTLET':'HOME_SERVICE'};
    const writes=[],effects=[];
    const factory=new Function('auth','db','calculateDistanceKm','calculateHomeServiceFee','SENZU_BASE_LOCATION','generateBookingCode',
      'runTransaction','doc','cleanFirestoreData','addBookingStatusHistory','upsertCustomerCRM','createPaymentRecord','emitEvent',
      compile(`${functions.get('createBooking')}\nreturn createBooking;`));
    const create=factory({currentUser:null},{},()=>0,calculateHomeServiceFee,SENZU_BASE_LOCATION,()=>`SH-FIXTURE-${mode}`,
      async(_,fn)=>{
        const pending=[];
        const transaction={get:async ref=>{assert.equal(ref.collection,'services');return {exists:()=>!!service,data:()=>service};},
          set:(ref,data)=>pending.push({ref,data})};
        if(mode==='retry'){await fn(transaction);pending.length=0;service.isActive=false;}
        const value=await fn(transaction);writes.push(...pending);return value;
      },(_,collection,id)=>({collection,id}),value=>value,
      async()=>{effects.push('history');},async()=>{effects.push('crm');},async()=>{effects.push('payment');return {};},
      async()=>{effects.push('notification');});
    const input={serviceId:'s60',serviceName:'Fixture',servicePrice:225000,serviceDuration:60,paymentMethod:'Transfer BNI',
      latitude:SENZU_BASE_LOCATION.lat,longitude:SENZU_BASE_LOCATION.lng,distanceKm:12,customerName:'Fixture'};
    if(mode==='active'){
      const booking=await create(input);assert.equal(writes.length,1);assert.equal(writes[0].ref.collection,'bookings');
      assert.equal(booking.totalAmount,255000);assert.deepEqual(effects,['history','crm','payment','notification']);
    }else{
      await assert.rejects(()=>create(input),error=>error.code==='SERVICE_UNAVAILABLE');
      assert.equal(writes.length,0);assert.deepEqual(effects,[]);
    }
  }
});

const playwright=await import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href:'playwright');
let browser,server,origin,temporary;
const mocks={
  firebase:`export const auth={currentUser:{uid:'alice',getIdToken:async()=>'fixture_token'}};`,
  authSdk:`import {auth} from 'fixture:firebase';export function onAuthStateChanged(_,cb){let live=true;queueMicrotask(()=>{if(live)cb(auth.currentUser)});return()=>{live=false};}`,
  staff:`export function useAuth(){return {currentUser:null};}`,
  customer:`import {auth} from 'fixture:firebase';const customer={id:'alice',authUserId:'alice',name:'Fixture Customer',phone:'081234567890',gender:'Laki-laki'};export function useCustomerAuth(){return {currentCustomer:customer,
    firebaseUser:auth.currentUser,isCustomerAuthenticated:true,isCustomerPreviewMode:false,updateCustomerProfile:async()=>{}};}`,
  db:`export {calculateHomeServiceFee} from ${JSON.stringify(path.join(root,'src/lib/distanceFeeService.ts'))};
    const db={};const collection=(_,name)=>({name});
    function onSnapshot(_,options,cb,error){window.__fixture.metadata=options;window.__emitServices=(rows,metadata={})=>cb({docs:rows.map(s=>({id:s.id,data:()=>s})),metadata:{fromCache:false,hasPendingWrites:false,...metadata}});
      window.__catalogError=()=>error({code:'unavailable'});queueMicrotask(()=>window.__emitServices(window.__fixture.services));return()=>{delete window.__emitServices;};}
    const getDocsFromServer=async()=>({docs:[]});
    ${catalogFunctions}
    export {subscribeToServices};
    export async function createBooking(data){window.__fixture.inputs.push(data);return {...data,id:'fixture_booking',bookingCode:'SH-FIXTURE',status:'Menunggu Pembayaran',paymentStatus:'UNPAID',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}`,
  loyalty:`export async function getLoyaltySettings(){return null;}export async function getMembershipTiers(){return [];}export async function getLoyaltyAccountByCustomerId(){return null;}
    export async function getCustomerVouchers(){return [];}export async function getAllVouchers(){return [];}export async function validateReferralCode(){return {valid:false};}
    export async function getVoucherByCode(){return null;}export async function validatePromoCodeForBooking(){return {valid:false};}`,
  crm:`export async function findCustomerByPhoneOrEmail(){return null;}export async function getCustomerSavedAddresses(){return [];}`,
  master:`export async function getServiceAreas(){return [];}`,
  meta:`export async function trackMetaAdsAction(action,context){window.__fixture.meta.push({action,context});}`,
  payment:`import React from 'react';export function CustomerPaymentPage(){return <div>Existing manual payment page</div>;}`,
  map:`import React,{useEffect} from 'react';export function AddressAutocompleteMap(p){useEffect(()=>{p.setAddress('Fixture address');p.setDistanceKm(12);p.setDistanceMeters(12000)},[]);return <div>Fixture map</div>;}`,
  support:`export const DEFAULT_CS_MESSAGE='Fixture';export function useCustomerServiceWhatsApp(){return {isAvailable:false,getWhatsAppUrl:()=>null,unavailableNotice:'Fixture support'};}`,
  persistence:`export function filterCustomerBookings(){return [];}export function getActiveBooking(){return null;}export async function reconcileCustomerBookingsInFirestore(){}`,
  pending:`export function PendingPaymentCard(){return null;}`,
  chat:`export function ChatButtonWithBadge(){return null;}`,
};
before(async()=>{
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'senzu-catalog-ui-'));
  await build({stdin:{contents:`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {MobileHomeView} from './src/components/MobileHomeView';import {BookingForm} from './src/components/BookingForm';import {subscribeToServices} from './src/lib/dbService';
    function App(){const [services,setServices]=useState([]),[view,setView]=useState(window.__fixture.view),[initial,setInitial]=useState(window.__fixture.initial);
      useEffect(()=>subscribeToServices(setServices),[]);return view==='home'?<MobileHomeView services={services} settings={{}} bookings={[]}
        onStartBooking={id=>{setInitial(id||'');setView('booking')}} onOpenTracking={()=>{}} onRepeatBooking={()=>{}} onOpenRewards={()=>{}} onOpenOrders={()=>{}}/>
        :<BookingForm services={services} settings={{}} initialServiceId={initial} repeatData={window.__fixture.repeat} onBookingSuccess={()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',outfile:path.join(temporary,'bundle.js'),
    plugins:[{name:'fixtures',setup(builder){
      builder.onResolve({filter:/.*/},args=>{
        let name;
        if(args.path.startsWith('fixture:'))name=args.path.slice(8);
        else if(args.path==='firebase/auth')name='authSdk';
        else if(/(^|\/)firebase$/.test(args.path))name='firebase';
        else for(const [suffix,key] of [['AuthContext','staff'],['CustomerAuthContext','customer'],['dbService','db'],['loyaltyService','loyalty'],
          ['crmService','crm'],['masterDataService','master'],['metaPixel','meta'],['CustomerPaymentPage','payment'],['AddressAutocompleteMap','map'],
          ['supportWhatsApp','support'],['bookingPersistenceService','persistence'],['PendingPaymentCard','pending'],['ChatButtonWithBadge','chat']]){
          if(args.path.endsWith('/'+suffix)){name=key;break;}
        }
        if(name)return {path:name,namespace:'fixture'};
      });
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));
    }}]});
  const app=express();app.get('/bundle.js',(_,res)=>res.sendFile(path.join(temporary,'bundle.js')));
  app.get('/app.css',async(_,res)=>{const files=await fs.readdir(path.join(root,'dist/assets'));res.sendFile(path.join(root,'dist/assets',files.find(f=>f.endsWith('.css'))));});
  app.get('/',(_,res)=>res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
    <body style="background:#f8fafc;padding:16px"><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.XENDIT_CHROMIUM_EXECUTABLE?{executablePath:process.env.XENDIT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(temporary)await fs.rm(temporary,{recursive:true,force:true});});
async function pageFixture({view='home',initial='',repeat=null,services=rows,width=1440}={}){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(data=>{window.__fixture={...data,inputs:[],meta:[]};localStorage.setItem('senzu_cached_services',JSON.stringify(data.services.map(s=>({...s,isActive:true,price:350000}))));},{view,initial,repeat,services});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){await route.abort();return;}
    if(url.pathname==='/api/integrations/xendit/live/availability'){await route.fulfill({json:{success:true,available:false,environment:'live'}});return;}
    if(url.pathname.startsWith('/api/')){await route.fulfill({status:500,json:{success:false}});return;}
    await route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
  await page.waitForFunction(()=>typeof window.__emitServices==='function');
  return {context,page,errors};
}
test('desktop and mobile hide inactive services on home and booking, using current prices rather than cached defaults',async()=>{
  for(const width of [1440,390]){
    const {context,page,errors}=await pageFixture({width});
    try{
      const home=page.locator('#services-section');await home.getByText(rows[2].name,{exact:true}).waitFor();
      assert.deepEqual(await home.locator('h3').allTextContents(),[rows[3].name,rows[2].name]);
      assert.equal(await home.getByText(/325\.000/).count(),1);assert.equal(await home.getByText(/350\.000/).count(),0);
      await home.getByText(rows[2].name,{exact:true}).click();await page.locator('#booking-form').waitFor();
      assert.deepEqual((await page.locator('#booking-form h4').allTextContents()).filter(name=>rows.some(service=>service.name===name)),[rows[3].name,rows[2].name]);
      assert.equal(await page.getByText('Dipilih',{exact:true}).locator('..').getByText(rows[2].name,{exact:true}).count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
});
test('server updates hide, re-enable and reprice services without a reload; an empty catalog never revives defaults',async()=>{
  const {context,page,errors}=await pageFixture({services:rows.map(s=>({...s,isActive:true}))});
  try{
    await page.waitForFunction(()=>document.querySelectorAll('#services-section h3').length===4);
    await page.evaluate(data=>window.__emitServices(data),rows.map(s=>({...s,price:s.id==='s90'?335000:s.price})));
    await page.waitForFunction(()=>document.querySelectorAll('#services-section h3').length===2);
    assert.equal(await page.locator('#services-section').getByText(/335\.000/).count(),1);
    await page.evaluate(data=>window.__emitServices(data),rows.map(s=>({...s,isActive:s.isActive||s.id==='s60'})));
    await page.waitForFunction(()=>document.querySelectorAll('#services-section h3').length===3);
    await page.evaluate(()=>window.__emitServices([]));await page.waitForFunction(()=>document.querySelectorAll('#services-section h3').length===0);
    await page.getByRole('button',{name:'Semua',exact:true}).click();await page.getByText('Belum Ada Layanan yang Tersedia',{exact:true}).waitFor();
    assert.equal(await page.locator('#booking-form').count(),0);assert.deepEqual(await page.evaluate(()=>[window.__fixture.inputs.length,window.__fixture.meta.length]),[0,0]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('disabling the selected service clears selection and blocks submit until the customer explicitly selects another',async()=>{
  const {context,page,errors}=await pageFixture({view:'booking',initial:'s60',services:rows.map(s=>({...s,isActive:true}))});
  try{
    await page.getByText('Dipilih',{exact:true}).waitFor();
    await page.evaluate(data=>window.__emitServices(data),rows);
    await page.waitForFunction(()=>!document.querySelector('#booking-form')?.textContent.includes('Dipilih'));
    await page.locator('#booking-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await page.getByText('Harap pilih salah satu layanan treatment yang diinginkan.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.inputs.length,window.__fixture.meta.length]),[0,0]);
    await page.locator('#booking-form h4').getByText(rows[2].name,{exact:true}).click();
    await page.locator('#btn-submit-booking').click();await page.getByText('Existing manual payment page',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__fixture.inputs.map(b=>[b.serviceId,b.servicePrice])),[['s90',325000]]);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('repeat booking never restores an inactive service and catalog refresh does not overwrite the new selection',async()=>{
  const {context,page,errors}=await pageFixture({view:'booking',repeat:{serviceId:'s60',customerName:'Fixture Repeat',customerWhatsApp:'081234567890',address:'Fixture address'}});
  try{
    await page.locator('#booking-form').waitFor();await page.waitForFunction(()=>!document.querySelector('#booking-form')?.textContent.includes('Dipilih'));
    assert.equal(await page.locator('#booking-form h4').getByText(rows[1].name,{exact:true}).count(),0);
    await page.locator('#booking-form h4').getByText(rows[2].name,{exact:true}).click();
    await page.evaluate(data=>window.__emitServices(data),rows.map(s=>({...s,description:'Updated catalog'})));
    await page.locator('#btn-submit-booking').click();await page.getByText('Existing manual payment page',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__fixture.inputs[0].serviceId),'s90');assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('catalog outage or deactivation leaves an already-created payment page available without another booking or Meta event',async()=>{
  const {context,page,errors}=await pageFixture({view:'booking',initial:'s90'});
  try{
    await page.locator('#btn-submit-booking').click();await page.getByText('Existing manual payment page',{exact:true}).waitFor();
    const before=await page.evaluate(()=>[window.__fixture.inputs.length,window.__fixture.meta.length]);
    await page.evaluate(()=>window.__catalogError());
    assert.equal(await page.getByText('Existing manual payment page',{exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(()=>[window.__fixture.inputs.length,window.__fixture.meta.length]),before);assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
