import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const scope = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-final-binding';
const raw = fs.readFileSync(`${scope}/PUBLICATION-PRESEAL.json`);
const seal = JSON.parse(raw);
for (const entry of seal.files) {
  const stat = fs.lstatSync(entry.path);
  assert(stat.isFile() && stat.size === entry.bytes);
  const bytes = fs.readFileSync(entry.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}
const { completeWrite, checkWindow, matrix, safeRelative, sameInventory } = await import(pathToFileURL(`${process.cwd()}/${scope}/actual-publication.mjs`).href);
const results = [];
function check(id, callback) { callback(); results.push({ id, status: 'PASS', role: 'PURE DATA; no product/engine/native/child' }); }
check('P01', () => { let calls = 0; completeWrite(() => { calls++; return 1; }, Buffer.from('abc')); assert.equal(calls, 3); });
check('P02', () => assert.throws(() => completeWrite(() => 0, Buffer.from('a'))));
check('P03', () => assert.throws(() => completeWrite(() => 2, Buffer.from('a'))));
check('P04', () => { for (const name of ['../x', '/x', 'x/AGENTS.md', 'x//y']) assert.throws(() => safeRelative(name)); assert.equal(safeRelative('raw/result.json'), 'raw/result.json'); });
check('P05', () => { assert.throws(() => sameInventory([], [{ path: 'added' }])); sameInventory([{ path: 'x' }], [{ path: 'x' }]); });
const fixture = ['source-built', 'installed', 'physically-moved'].map(layout => ({ layout, report: { rows: ['C10', 'C11', 'C15', 'C16', 'C18'].map(id => ({ id, reason: 0 })) } }));
check('P06', () => { assert.equal(matrix(fixture).length, 15); assert.equal(matrix(fixture)[0].observed.reason, 0); assert.throws(() => matrix(fixture.slice(1))); });
check('P07', () => { const changed = structuredClone(fixture); changed[0].report.rows[0].id = 'C99'; assert.throws(() => matrix(changed)); });
check('P08', () => { const binding = { issuedUTC: '2026-08-29T00:00:00Z', latestStartUTC: '2026-08-29T00:20:00Z', expiresUTC: '2026-08-29T00:50:00Z' }; const auth = { action: 'ROOT_B1_PUBLIC15_ACTUAL', authorization: 'PURE synthetic', startedUTC: '2026-08-29T00:01:00Z', knownStartsBeforePublication: 20 }; checkWindow(binding, auth, Date.parse('2026-08-29T00:02:00Z')); assert.throws(() => checkWindow(binding, auth, Date.parse('2026-08-29T00:31:00Z'))); assert.throws(() => checkWindow(binding, { ...auth, knownStartsBeforePublication: 28 }, Date.parse('2026-08-29T00:02:00Z'))); });
fs.writeFileSync("/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-independent-20260829/b1-final-binding-review/CONTROL-RESULTS.json", JSON.stringify({ passed: results.length, actual: 0, results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ purePassed: results.length, actual: 0 }));
