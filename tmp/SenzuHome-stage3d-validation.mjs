import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve(process.cwd(), 'package.json'));
const ts=require('typescript'),esbuild=require('esbuild');
const root=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:process.cwd();
const before=process.argv.includes('--before');
function parse(file){return ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)}
function walk(n,fn){fn(n);ts.forEachChild(n,c=>walk(c,fn))}
const server=parse('server.ts'),clientSource=parse('src/lib/crmService.ts');
let serverFn,clientFn,upsertFn;
walk(server,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(server)==='app'&&n.expression.name.text==='post'&&ts.isArrayLiteralExpression(n.arguments[0])&&n.arguments[0].elements.some(e=>ts.isStringLiteral(e)&&e.text==='/api/customers/recompute'))serverFn=n.arguments[1].getText(server)});
walk(clientSource,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='recomputeCustomerProfile')clientFn=n.getText(clientSource);if(ts.isFunctionDeclaration(n)&&n.name?.text==='upsertCustomerFromBooking')upsertFn=n.getText(clientSource)});
assert.ok(serverFn);assert.ok(clientFn);assert.ok(upsertFn);
const transpile=(code)=>esbuild.transformSync(code,{loader:'ts',target:'node24'}).code;
const quiet={log(){},warn(){},error(){}};
let passed=0;function pass(s){passed++;console.log('PASS '+s)}
const settings={repeatMinBookings:2,activeDays:60,atRiskDays:90,inactiveDays:90,highValueSpend:1000000,highValueBookings:5};
function fixture(){
 const records=new Map([
  ['customers/crm_A',{id:'crm_A',authUserId:'auth_A',name:'A fixture',phone:'shared-fixture-phone',status:'active',rewardPoints:21,defaultAddress:'A fixture address',customerSegment:'NEW'}],
  ['customers/crm_B',{id:'crm_B',authUserId:'auth_B',name:'B fixture',phone:'B-fixture-phone',status:'active',rewardPoints:50}],
  ['customers/unowned',{id:'unowned',name:'Unowned fixture',phone:'unowned-phone'}],
  ['crm_settings/general',{...settings}],
  ['bookings/b_A1',{id:'b_A1',customerId:'crm_A',authUserId:'auth_A',customerAuthUid:'auth_A',customerWhatsApp:'shared-fixture-phone',status:'Completed',paymentStatus:'paid',totalAmount:100000,serviceDuration:60,serviceId:'s1',serviceName:'Service 1',therapistId:'t1',therapistName:'T1',scheduleDate:'2026-10-01',scheduleTime:'10:00',createdAt:'2026-10-01T10:00:00.000Z'}],
  ['bookings/b_A2',{id:'b_A2',customerId:'crm_A',authUserId:'auth_A',customerAuthUid:'auth_A',customerWhatsApp:'shared-fixture-phone',status:'Completed',paymentStatus:'PAID',totalAmount:300000,serviceDuration:90,serviceId:'s1',serviceName:'Service 1',therapistId:'t1',therapistName:'T1',scheduleDate:'2026-10-07',scheduleTime:'10:00',createdAt:'2026-10-07T10:00:00.000Z'}],
  ['bookings/b_cancel',{id:'b_cancel',customerId:'crm_A',authUserId:'auth_A',customerWhatsApp:'shared-fixture-phone',status:'Cancelled',totalAmount:99999,createdAt:'2026-10-08T10:00:00.000Z'}],
  ['bookings/b_B',{id:'b_B',customerId:'crm_B',authUserId:'auth_B',customerAuthUid:'auth_B',customerWhatsApp:'shared-fixture-phone',status:'Completed',paymentStatus:'paid',totalAmount:500000,serviceDuration:120,serviceId:'sB',serviceName:'B Service',therapistId:'tB',therapistName:'TB',scheduleDate:'2026-10-10',scheduleTime:'10:00',createdAt:'2026-10-10T10:00:00.000Z'}],
  ['reviews/r1',{customerId:'crm_A',overallRating:5,status:'published'}],
  ['reviews/r2',{customerId:'crm_A',overallRating:3,status:'published'}],
  ['reviews/r3',{customerId:'crm_A',overallRating:1,status:'hidden'}],
 ]);
 for(const role of ['css','supervisor','manager','admin','therapist','staff'])records.set('staff_roles/staff_'+role,{role,isActive:true,authUserId:'staff_'+role,status:'active'});
 const state={records,versions:new Map([...records.keys()].map(k=>[k,1])),writes:[],reads:[],verified:[],logs:[],restCalls:0,dbFailure:false,commitFailure:false,transactionStart:null,retryMutation:null,attempts:0};
 const clone=d=>d===undefined?undefined:structuredClone(d);
 const version=n=>({_fixtureVersion:n,isEqual(other){return other?._fixtureVersion===n}});
 function snap(key){const d=clone(records.get(key));return {id:key.split('/').at(-1),ref:ref(key),exists:d!==undefined,updateTime:d!==undefined?version(state.versions.get(key)||1):undefined,data:()=>clone(d)}}
 function apply(r,d,merge=true){assert.ok(records.has(r.key)||!merge);state.writes.push({key:r.key,data:clone(d)});records.set(r.key,merge?{...records.get(r.key),...clone(d)}:clone(d));state.versions.set(r.key,(state.versions.get(r.key)||0)+1)}
 function ref(key){return {kind:'doc',key,async get(){state.reads.push(key);if(state.dbFailure)throw new Error('Fixture DB unavailable');return snap(key)},async set(d,opts){apply(this,d,!!opts?.merge)}}}
 function query(col,filters=[]){return {kind:'query',col,doc:id=>ref(col+'/'+id),where:(f,op,v)=>{assert.equal(op,'==');return query(col,[...filters,[f,v]])},async get(){state.reads.push(col);if(state.dbFailure)throw new Error('Fixture DB unavailable');const docs=[...records].filter(([k,d])=>k.startsWith(col+'/')&&filters.every(([f,v])=>d[f]===v)).map(([k])=>snap(k));return {docs,empty:docs.length===0,forEach:fn=>docs.forEach(fn)}}}}
 const adminDb={collection:col=>query(col),async runTransaction(cb){if(state.transactionStart){const hook=state.transactionStart;state.transactionStart=null;hook()}for(let i=0;i<2;i++){state.attempts++;const writes=[];const t={async get(r){assert.equal(writes.length,0,'All native transaction reads precede writes');return r.get()},update:(r,d)=>writes.push({r,d:clone(d)})};const result=await cb(t);if(writes.length&&state.retryMutation){const hook=state.retryMutation;state.retryMutation=null;hook();continue}if(state.commitFailure)throw new Error('Fixture commit unavailable');for(const w of writes)apply(w.r,w.d);return result}throw new Error('Fixture retries exhausted')}};
 const adminAuth={async verifyIdToken(token){state.verified.push(token);if(token==='valid_A')return {uid:'auth_A',role:'admin',email:'manager-fixture@example.test'};if(token==='valid_B')return {uid:'auth_B'};if(token.startsWith('valid_staff_'))return {uid:token.slice('valid_'.length)};if(token==='missing_uid')return {};if(token==='invalid_uid_type')return {uid:42};throw new Error('Fixture rejected token')}};
 const Clock=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-12T00:00:00.000Z']))}static now(){return new Date('2026-10-12T00:00:00.000Z').getTime()}};
 const env={adminDb,adminAuth,Buffer,Date:Clock,console:quiet,db:{},ensureServerAuthenticated:async()=>{},emitStructuredLog:l=>state.logs.push(clone(l)),
  doc:(_db,col,id)=>ref(col+'/'+id),collection:(_db,col)=>query(col),where:(f,op,v)=>q=>q.where(f,op,v),query:(q,...filters)=>filters.reduce((q,f)=>f(q),q),
  getDoc:async r=>{const s=await r.get();return {...s,exists:()=>s.exists}},getDocs:async q=>{const s=await q.get();return {...s,docs:s.docs.map(d=>({...d,exists:()=>d.exists}))}},setDoc:(r,d,opts)=>r.set(d,opts),
 };
 const actual=new Function(...Object.keys(env),transpile('return ('+serverFn+');'))(...Object.values(env));
 async function call(body={customerId:'crm_A'},token='valid_A',params={}){
  const req={headers:token===null?{}:{authorization:token.startsWith('Bearer ')||token.startsWith('Basic ')?token:'Bearer '+token},body,params};
  const res={statusCode:200,body:null,status(n){this.statusCode=n;return this},json(d){this.body=d;return this}};
  await actual(req,res);return res;
 }
 function change(key,data){records.set(key,{...records.get(key),...data});state.versions.set(key,(state.versions.get(key)||0)+1)}
 return {state,call,change};
}
function front(options={}){
 const s={auth:{currentUser:options.noSession?null:{uid:'auth_A',getIdToken:async()=> 'valid_A'}},requests:[],directWrites:[],fetchHook:null,jsonHook:null};
 const profile={id:'crm_A',authUserId:'auth_A',name:'A fixture',phone:'fixture',normalizedPhone:'fixture',status:'active'};
 const env={auth:s.auth,console:quiet,db:{},getCrmSettings:async()=>settings,evaluateCustomerSegment:()=> 'NEW',isPaymentPaid:status=>status==='paid',cleanFirestoreData:d=>d,
  fetch:async(url,opts)=>{s.requests.push({url,headers:opts.headers,body:JSON.parse(opts.body)});if(s.fetchHook)return s.fetchHook();return {ok:options.status===undefined||options.status===200,status:options.status||200,json:async()=>s.jsonHook?s.jsonHook():({success:options.success!==false,customer:options.noCustomer?undefined:profile})}},
  doc:()=>({}),collection:()=>({}),query:()=>({}),where:()=>({}),getDoc:async()=>({exists:()=>true,data:()=>structuredClone(profile)}),getDocs:async()=>({docs:[],forEach(){}}),setDoc:async(_r,d)=>s.directWrites.push(d),
 };
 const code=transpile(clientFn.replace('export async function','async function')+'\nreturn recomputeCustomerProfile;');
 const actual=new Function(...Object.keys(env),code)(...Object.values(env));
 return {s,actual,profile};
}
if(before){
 {const f=fixture(),r=await f.call({customerId:'crm_B'},null);assert.equal(r.statusCode,200);assert.equal(f.state.writes[0].key,'customers/crm_B');console.log('CONFIRMED BEFORE unauthenticated caller recomputes and receives another CRM profile')}
 {const f=fixture(),r=await f.call({customerId:'crm_B'},'invalid');assert.equal(r.statusCode,200);assert.equal(f.state.verified.length,0);console.log('CONFIRMED BEFORE invalid Bearer token is never checked')}
 {const f=fixture(),r=await f.call({customerId:'crm_B'},'valid_A',{id:'crm_A'});assert.equal(r.statusCode,200);assert.equal(f.state.writes[0].key,'customers/crm_B');console.log('CONFIRMED BEFORE body ID overrides conflicting path ID')}
 {const f=front({status:403});await f.actual('crm_A');assert.equal(f.s.directWrites.length,1);console.log('CONFIRMED BEFORE denied server request attempts direct client recomputation/write')}
 process.exit(0);
}
for(const token of [null,'Basic fixture','Bearer ','Bearer a b','invalid','expired','wrong-project','missing_uid','invalid_uid_type']){const f=fixture(),r=await f.call({customerId:'crm_B'},token);assert.equal(r.statusCode,401);assert.equal(f.state.writes.length,0);assert.equal(f.state.reads.length,0);pass(String(token)+' denied before any database access')}
for(const role of ['css','supervisor','manager','admin']){const f=fixture(),r=await f.call({customerId:'crm_B'},'valid_staff_'+role);assert.equal(r.statusCode,200);assert.equal(r.body.customer.totalSpend,500000);assert.equal(f.state.writes.length,1);assert.equal(f.state.logs.length,1);pass('Active '+role+' may recompute CRM through current authoritative role')}
for(const role of ['therapist','staff']){const f=fixture(),r=await f.call({customerId:'crm_B',role:'manager'},'valid_staff_'+role);assert.equal(r.statusCode,403);assert.equal(f.state.writes.length,0);pass(role+' cannot gain cross-customer CRM scope through body role')}
for(const edit of [d=>d.isActive=false,d=>d.isActive=undefined,d=>d.status='archived',d=>d.status='disabled',d=>d.authUserId='foreign_uid',d=>d.authUid='foreign_uid',d=>d.authUserId=0,d=>d.role='therapist']){const f=fixture();edit(f.state.records.get('staff_roles/staff_manager'));const r=await f.call({customerId:'crm_B',role:'admin'},'valid_staff_manager');assert.equal(r.statusCode,403);assert.equal(f.state.writes.length,0);pass('Inactive/conflicting/malformed role record fails closed')}
{const f=fixture(),r=await f.call({customerId:'crm_A'});assert.equal(r.statusCode,200);const c=r.body.customer;assert.equal(c.totalBookings,3);assert.equal(c.completedBookings,2);assert.equal(c.cancelledBookings,1);assert.equal(c.totalSpend,400000);assert.equal(c.averageOrderValue,200000);assert.equal(c.totalTreatmentMinutes,150);assert.equal(c.averageRating,4);assert.equal(c.totalReviews,2);assert.equal(c.customerSegment,'REPEAT');assert.equal(c.favoriteServiceId,'s1');assert.equal(c.favoriteTherapistId,'t1');assert.equal(c.authUserId,'auth_A');assert.equal(c.status,'active');assert.equal(c.rewardPoints,21);assert.equal(c.defaultAddress,'A fixture address');assert.ok(!('authUserId' in f.state.writes[0].data));assert.ok(!('name' in f.state.writes[0].data));assert.ok(!('status' in f.state.writes[0].data));pass('Owned customer recomputes identical formulas only from owned bookings, preserves profile/identity')}
{const f=fixture();f.state.records.get('customers/crm_A').customerSegment='VIP';f.state.records.get('customers/crm_A').vipSource='manual';const r=await f.call({customerId:'crm_A'});assert.equal(r.body.customer.customerSegment,'VIP');pass('Existing manually assigned VIP behavior preserved')}
for(const id of ['crm_B','unowned','auth_A','missing']){const f=fixture();if(id==='auth_A')f.state.records.set('customers/auth_A',{authUserId:'auth_B'});const r=await f.call({customerId:id,authUserId:'auth_B',staffAuthUid:'staff_manager',role:'admin'});assert.equal(r.statusCode,403);assert.equal(f.state.writes.length,0);assert.equal(f.state.logs.length,0);assert.ok(!JSON.stringify(r.body).includes('B-fixture-phone'));pass('Customer denied foreign/unowned/UID-looking/missing CRM target: '+id)}
{const f=fixture();f.state.records.get('customers/crm_A').customerAuthUid='auth_B';const r=await f.call({customerId:'crm_A'});assert.equal(r.statusCode,403);assert.equal(f.state.writes.length,0);pass('Conflicting profile owner UIDs cannot be authorized')}
for(const variant of ['canonical_only','legacy_only','foreign_canonical','foreign_legacy','conflicting_uids','unowned']){const f=fixture();const extra={...f.state.records.get('bookings/b_A1'),id:'b_extra',totalAmount:10000};if(variant==='canonical_only')delete extra.authUserId;if(variant==='legacy_only')delete extra.customerAuthUid;if(variant==='foreign_canonical')extra.customerAuthUid='auth_B';if(variant==='foreign_legacy')extra.authUserId='auth_B';if(variant==='conflicting_uids'){extra.customerAuthUid='auth_B';extra.authUserId='auth_A'}if(variant==='unowned'){delete extra.customerAuthUid;delete extra.authUserId}f.state.records.set('bookings/b_extra',extra);const r=await f.call();assert.equal(r.statusCode,200);assert.equal(r.body.customer.totalSpend,['canonical_only','legacy_only'].includes(variant)?410000:400000);pass('Customer booking aggregate scope handles '+variant+' safely')}
{const f=fixture(),r=await f.call({},'valid_A',{id:'crm_A'});assert.equal(r.statusCode,200);pass('Existing path-ID route alias works with verified owner')}
{const f=fixture(),r=await f.call({customerId:'crm_A'},'valid_A',{id:'crm_A'});assert.equal(r.statusCode,200);pass('Consistent body and path IDs accepted')}
{const f=fixture(),r=await f.call({customerId:'crm_B'},'valid_staff_manager',{id:'crm_A'});assert.equal(r.statusCode,400);assert.equal(f.state.writes.length,0);assert.equal(f.state.reads.length,0);pass('Body/path mismatch cannot redirect an authorized request')}
for(const id of [undefined,null,42,{},'',' ', 'x/y','x'.repeat(1501)]){const f=fixture(),r=await f.call({customerId:id});assert.equal(r.statusCode,400);assert.equal(f.state.writes.length,0);assert.equal(f.state.reads.length,0);pass('Malformed/missing CRM ID rejected before database access')}
{const f=fixture(),r=await f.call({customerId:'missing'},'valid_staff_css');assert.equal(r.statusCode,404);assert.equal(f.state.writes.length,0);pass('Authorized staff retain legitimate not-found response')}
for(const phase of ['transactionStart','retryMutation']){for(const change of ['owner','role','contact']){const f=fixture();const caller=change==='role'?'valid_staff_manager':'valid_A';f.state[phase]=()=>{if(change==='owner')f.change('customers/crm_A',{authUserId:'auth_B'});if(change==='role')f.change('staff_roles/staff_manager',{isActive:false});if(change==='contact')f.change('customers/crm_A',{status:'DELETION_REQUESTED',defaultAddress:'Changed address'})};const r=await f.call({customerId:'crm_A'},caller);assert.equal(r.statusCode,change==='contact'?409:403);assert.equal(f.state.writes.length,0);assert.equal(f.state.logs.length,0);if(change==='contact'){assert.equal(f.state.records.get('customers/crm_A').status,'DELETION_REQUESTED');assert.equal(f.state.records.get('customers/crm_A').defaultAddress,'Changed address')}pass(phase+' rechecks '+change+' and refuses stale/unauthorized mutation')}}
for(const flag of ['dbFailure','commitFailure']){const f=fixture();f.state[flag]=true;const r=await f.call({customerId:'crm_A'});assert.equal(r.statusCode,500);assert.equal(f.state.writes.length,0);assert.equal(f.state.logs.length,0);pass(flag+' fails without writes or success audit')}
{const f=fixture(),r=await f.call({customerId:'crm_A',totalSpend:9999999,customerSegment:'VIP',authUserId:'auth_B'});assert.equal(r.statusCode,200);assert.equal(r.body.customer.totalSpend,400000);assert.equal(r.body.customer.customerSegment,'REPEAT');assert.equal(r.body.customer.authUserId,'auth_A');pass('Body metric/status/identity overrides never influence recomputation')}

