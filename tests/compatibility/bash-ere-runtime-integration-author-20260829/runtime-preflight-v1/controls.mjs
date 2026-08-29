import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completion, grant, ownRecord, sha } from './controller-core.mjs';
const own = path.dirname(fileURLToPath(import.meta.url));
const output = fs.openSync(path.join(own, 'C02-controls.jsonl'), 'ax');
fs.writeSync(output, `${JSON.stringify({ event: 'startup', pid: process.pid })}\n`);
const rows = [];
function check(id, action, rejects = false) {
  let failed = false; try { action(); } catch { failed = true; }
  rows.push({ id, pass: failed === rejects });
}
const good = () => [{ id: 'R01', status: 'PASS', retired: true }];
check('C01-positive', () => completion(0, null, good(), ['R01'], false));
check('C02-nonzero-allPASS', () => completion(1, null, good(), ['R01'], false), true);
check('C03-signal', () => completion(0, 'SIGKILL', good(), ['R01'], false), true);
check('C04-missing', () => completion(0, null, [], ['R01'], false), true);
check('C05-extra', () => completion(0, null, [...good(), ...good()], ['R01'], false), true);
check('C06-identity', () => completion(0, null, good(), ['R02'], false), true);
check('C07-unknown-retirement', () => completion(0, null, [{ id: 'R01', status: 'PASS', retired: false }], ['R01'], false), true);
check('C08-unsafe', () => completion(0, null, good(), ['R01'], true), true);
check('C09-own-extra', () => ownRecord({ first: 1, extra: 2 }, ['first']), true);
check('C10-null-prototype', () => ownRecord(Object.assign(Object.create(null), { first: 1 }), ['first']));
let getterCalls = 0;
check('C11-accessor', () => ownRecord(Object.defineProperty({}, 'first', { enumerable: true, get() { getterCalls++; return 1; } }), ['first']), true);
check('C12-no-getter-evaluation', () => { if (getterCalls !== 0) throw new Error('getter called'); });
const value = { action: 'execute-core70-v1', sealSha256: 'a'.repeat(64), sourceTree: 'da4e1cc187022255521879b00db2ac77674f79d9', packageSha256: '4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e', transportReceipt: '1'.repeat(40), preexecReceipt: '2'.repeat(40), rootReceipt: '3'.repeat(40) };
const raw = Buffer.from(JSON.stringify(value));
check('C13-format-only-synthetic', () => grant(value, value.sealSha256, sha(raw), raw));
check('C14-wrong-raw-hash', () => grant(value, value.sealSha256, 'b'.repeat(64), raw), true);
check('C15-wrong-seal', () => grant(value, 'b'.repeat(64), sha(raw), raw), true);
check('C16-receipt-format', () => { const changed = { ...value, rootReceipt: 'not-a-commit' }, bytes = Buffer.from(JSON.stringify(changed)); grant(changed, value.sealSha256, sha(bytes), bytes); }, true);
const result = { role: 'PURE DATA/SYNTHETIC only; no child/product/Worker', rows, pass: rows.every(row => row.pass), syntheticReceiptStringsAreNotRootAuthorization: true };
fs.writeSync(output, `${JSON.stringify(result)}\n`);
fs.writeFileSync(path.join(own, 'CONTROLS-RESULT.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
fs.closeSync(output);
if (!result.pass) process.exitCode = 1;
