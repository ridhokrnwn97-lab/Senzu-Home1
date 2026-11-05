// No Meta/Firebase/Xendit network calls: exercise the real HTTP client, settings
// normalization, Pixel routing and deduplication using isolated local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';

const result=await build({stdin:{contents:`
  export * from './src/lib/xenditLiveService';
  export * from './src/lib/manualPaidLead';
  export * from './src/lib/metaAdsSettings';
  export * from './src/lib/metaPixel';`,resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'browser',
  plugins:[{name:'fixtures',setup(b){
    b.onResolve({filter:/(^|\/)firebase$/},()=>({path:'firebase',namespace:'fixture'}));
    b.onResolve({filter:/(^|\/)metaAdsService$/},()=>({path:'settings',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),contents:a.path==='firebase'
      ? 'export const auth=fixture.auth;'
      : `import {validateMetaAdsSettings} from '${process.cwd()}/src/lib/metaAdsSettings';
         export async function getMetaAdsSettings(){return validateMetaAdsSettings(fixture.settings);}`}));
  }}]});
const paid=()=>({bookingId:'booking_fixture',referenceId:'shl_'+'a'.repeat(48),amount:160000,currency:'IDR',environment:'live',
  creationState:'ready',sessionStatus:'COMPLETED',paymentStatus:'paid',sessionId:'ps-'+'b'.repeat(24),checkoutUrl:null,
  paidSource:'webhook',reconciliationRequired:false});
function fixture(){
  const calls=[],storage=new Map(),user={uid:'fixture_customer',getIdToken:async()=> 'fixture_token'};
  const f={auth:{currentUser:user},settings:{schemaVersion:1,revision:3,enabled:true,
    pixels:[{id:'pixel',name:'Fixture Pixel',pixelId:'123456789012',enabled:true}],events:[
      {id:'old_lead',trigger:'payment_confirmation_or_proof',kind:'standard',eventName:'Lead',pixelIds:'all',enabled:true},
      {id:'cart',trigger:'booking_submitted',kind:'standard',eventName:'AddToCart',pixelIds:'all',enabled:true}]},response:paid()};
  const fbq=(...args)=>calls.push(args);fbq.callMethod=fbq;
  const sandbox={fixture:f,module:{exports:{}},TextEncoder,crypto:webcrypto,setTimeout,clearTimeout,
    window:{fbq},document:{},navigator:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture_token');
      return{ok:true,json:async()=>url==='/api/payments/lookup'?f.manualResponse:{success:true,session:f.response}};}};
  vm.runInNewContext(result.outputFiles[0].text,sandbox);
  return{api:sandbox.module.exports,f,calls,sandbox,leads:()=>calls.filter(c=>c[0]==='trackSingle'&&c[2]==='Lead')};
}
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));};
test('saved/default Lead rules move to verified Live payment; preserve opt-out, targets and other events',()=>{
  const{api,f}=fixture();f.settings.events[0].enabled=false;f.settings.events[0].pixelIds=['pixel'];
  const normalized=api.validateMetaAdsSettings(f.settings);
  assert.equal(normalized.events[0].trigger,'xendit_live_paid');assert.equal(normalized.events[0].enabled,false);
  assert.deepEqual(Array.from(normalized.events[0].pixelIds),['pixel']);assert.equal(normalized.events[1].trigger,'booking_submitted');
  assert.equal(api.defaultMetaAdsSettings().events[1].trigger,'payment_verified');
});
test('WA, proof and submitted booking cannot fire Lead; AddToCart still works',async()=>{
  const{api,leads,calls}=fixture();
  for(const action of ['payment_confirmation_clicked','payment_proof_submitted','booking_submitted'])
    await api.trackMetaAdsAction(action,{entityId:'booking_fixture',value:160000});
  assert.equal(leads().length,0);assert.equal(calls.filter(c=>c[2]==='AddToCart').length,1);
});
test('verified webhook status sends standard Lead once across concurrent poll, refresh and create responses',async()=>{
  const{api,leads}=fixture();await Promise.all([api.readLivePayment('booking_fixture'),api.readLivePayment('booking_fixture'),api.checkLivePayment('booking_fixture'),api.createLivePayment('booking_fixture')]);
  await flush();assert.equal(leads().length,1);assert.equal(leads()[0][1],'123456789012');
  assert.match(leads()[0][4].eventID,/^sh_[a-f0-9]{64}$/);assert.deepEqual(Object.keys(leads()[0][3]),[]);
});
test('pending, expired, canceled, uncertain, reviewed and unverified completion cannot send Lead',async()=>{
  for(const patch of [{sessionStatus:'ACTIVE',paymentStatus:'pending'},{sessionStatus:'EXPIRED'},
    {sessionStatus:'CANCELED'},{creationState:'uncertain'},{reconciliationRequired:true},{paidSource:null},{sessionId:null},{paymentStatus:'unpaid'}]){
    const{api,f,leads}=fixture();f.response={...paid(),...patch};await api.readLivePayment('booking_fixture');await flush();assert.equal(leads().length,0,JSON.stringify(patch));
  }
});
test('Test, foreign booking and invalid responses fail before analytics; Manager inspection/recovery never tracks',async()=>{
  for(const patch of [{environment:'test'},{bookingId:'someone_else'},{amount:1},{referenceId:'test_session'}]){
    const{api,f,leads}=fixture();f.response={...paid(),...patch};await assert.rejects(api.readLivePayment('booking_fixture'));await flush();assert.equal(leads().length,0);
  }
  const{api,leads}=fixture();await api.inspectLivePayment('booking_fixture');await api.recoverLivePayment('booking_fixture',paid().sessionId);await flush();assert.equal(leads().length,0);
});
test('API-verified paid and recovery status can track on customer read; disabled settings, pixel, rule and privacy opt-out remain respected',async()=>{
  for(const source of ['check','recovery','create']){const{api,f,leads}=fixture();f.response.paidSource=source;await api.readLivePayment('booking_fixture');await flush();assert.equal(leads().length,1);}
  for(const disable of [x=>x.f.settings.enabled=false,x=>x.f.settings.pixels[0].enabled=false,x=>x.f.settings.events[0].enabled=false,x=>x.sandbox.navigator.doNotTrack='1']){
    const x=fixture();disable(x);await x.api.readLivePayment('booking_fixture');await flush();assert.equal(x.leads().length,0);
  }
});
test('account switch and analytics failure do not emit wrong-account Lead or block payment reads',async()=>{
  const x=fixture();x.sandbox.fetch=async()=>{x.f.auth.currentUser={uid:'other'};return{ok:true,json:async()=>({success:true,session:paid()})};};
  await assert.rejects(x.api.readLivePayment('booking_fixture'));await flush();assert.equal(x.leads().length,0);
  const y=fixture();y.f.settings={};assert.equal((await y.api.readLivePayment('booking_fixture')).paymentStatus,'paid');await flush();assert.equal(y.leads().length,0);
});

