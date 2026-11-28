// Offline FAT payment-proof contract tests: real Express routing, fake authorizer and fake Firestore.
// The fixtures mirror the base64 data URLs written by src/server/paymentAcceptance.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createFatPaymentProofHandler, hasFatPaymentProof, parseFatPaymentProof } from '../src/server/fatPaymentProof.ts';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const png = dataUrl('image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 1]));
const jpeg = dataUrl('image/jpeg', Buffer.from([255, 216, 255, 224, 0, 1]));
const pdf = dataUrl('application/pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'));

function fakeDb(records = new Map()) {
  const reads = [];
  return {
    reads,
    collection(name) {
      assert.equal(name, 'payments', 'proof lookup may read only the payments collection');
      return {
        doc(id) {
          return {
            get: async () => {
              reads.push(id);
              const data = records.get(id);
              return { exists: data !== undefined, data: () => data };
            },
            set: () => assert.fail('no writes allowed'),
            update: () => assert.fail('no writes allowed'),
            delete: () => assert.fail('no writes allowed'),
          };
        },
      };
    },
  };
}
const allow = async () => ({ uid: 'fat-actor' });
const denied = (status, code) => Object.assign(new Error('akses ditolak'), { status, code });

async function withApp(deps, fn) {
  const app = express();
  app.get('/api/fat/payments/:paymentId/proof', createFatPaymentProofHandler(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn(origin); } finally { await new Promise(resolve => server.close(resolve)); }
}
const getProof = (origin, id) => fetch(`${origin}/api/fat/payments/${id}/proof`, {
  headers: { Authorization: 'Bearer offline-fat-token' },
});

test('1. image proof is returned verbatim from the single payment document', async () => {
  for (const [name, proofUrl, mimeType] of [['png', png, 'image/png'], ['jpeg', jpeg, 'image/jpeg']]) {
    const db = fakeDb(new Map([['PAY-1', { paymentProofUrl: proofUrl, customerEmail: 'secret@example.com', amount: 123 }]]));
    await withApp({ authorizeReadActor: allow, db }, async origin => {
      const res = await getProof(origin, 'PAY-1');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(await res.clone().json()).sort(), ['mimeType', 'paymentId', 'proofUrl', 'success']);
      assert.deepEqual(await res.json(), { success: true, paymentId: 'PAY-1', proofUrl, mimeType });
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });
    assert.deepEqual(db.reads, ['PAY-1'], `${name}: exactly one direct doc read, never a query or full collection`);
  }
});

test('2. PDF proof is returned with its MIME type', async () => {
  const db = fakeDb(new Map([['PAY-PDF', { paymentProofUrl: pdf, paymentProofFileName: 'bukti.pdf' }]]));
  await withApp({ authorizeReadActor: allow, db }, async origin => {
    const res = await getProof(origin, 'PAY-PDF');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, paymentId: 'PAY-PDF', proofUrl: pdf, mimeType: 'application/pdf' });
  });
  assert.deepEqual(db.reads, ['PAY-PDF']);
});

test('3. missing document, missing proof and timestamp-only proof yield 404', async () => {
  for (const [id, records] of [
    ['PAY-MISSING', new Map()],
    ['PAY-EMPTY', new Map([['PAY-EMPTY', { status: 'paid', paymentProofUploadedAt: '2026-11-26T00:00:00Z' }]])],
    ['PAY-BLANK', new Map([['PAY-BLANK', { paymentProofUrl: '' }]])],
  ]) {
    const db = fakeDb(records);
    await withApp({ authorizeReadActor: allow, db }, async origin => {
      const res = await getProof(origin, id);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { success: false, code: 'PROOF_NOT_FOUND', message: 'Bukti pembayaran tidak tersedia.' });
    });
  }
});

test('4. unsafe or unsupported proof values are rejected with 404', async () => {
  const unsafe = [
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==',
    'data:text/html;base64,PGh0bWw+PHNjcmlwdD48L3NjcmlwdD48L2h0bWw+',
    'data:application/javascript;base64,YWxlcnQoMSk=',
    'data:image/png,<svg onload="alert(1)">',
    'https://example.com/bukti.png',
    'javascript:alert(1)',
    '../../payment_proofs/secret.png',
    `data:image/png;base64,${'!'.repeat(32)}`,
    `data:image/png;base64,${'A'.repeat(700001)}`,
    dataUrl('image/png', Buffer.alloc(500 * 1024 + 1, 1)),
  ];
  for (const [i, paymentProofUrl] of unsafe.entries()) {
    const db = fakeDb(new Map([[`PAY-${i}`, { paymentProofUrl }]]));
    await withApp({ authorizeReadActor: allow, db }, async origin => {
      const res = await getProof(origin, `PAY-${i}`);
      assert.equal(res.status, 404, `unsafe fixture ${i} must not be served`);
      assert.deepEqual(await res.json(), { success: false, code: 'PROOF_NOT_FOUND', message: 'Bukti pembayaran tidak tersedia.' });
    });
  }
});