const tick=()=>new Promise(r=>setTimeout(r,0));
{const f=front({noSession:true}),r=await f.actual('crm_A');assert.equal(r,null);assert.equal(f.s.requests.length,0);assert.equal(f.s.directWrites.length,0);pass('No browser session: optional recompute returns null, no request or direct write')}
{const f=front(),r=await f.actual('crm_A');assert.equal(r.id,'crm_A');assert.equal(f.s.requests[0].headers.Authorization,'Bearer valid_A');assert.deepEqual(f.s.requests[0].body,{customerId:'crm_A'});assert.equal(f.s.directWrites.length,0);pass('Frontend forwards actual current-session token and preserves success contract')}
for(const status of [401,403,404,409,429,500,503]){const f=front({status}),r=await f.actual('crm_A');assert.equal(r,null);assert.equal(f.s.directWrites.length,0);pass('Frontend HTTP '+status+' never becomes a direct Firestore mutation')}
for(const mode of ['throw','empty','network','bad-json','unsuccessful','no-customer']){const f=front({success:mode!=='unsuccessful',noCustomer:mode==='no-customer'});if(mode==='throw')f.s.auth.currentUser.getIdToken=async()=>{throw new Error('Fixture token failure')};if(mode==='empty')f.s.auth.currentUser.getIdToken=async()=>'';if(mode==='network')f.s.fetchHook=async()=>{throw new Error('Fixture offline')};if(mode==='bad-json')f.s.jsonHook=()=>{throw new Error('Fixture JSON failure')};const r=await f.actual('crm_A');assert.equal(r,null);assert.equal(f.s.directWrites.length,0);pass('Frontend '+mode+' fails safely with existing nullable return contract')}
{const f=front();let resolve;f.s.auth.currentUser.getIdToken=()=>new Promise(r=>resolve=r);const p=f.actual('crm_A');await tick();f.s.auth.currentUser={uid:'auth_B'};resolve('valid_A');assert.equal(await p,null);assert.equal(f.s.requests.length,0);pass('Account change while retrieving token blocks stale request')}
{const f=front();let resolve;f.s.fetchHook=()=>new Promise(r=>resolve=r);const p=f.actual('crm_A');await tick();f.s.auth.currentUser={uid:'auth_B'};resolve({ok:true,json:async()=>({success:true,customer:f.profile})});assert.equal(await p,null);assert.equal(f.s.directWrites.length,0);pass('Late successful A response cannot become B customer profile')}
{const f=front();f.s.jsonHook=()=>{f.s.auth.currentUser=null;return {success:true,customer:f.profile}};assert.equal(await f.actual('crm_A'),null);pass('Logout while parsing response discards old profile')}
{const f=front({noSession:true});const existing={...f.profile,defaultAddress:'Fixture existing address'};const updates=[];const env={Date,console:quiet,normalizeIndonesianPhone:()=>({normalizedPhone:'+62000000',cleanDigits:'62000000'}),findCustomerByPhoneOrEmail:async()=>existing,doc:()=>({}),db:{},getCrmSettings:async()=>settings,updateDoc:async(_r,d)=>updates.push(d),cleanFirestoreData:d=>d,recomputeCustomerProfile:f.actual};const actual=new Function(...Object.keys(env),transpile(upsertFn.replace('export async function','async function')+'\nreturn upsertCustomerFromBooking;'))(...Object.values(env));const result=await actual({customerWhatsApp:'fixture',customerEmail:'fixture@example.test'});assert.deepEqual(result,existing);assert.equal(updates.length,1);assert.equal(f.s.requests.length,0);pass('Actual existing-booking upsert caller retains existing profile when optional guest recompute returns null')}
const baselineArg=process.argv.find(arg=>arg.startsWith('--baseline-root='));
if(baselineArg){
 const baselineRoot=baselineArg.slice('--baseline-root='.length);
 const originalSource=ts.createSourceFile('original-server.ts',fs.readFileSync(path.join(baselineRoot,'server.ts'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let originalFn;
 walk(originalSource,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(originalSource)==='app'&&n.expression.name.text==='post'&&ts.isArrayLiteralExpression(n.arguments[0])&&n.arguments[0].elements.some(e=>ts.isStringLiteral(e)&&e.text==='/api/customers/recompute'))originalFn=n.arguments[1].getText(originalSource)});
 assert.ok(originalFn);
 const patchedFn=serverFn;
 for(const mode of ['normal','manual-vip','legacy-unowned-booking','unpaid-completed']){
  serverFn=originalFn;const original=fixture();serverFn=patchedFn;const patched=fixture();
  for(const f of [original,patched]){
   if(mode==='manual-vip'){f.state.records.get('customers/crm_A').customerSegment='VIP';f.state.records.get('customers/crm_A').vipSource='manual'}
   if(mode==='legacy-unowned-booking'){const b={...f.state.records.get('bookings/b_A1'),id:'b_legacy',totalAmount:88888};delete b.authUserId;delete b.customerAuthUid;f.state.records.set('bookings/b_legacy',b)}
   if(mode==='unpaid-completed')f.state.records.get('bookings/b_A2').paymentStatus='UNPAID';
  }
  const a=await original.call({customerId:'crm_A'},'valid_staff_manager');const b=await patched.call({customerId:'crm_A'},'valid_staff_manager');
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.deepEqual(b.body.customer,a.body.customer);
  pass('Exact original-vs-patched calculation parity for authorized staff: '+mode);
 }
 serverFn=patchedFn;
}
console.log('TOTAL '+passed+' actual-handler/caller runtime fixture cases passed; mocked Admin SDK, no live Firebase/rules/device/production changes.');