const manualResponse=()=>({success:true,
  payment:{id:'PAY-booking_fixture',bookingId:'booking_fixture',status:'paid',paymentType:'manual',amount:200000},
  manualPaidLead:{schemaVersion:1,source:'staff_verified_manual',bookingId:'booking_fixture',paymentId:'PAY-booking_fixture',
    amount:200000,currency:'IDR',verifiedAt:'2026-11-01T02:00:00.000Z'}});
test('manual and combined Lead triggers survive saving; existing Live-only rules stay Live-only',()=>{
  const{api,f}=fixture();
  for(const trigger of ['manual_payment_verified','payment_verified','xendit_live_paid']){
    f.settings.events[0].trigger=trigger;
    assert.equal(api.validateMetaAdsSettings(f.settings).events[0].trigger,trigger);
  }
});
test('manual Lead requires an authenticated server receipt; old backend, pending proof and failed lookup send nothing',async()=>{
  for(const patch of [undefined,{success:true,payment:{status:'paid'}},{success:true,payment:{status:'pending_manual_verification'},manualPaidLead:null},
    {success:false}, {...manualResponse(),manualPaidLead:{...manualResponse().manualPaidLead,bookingId:'foreign'}},
    {...manualResponse(),payment:{...manualResponse().payment,amount:1}}]){
    const{api,f,leads}=fixture();f.settings.events[0].trigger='payment_verified';f.manualResponse=patch;
    await api.trackVerifiedManualPayment('booking_fixture');assert.equal(leads().length,0);
  }
});
test('verified manual payment sends one Lead per Pixel and booking across repeat reads and both paid rules',async()=>{
  const{api,f,leads}=fixture();f.settings.events[0].trigger='payment_verified';f.manualResponse=manualResponse();
  f.settings.events.push({...f.settings.events[0],id:'manual_duplicate',trigger:'manual_payment_verified'});
  await Promise.all([api.trackVerifiedManualPayment('booking_fixture'),api.trackVerifiedManualPayment('booking_fixture')]);
  assert.equal(leads().length,1);assert.deepEqual(Object.keys(leads()[0][3]),[]);
  await api.readLivePayment('booking_fixture');await flush();assert.equal(leads().length,1,'paid method/rule changes retain the existing dedup ID');
  for(const action of ['booking_submitted','payment_proof_submitted','payment_confirmation_clicked','payment_verified']){
    await api.trackMetaAdsAction(action,{entityId:'another_booking'});
  }
  assert.equal(leads().length,1,'combined trigger cannot be dispatched as an unverified action');
});
test('manual-only and Live-only Lead rules do not leak across payment sources',async()=>{
  const x=fixture();x.f.manualResponse=manualResponse();
  await x.api.trackVerifiedManualPayment('booking_fixture');assert.equal(x.leads().length,0);
  x.f.settings.events[0].trigger='manual_payment_verified';
  await x.api.readLivePayment('booking_fixture');await flush();assert.equal(x.leads().length,0);
  await x.api.trackVerifiedManualPayment('booking_fixture');assert.equal(x.leads().length,1);
});
test('manual tracking respects privacy, disabled config, account switch, page unmount and lookup errors',async()=>{
  for(const change of [x=>x.f.settings.enabled=false,x=>x.f.settings.pixels[0].enabled=false,
    x=>x.f.settings.events[0].enabled=false,x=>x.sandbox.navigator.doNotTrack='1',
    x=>x.sandbox.fetch=async()=>{x.f.auth.currentUser={uid:'other'};return{ok:true,json:async()=>manualResponse()};},
    x=>x.sandbox.fetch=async()=>{throw new Error('offline');}]){
    const x=fixture();x.f.settings.events[0].trigger='payment_verified';x.f.manualResponse=manualResponse();change(x);
    await x.api.trackVerifiedManualPayment('booking_fixture');assert.equal(x.leads().length,0);
  }
  const y=fixture();y.f.settings.events[0].trigger='payment_verified';y.f.manualResponse=manualResponse();
  await y.api.trackVerifiedManualPayment('booking_fixture',()=>false);assert.equal(y.leads().length,0);
  let current=true;y.sandbox.fetch=async()=>{current=false;return{ok:true,json:async()=>manualResponse()};};
  await y.api.trackVerifiedManualPayment('booking_fixture',()=>current);assert.equal(y.leads().length,0);
});
