// OFFLINE fixtures only: no real credentials, payment, or accounting writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readProcessingFees, processingCharge, processingJournal, wibDay, isoDay } from '../src/server/xenditProcessingFees.ts';
import { createProcessingFeeSync, PROCESSING_ACK } from '../src/server/accurateProcessingFees.ts';
import { matchesFeeJournal } from '../src/server/accurateFeePosting.ts';
import { createAccurateSync } from '../src/server/accurateSync.ts';
class DB {
  data = new Map(); created = new Map(); writes = []; queue = Promise.resolve(); retryOnce = false; failCommit = false;
  constructor(clock) { this.clock = clock; }
  collection(name) {
    const make = (filters = [], take = Infinity, order = null) => ({ name, filters, take, order,
      where: (k, op, v) => make([...filters, [k, op, v]], take, order), limit: n => make(filters, n, order), orderBy: (k, dir = 'asc') => make(filters, take, [k, dir]),
      get: () => this.read(make(filters, take, order)),
      doc: id => ({ name, id, path: `${name}/${id}`, get: () => this.read({ name, id }) }),
    }); return make();
  }
  seed(path, value, at = this.clock()) { this.data.set(path, structuredClone(value)); this.created.set(path, at); }
  snap(name, id, value) { return { id, exists: value !== undefined, data: () => structuredClone(value), ref: this.collection(name).doc(id), createTime: { toMillis: () => this.created.get(`${name}/${id}`) || this.clock() } }; }
  async read(ref) {
    if (ref.id) return this.snap(ref.name, ref.id, this.data.get(`${ref.name}/${ref.id}`));
    let rows = [...this.data].filter(([path, v]) => path.startsWith(`${ref.name}/`) && ref.filters.every(([k, op, e]) => op === '==' ? v[k] === e : op === '<=' ? v[k] <= e : false));
    if (ref.order) { const [k, dir] = ref.order; rows.sort((a, b) => (a[1][k] < b[1][k] ? -1 : a[1][k] > b[1][k] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const docs = rows.slice(0, ref.take).map(([path, v]) => this.snap(ref.name, path.slice(ref.name.length + 1), v));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
  async runTransaction(fn) {
    let unlock; const previous = this.queue; this.queue = new Promise(r => unlock = r); await previous;
    try {
      const execute = async () => {
        let writing = false; const writes = [];
        const put = (op, ref, value, options) => { writing = true; writes.push({ op, ref, value: structuredClone(value), options }); };
        const value = await fn({ get: ref => { assert.equal(writing, false, 'all reads precede all writes'); return this.read(ref); },
          create: (r, d) => put('create', r, d), update: (r, d) => put('update', r, d), set: (r, d, o) => put('set', r, d, o) });
        return { value, writes };
      };
      if (this.retryOnce) { this.retryOnce = false; await execute(); }
      const { value, writes } = await execute();
      if (this.failCommit) { this.failCommit = false; throw new Error('fixture commit unavailable'); }
      for (const w of writes) {
        assert.ok(!w.ref.name.startsWith('xendit_test'), 'no Test writes');
        if (w.op === 'create') assert.equal(this.data.has(w.ref.path), false, `duplicate create ${w.ref.path}`);
        if (w.op === 'update') assert.ok(this.data.has(w.ref.path));
      }
      for (const w of writes) {
        const data = w.op === 'update' || w.options?.merge ? structuredClone(this.data.get(w.ref.path) || {}) : {};
        for (const [key, value] of Object.entries(w.value)) {
          const parts = key.split('.'); let target = data;
          for (const p of parts.slice(0, -1)) target = target[p] ||= {};
          target[parts.at(-1)] = value;
        }
        this.data.set(w.ref.path, data); if (!this.created.has(w.ref.path)) this.created.set(w.ref.path, this.clock()); this.writes.push(w);
      }
      return value;
    } finally { unlock(); }
  }
}

const NOW = Date.parse('2026-10-23T04:00:00Z');
const env = { XENDIT_LIVE_SECRET_KEY: 'xnd_production_OFFLINE_FIXTURE_NOT_REAL', XENDIT_LIVE_BUSINESS_ID: 'business_fixture_123' };
const fid = '11111111-1111-4111-8111-111111111111', vid = '22222222-2222-4222-8222-222222222222';
function charge(vat=false) { return { id: vat ? vid : fid, type: vat ? 'PROCESSING_FEE_VAT_DEDUCTION' : 'PROCESSING_FEE_DEDUCTION',
  business_id: env.XENDIT_LIVE_BUSINESS_ID, reference_id: '33333333-3333-4333-8333-333333333333',
  product_id: '33333333-3333-4333-8333-333333333333'+(vat?':vat':''), currency:'IDR', net_amount_currency:'IDR',
  amount:vat?880:8000, net_amount:vat?880:8000, cashflow:'MONEY_OUT', status:'SUCCESSFUL', settlement_status:'SETTLED',
  created:'2026-10-22T17:46:00Z', updated:'2026-10-22T17:46:01Z' }; }
const body = rows => ({has_more:false, data:rows, links:[]});
const fetchRows = rows => async (url, init) => {
  assert.equal(new URL(url).origin,'https://api.xendit.co'); assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
  assert.equal(new URL(url).searchParams.has('types'),false); assert.ok(init.signal);
  return Response.json(body(rows));
};
test('actual separate fee + VAT rows total 8880; WIB deduction date, independent identities', async()=>{
 const v=await readProcessingFees('2026-10-22','2026-10-23',{env,clock:()=>NOW,fetch:fetchRows([charge(),charge(true)])});
 assert.equal(v.feeAmount,8000);assert.equal(v.vatAmount,880);assert.equal(v.totalAmount,8880);
 assert.equal(v.charges[0].date,'2026-10-23');
 const a=processingJournal(v.charges[0]),b=processingJournal(v.charges[1]);assert.notEqual(a.key,b.key);
 assert.equal(a.payload.detailJournalVoucher[0].accountNo,'600031');assert.equal(a.payload.detailJournalVoucher[1].accountNo,'110103');
 assert.equal(a.payload.transDate,'23/10/2026');assert.equal(a.payload.detailJournalVoucher[0].amount,8000);
 assert.deepEqual(processingJournal(v.charges[0]),a);
});
for(const [name,change] of [
 ['wrong business',r=>r.business_id='wrong'],['money in',r=>r.cashflow='MONEY_IN'],['wrong type',r=>r.type='PAYMENT'],
 ['foreign currency',r=>r.currency='USD'],['foreign net',r=>r.net_amount_currency='USD'],['negative',r=>r.amount=-8000],
 ['string amount',r=>r.amount='8000'],['extra decimals',r=>r.amount=8000.001],['net mismatch',r=>r.net_amount=7999],
 ['wrong product',r=>r.product_id+=':vat'],['bad identity',r=>r.id='private/provider/body'],
 ['bad date',r=>r.created='not a date'],['missing zone',r=>r.created='2026-10-23T00:46:00'],
 ['changed timestamps',r=>r.updated='2026-10-20T00:00:00Z'],['extra fee',r=>r.fee={xendit_fee:1}],
 ['VAT not final',r=>r.status='PENDING'],['not settled',r=>r.settlement_status='PENDING']]) {
 test('reject '+name,()=>{const r=charge();change(r);assert.throws(()=>processingCharge(r,env.XENDIT_LIVE_BUSINESS_ID));});
}
test('no guesses from successful bookings or zero fee entries', async()=>{
 const payment={...charge(),type:'PAYMENT',amount:160000,net_amount:150010,cashflow:'MONEY_IN'};
 const r=await readProcessingFees('2026-10-23','2026-10-23',{env,clock:()=>NOW,fetch:fetchRows([payment])});
 assert.equal(r.charges.length,0);assert.equal(r.totalAmount,0);
});
test('pagination uses observed cursor, never provider link',async()=>{
 let n=0;const v=await readProcessingFees('2026-10-23','2026-10-23',{env,clock:()=>NOW,fetch:async(url,init)=>{
 assert.equal(init.method,'GET');assert.equal(new URL(url).origin,'https://api.xendit.co');
 if(n++===0)return Response.json({has_more:true,data:[charge()],links:[{href:'https://evil.invalid/secrets'}]});
 assert.equal(new URL(url).searchParams.get('after_id'),fid);return Response.json(body([charge(true)])); }});
 assert.equal(n,2);assert.equal(v.totalAmount,8880);
});
for(const [name,data] of [['duplicate', {has_more:true,data:[charge()],links:[]}],['unknown pagination',{data:[charge()],links:[]}],['bad links',{has_more:false,data:[charge()]}]]){
 test('fail closed '+name,async()=>assert.rejects(()=>readProcessingFees('2026-10-23','2026-10-23',{env,clock:()=>NOW,fetch:async()=>Response.json(data)})));
}
test('bad range, impossible date, future date and Test key rejected before network',async()=>{
 assert.equal(isoDay('2026-02-30'),false);assert.equal(wibDay(Date.parse('2026-10-22T17:00:00Z')),'2026-10-23');
 for(const range of [['2026-09-01','2026-10-23'],['2026-10-24','2026-10-24'],['2026-10-23','2026-10-22']])
 await assert.rejects(()=>readProcessingFees(...range,{env,clock:()=>NOW,fetch:()=>assert.fail('network')}));
 await assert.rejects(()=>readProcessingFees('2026-10-23','2026-10-23',{env:{...env,XENDIT_LIVE_SECRET_KEY:'xnd_development_fixture'},clock:()=>NOW,fetch:()=>assert.fail('network')}));
});
function fixture(){
 let time=NOW, failPost=false, hide=false;const clock=()=>time,db=new DB(clock), control=db.collection('accurate_sync_private').doc('control');
 db.seed(control.path,{schemaVersion:1,databaseId:2974047,enabled:true,taxPolicy:'no_extra_tax',activatedAt:'2026-10-21T00:00:00Z'});
 const remote=new Map(),posts=[],reads=[],provider={connect:async()=>({feeMasters:async()=>{},lookup:async(kind,no)=>{reads.push(no);return hide?null:remote.get(no)||null;},save:async(kind,p)=>{
 posts.push(structuredClone(p));remote.set(p.number,{...structuredClone(p),id:42});if(failPost)throw new Error('network lost after accepted');}})};
 const service=createProcessingFeeSync({db,env,clock,ref:()=>control,configured:()=>true,provider,fetch:fetchRows([charge(),charge(true)]),authorizeManager:async(_,uid)=>{assert.equal(uid,'manager');}});
 return {db,control,service,posts,reads,remote,tick:()=>time+=600000,setFail:()=>failPost=true,setHide:v=>hide=v};
}
const activate=f=>f.service.activate('manager',{fromDate:'2026-10-23',expectedTransactionIds:[fid,vid],acknowledgement:PROCESSING_ACK});
test('activation requires known actual IDs and approval; creates no journal',async()=>{
 const f=fixture();await assert.rejects(()=>f.service.activate('manager',{fromDate:'2026-10-23',expectedTransactionIds:['unknown'],acknowledgement:PROCESSING_ACK}));
 await activate(f);assert.equal(f.posts.length,0);assert.equal((await f.service.status()).enabled,true);
});
test('worker scans then posts each independent debit once; full rescan is idempotent',async()=>{
 const f=fixture();await activate(f);await f.service.runOnce();assert.equal(f.posts.length,0);
 await Promise.all([f.service.runOnce(),f.service.runOnce()]);await f.service.runOnce();
 assert.equal(f.posts.length,2);assert.equal(f.posts.reduce((n,p)=>n+p.detailJournalVoucher[0].amount,0),8880);
 f.tick();await f.service.runOnce();await f.service.runOnce();assert.equal(f.posts.length,2);
 assert.ok((await f.service.status()).jobs.every(r=>r.state==='confirmed'));
 assert.ok([...f.db.data.keys()].every(k=>!['bookings/','payments/','xendit_test'].some(p=>k.startsWith(p))));
});
test('lost POST result never resends; lookup-only reconciliation confirms existing exact journal',async()=>{
 const f=fixture();await activate(f);await f.service.runOnce();f.setFail();await f.service.runOnce();
 const s=await f.service.status(), review=s.jobs.find(r=>r.state==='review');assert.ok(review);assert.equal(f.posts.length,1);
 f.setHide(true);await assert.rejects(()=>f.service.reconcile('manager',review.id));assert.equal(f.posts.length,1);
 f.setHide(false);await f.service.reconcile('manager',review.id);assert.equal(f.posts.length,1);
 assert.equal((await f.service.status()).jobs.find(r=>r.id===review.id).state,'confirmed');
});
test('existing journal mismatch stops without overwrite',async()=>{
 const f=fixture();await activate(f);await f.service.runOnce();const [r]=(await f.service.status()).jobs;
 f.remote.set(r.number,{id:99,number:r.number,transDate:'23/10/2026',description:'manual other purpose',detailJournalVoucher:[]});
 // queue first-created is fee; apply collision to all queued numbers.
 for(const j of (await f.service.status()).jobs)f.remote.set(j.number,{id:99,number:j.number,detailJournalVoucher:[]});
 await f.service.runOnce();assert.equal(f.posts.length,0);assert.ok((await f.service.status()).jobs.some(r=>r.state==='review'));
});
test('pause and global pause block posts; activation date immutable',async()=>{
 const f=fixture();await activate(f);await f.service.runOnce();await f.service.pause('manager');await f.service.runOnce();assert.equal(f.posts.length,0);
 const at=(await f.service.status()).activatedAt;f.tick();await activate(f);assert.equal((await f.service.status()).activatedAt,at);
 f.db.data.get(f.control.path).enabled=false;await f.service.runOnce();assert.equal(f.posts.length,0);
});
test('journal validator rejects changed amount, date, tax account and extra lines',()=>{
 const p=processingJournal(processingCharge(charge(),env.XENDIT_LIVE_BUSINESS_ID)).payload;
 assert.ok(matchesFeeJournal({...p,id:1},p));
 for(const change of [d=>d.transDate='22/10/2026',d=>d.detailJournalVoucher[0].amount=7999,d=>d.detailJournalVoucher[0].accountNo='110504',d=>d.detailJournalVoucher.push({...d.detailJournalVoucher[0]})]){
 const d=structuredClone(p);change(d);assert.equal(matchesFeeJournal(d,p),false);}
});
test('all new endpoints authenticate before any provider read; strict request keys',async()=>{
 const service=createAccurateSync({db:null,env,verify:async()=>{throw Object.assign(new Error(),{code:'auth/invalid-id-token'});},authorizeManager:async()=>assert.fail('authorization')});
 for(const action of ['processingStatus','processingPreview','activateProcessing','pauseProcessing','runProcessing','reconcileProcessing'])
 await assert.rejects(()=>service[action]({headers:{},rawHeaders:[],body:{},ip:'fixture'}),e=>e.code==='AUTH_REQUIRED');
});
