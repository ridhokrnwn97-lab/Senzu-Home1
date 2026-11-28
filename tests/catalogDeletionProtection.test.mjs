// Static rules inspection only. The Firestore emulator is not available in this
// environment, so these checks do not claim runtime authorization coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const rules = fs.readFileSync(new URL('firestore.rules', root), 'utf8');
const lines = rules.split(/\r?\n/);

function matchBlock(header) {
  const index = lines.findIndex(line => line.trim().startsWith(`match ${header}`));
  assert.ok(index >= 0, `missing match ${header} block`);
  let depth = 0, started = false;
  const body = [];
  for (let i = index; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (i > index) body.push(lines[i]);
    if (started && depth === 0) break;
  }
  return body.join('\n');
}

function allowStatements(block) {
  return [...block.matchAll(/^\s*allow\s+[^;]+;/gm)].map(m => m[0].trim());
}

for (const collection of ['services', 'service_categories']) {
  test(`${collection}: read and create/update are unchanged, delete is explicitly denied`, () => {
    const block = matchBlock(`/${collection}/{`);
    assert.deepEqual(allowStatements(block).sort(), [
      'allow create, update: if isManager();',
      'allow delete: if false;',
      'allow read: if true;',
    ]);
  });
}

test('no second rule can grant catalog deletion through OR semantics', () => {
  // Only one exact match per catalog collection.
  for (const collection of ['services', 'service_categories']) {
    const matching = lines.filter(line => line.includes(`match /${collection}/`));
    assert.equal(matching.length, 1, `unexpected extra match for ${collection}`);
  }

  // No catch-all wildcard other than the explicit zero-trust fallback.
  const wildcardHeaders = [...rules.matchAll(/match\s+(\/\{[^}]+\}[^\s{]*)/g)].map(m => m[1]);
  assert.deepEqual(wildcardHeaders, ['/{document=**}']);
  assert.deepEqual(allowStatements(matchBlock('/{document=**}')), ['allow read, write: if false;']);

  // The directory root declares no permissions of its own.
  const rootLine = lines.findIndex(line => line.includes('match /databases/{database}/documents'));
  const firstMatchAfterRoot = lines.findIndex((line, i) => i > rootLine && line.includes('match /'));
  assert.deepEqual(lines.slice(rootLine + 1, firstMatchAfterRoot).filter(l => l.trim().startsWith('allow ')), []);
});

test('source code contains no catalog hard-delete path', () => {
  const sourceFiles = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) sourceFiles.push(rel);
    }
  };
  walk('src');
  sourceFiles.push('server.ts');

  const catalogDelete = /['"](?:services|service_categories)['"][^\n]*\b(?:delete|remove)\b|\b(?:delete|remove)\b[^\n]*['"](?:services|service_categories)['"]/i;
  const offenders = sourceFiles.filter(file => catalogDelete.test(fs.readFileSync(new URL(file, root), 'utf8')));
  assert.deepEqual(offenders, []);
});
