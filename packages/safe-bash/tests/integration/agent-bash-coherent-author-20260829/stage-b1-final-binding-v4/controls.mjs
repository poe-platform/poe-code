import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const scope = import.meta.dirname;
const [expectedHash, expectedBytes] = process.argv.slice(2);
const stat = fs.lstatSync(`${scope}/CONTROL-PRESEAL.json`);
assert(stat.isFile() && stat.size === Number(expectedBytes) && stat.size < 32768);
const bytes = fs.readFileSync(`${scope}/CONTROL-PRESEAL.json`);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash);
const seal = JSON.parse(bytes);
for (const entry of seal.files) {
  const meta = fs.lstatSync(entry.path); assert(meta.isFile() && meta.size === entry.bytes && meta.size < 32768);
  const source = fs.readFileSync(entry.path); assert.equal(crypto.createHash('sha256').update(source).digest('hex'), entry.sha256);
}
const { validateIdentities } = await import(pathToFileURL(`${scope}/identity.mjs`).href);
const first = { path: '/owned/first', bytes: 1, sha256: 'a'.repeat(64) };
const second = { path: '/owned/second', bytes: 2, sha256: 'b'.repeat(64) };
const results = [];
const test = (id, callback) => { callback(); results.push({ id, status: 'PASS', role: 'PURE shape admission; no filesystem access through subject' }); };
test('I01-valid-two-records', () => assert.equal(validateIdentities([first, second]).length, 2));
test('I02-nested-array', () => assert.throws(() => validateIdentities([first, [second]]), /must not be nested/));
test('I03-missing-path', () => assert.throws(() => validateIdentities([{ bytes: 1, sha256: first.sha256 }]), /keys/));
test('I04-duplicate-path', () => assert.throws(() => validateIdentities([first, { ...first }]), /Duplicate/));
fs.writeFileSync(`${scope}/CONTROLS.json`, JSON.stringify({ atUTC: new Date().toISOString(), results, passed: results.length, actual: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pure: results.length, actual: 0 }));
