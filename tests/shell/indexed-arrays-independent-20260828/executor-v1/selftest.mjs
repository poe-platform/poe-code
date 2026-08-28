import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { census, authenticate, verifyTree, verifyProjection, digest } from './boundary.mjs';
import { supervise, classify } from './supervisor.mjs';
import { compileVector } from './semantic.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const records = []; const children = [];
const check = (id, body) => { try { body(); records.push({ id, pass: true }); } catch (error) { records.push({ id, pass: false, error: String(error) }); } };
const work = mkdtempSync(join(directory, '.synthetic-')); const identity = lstatSync(work);
let cleanup;
try {
  for (const mode of ['success', 'failure', 'late-nonzero', 'duplicate', 'bad-summary', 'empty', 'timeout', 'overflow']) {
    const run = await supervise(process.execPath, [join(directory, 'synthetic-worker.mjs'), mode], { cwd: work, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: mode === 'timeout' ? 120 : 3000, maxBytes: mode === 'overflow' ? 1024 : 16384 });
    children.push({ mode, run });
    const verdict = classify(run, ['synthetic-only']);
    check(`child:${mode}`, () => {
      assert.ok(run.closeObserved && run.groupAbsent, 'owned child really reaped');
      if (mode === 'success') assert.equal(verdict.accepted, true);
      else if (mode === 'failure') { assert.equal(verdict.coherent, true); assert.equal(verdict.accepted, false); }
      else assert.equal(verdict.coherent, false);
    });
  }
  const success = children[0].run;
  check('no-empty-execution', () => assert.equal(classify({ ...success, stdout: '{"summary":{"cases":0,"pass":0,"failed":[]}}\n' }, []).coherent, false));
  check('required-load', () => assert.equal(classify(success, ['synthetic-only'], { loads: [{ path: '/absent', sha256: 'a'.repeat(64) }] }).coherent, false));
  check('unloaded-mutant-not-kill', () => assert.equal(classify(children[1].run, ['synthetic-only'], { mutant: { id: 'U', path: '/absent', sha256: 'b'.repeat(64), requiredFailed: ['synthetic-only'] } }).mutantKilled, false));
  check('exit78-not-kill', () => assert.equal(classify({ ...children[1].run, code: 78 }, ['synthetic-only']).coherent, false));
  check('unsettled-receipt', () => assert.equal(classify({ ...success, stdout: success.stdout.replace('"disposed":true', '"disposed":false') }, ['synthetic-only']).coherent, false));
  const treeRoot = join(work, 'tree'); mkdirSync(treeRoot); writeFileSync(join(treeRoot, 'regular'), 'sealed');
  const tree = { root: treeRoot, entries: census(treeRoot) };
  check('regular-census', () => verifyTree(tree));
  check('tampered-file', () => { writeFileSync(join(treeRoot, 'regular'), 'changed'); assert.throws(() => verifyTree(tree)); writeFileSync(join(treeRoot, 'regular'), 'sealed'); });
  check('empty-directory-append', () => { mkdirSync(join(treeRoot, 'extra')); assert.throws(() => verifyTree(tree)); rmSync(join(treeRoot, 'extra'), { recursive: true }); });
  check('symlink-refusal', () => { symlinkSync(join(treeRoot, 'regular'), join(treeRoot, 'link')); assert.throws(() => census(treeRoot)); rmSync(join(treeRoot, 'link')); });
  check('hash-refusal', () => assert.throws(() => authenticate(join(treeRoot, 'regular'), '0'.repeat(64))));
  check('missing-refusal', () => assert.throws(() => authenticate(join(treeRoot, 'missing'), '0'.repeat(64))));
  const base = [{ path: 'src/shell/runtime.ts', commit: 'a'.repeat(40), mode: '100644', sha256: '1'.repeat(64) }, { path: 'src/commands/basic.ts', commit: 'a'.repeat(40), mode: '100644', sha256: '2'.repeat(64) }];
  check('private-helper-addition', () => assert.deepEqual(verifyProjection(base, [...base, { path: 'src/shell/arrays/ledger.ts', commit: 'b'.repeat(40), mode: '100644', sha256: '3'.repeat(64) }]).unapprovedChanges, []));
  check('G4-basic-command-scope-denied', () => assert.deepEqual(verifyProjection(base, [base[0], { ...base[1], sha256: '4'.repeat(64) }]).unapprovedChanges, ['src/commands/basic.ts']));
  check('missing-source-denied', () => assert.ok(verifyProjection(base, [base[0]]).unapprovedChanges.includes('removed:src/commands/basic.ts')));
  check('source-traversal-denied', () => assert.throws(() => verifyProjection(base, [...base, { path: '../escape', commit: 'b'.repeat(40), sha256: '3'.repeat(64) }])));
  const vectors = JSON.parse(readFileSync(join(directory, '../review-v3/VECTORS.json')));
  check('33-concrete-scripts-not-executed', () => {
    const rows = [...vectors.splice, ...vectors.zeroView]; assert.equal(rows.length, 33);
    for (const row of rows) { const script = compileVector(row); assert.ok(script.length > 0 && Buffer.byteLength(script) < 4096); }
    assert.match(compileVector(vectors.splice[0]), /__array_value "\$\{a\[@\]\}:\$\{b\[@\]\}"/u);
  });
  const held = await supervise(process.execPath, [join(directory, 'run.mjs')], { cwd: work, env: { LC_ALL: 'C' }, timeoutMs: 3000 });
  children.push({ mode: 'no-root-GO', run: held });
  check('no-root-GO-refuses78', () => { assert.equal(held.code, 78); assert.ok(held.closeObserved && held.groupAbsent); assert.equal(held.stdout.includes('"load"'), false); });
} finally {
  assert.equal(lstatSync(work).ino, identity.ino); assert.equal(lstatSync(work).dev, identity.dev);
  if (children.every(child => child.run.closeObserved && child.run.groupAbsent)) { rmSync(work, { recursive: true }); cleanup = { path: work, absent: !existsSync(work) }; }
  else cleanup = { path: work, absent: false, reason: 'unsafe child; preserve owned root' };
}
const result = { role: 'preparatory data and synthetic harness controls only', node: { path: process.execPath, version: process.version }, records, children,
  counts: { controls: records.length, passed: records.filter(row => row.pass).length, children: children.length, actualArrayCases: 0, nativeCases: 0, productMutantKills: 0 }, cleanup,
  fileBindings: ['boundary.mjs','supervisor.mjs','semantic.mjs','synthetic-worker.mjs','selftest.mjs','run.mjs'].map(path => ({ path, sha256: digest(readFileSync(join(directory, path))) })) };
console.log(JSON.stringify(result, null, 2));
if (records.some(row => !row.pass) || !cleanup.absent) process.exitCode = 1;