test('5. malformed payment ids return 400 without any Firestore read', async () => {
  for (const id of [encodeURIComponent('bad/id'), 'a'.repeat(201), encodeURIComponent('bad id'), 'bad.id']) {
    const db = fakeDb(new Map([['PAY-1', { paymentProofUrl: png }]]));
    await withApp({ authorizeReadActor: allow, db }, async origin => {
      const res = await getProof(origin, id);
      assert.equal(res.status, 400, `bad id ${id} must not reach Firestore`);
      assert.deepEqual(await res.json(), { success: false, code: 'INVALID_PAYMENT_ID', message: 'ID pembayaran tidak valid.' });
    });
    assert.deepEqual(db.reads, []);
  }
});

test('6. 401/403 authorizer denials happen before any db access', async () => {
  for (const [authorizeReadActor, status, code] of [
    [async () => ({ error: { status: 401, code: 'AUTH_INVALID', message: 'Sesi login tidak valid.' } }), 401, 'AUTH_INVALID'],
    [async () => { throw denied(403, 'ROLE_REQUIRED'); }, 403, 'ROLE_REQUIRED'],
  ]) {
    const db = fakeDb(new Map([['PAY-1', { paymentProofUrl: png }]]));
    await withApp({ authorizeReadActor, db }, async origin => {
      const res = await getProof(origin, 'PAY-1');
      assert.equal(res.status, status);
      assert.equal((await res.json()).code, code);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
    });
    assert.deepEqual(db.reads, [], 'an unauthorized request must never touch Firestore');
  }
});

test('7. missing db returns 503 even when authorization succeeds', async () => {
  const authorizeReadActor = async (_req, roles) => {
    assert.deepEqual(roles, ['fat'], 'proof route must be fat-only');
    return { uid: 'fat-actor' };
  };
  await withApp({ authorizeReadActor, db: null }, async origin => {
    const res = await getProof(origin, 'PAY-1');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'SERVICE_UNAVAILABLE');
  });
});

test('8. pure helpers: timestamps alone are never a proof; valid data URLs are', () => {
  assert.equal(hasFatPaymentProof({ paymentProofUploadedAt: '2026-11-26T00:00:00.000Z' }), false);
  assert.equal(hasFatPaymentProof({ proofUploadedAt: { toDate: () => new Date() } }), false);
  assert.equal(hasFatPaymentProof({ paymentProofUploadedAt: '2026-11-26T00:00:00.000Z', paymentProofUrl: 'https://example.com/a.png' }), false);
  assert.equal(hasFatPaymentProof({ paymentProofUrl: png }), true);
  assert.deepEqual(parseFatPaymentProof({ paymentProofUrl: pdf }), { proofUrl: pdf, mimeType: 'application/pdf' });
  assert.equal(parseFatPaymentProof(null), null);
});

test('9. pure helpers enforce the length, charset and decoded-size limits', () => {
  assert.equal(hasFatPaymentProof({ paymentProofUrl: dataUrl('image/webp', Buffer.alloc(500 * 1024, 1)) }), true);
  assert.equal(hasFatPaymentProof({ paymentProofUrl: dataUrl('image/png', Buffer.alloc(500 * 1024 + 1, 1)) }), false);
  assert.equal(hasFatPaymentProof({ paymentProofUrl: `data:image/png;base64,${'A'.repeat(700001)}` }), false);
  for (const payload of ['@@@@', 'YWJj###', '=YWJj', 'YW Jj', '', 'YWJj-_']) {
    assert.equal(hasFatPaymentProof({ paymentProofUrl: `data:image/png;base64,${payload}` }), false, `invalid payload ${payload}`);
  }
  for (const mime of ['image/svg+xml', 'text/html', 'application/javascript', 'application/octet-stream', 'IMAGE/PNG']) {
    assert.equal(hasFatPaymentProof({ paymentProofUrl: `data:${mime};base64,YWJj` }), false, `invalid mime ${mime}`);
  }
});

test('10. server registers the FAT-only route once and no proof logging or Storage proxy was added', () => {
  const server = read('server.ts');
  const moduleSource = read('src/server/fatPaymentProof.ts');
  assert.match(server, /import \{ createFatPaymentProofHandler, hasFatPaymentProof \} from '\.\/src\/server\/fatPaymentProof\.ts'/);
  assert.match(server, /app\.get\('\/api\/fat\/payments\/:paymentId\/proof', createFatPaymentProofHandler\(\{ authorizeReadActor, db: adminDb \}\)\);/);
  assert.equal((server.match(/\/api\/fat\/payments\/:paymentId\/proof/g) || []).length, 1);
  assert.doesNotMatch(server, /api\/payments\/:paymentId\/proof/, 'proof route must remain behind the FAT prefix');
  assert.match(server, /hasProof: hasFatPaymentProof\(p\)/);
  assert.doesNotMatch(server, /hasProof: Boolean\(/, 'timestamps alone must no longer mark a proof as available');
  assert.match(moduleSource, /authorizeReadActor\(req, \['fat'\]\)/);
  assert.match(moduleSource, /collection\('payments'\)\.doc\(paymentId\)\.get\(\)/);
  for (const forbidden of ['signedUrl', 'getBucket', 'upload', 'storage\\(', 'res\\.redirect', 'console\\.']) {
    assert.doesNotMatch(moduleSource, new RegExp(forbidden, 'i'), `${forbidden} must not appear in the proof module`);
  }
});
