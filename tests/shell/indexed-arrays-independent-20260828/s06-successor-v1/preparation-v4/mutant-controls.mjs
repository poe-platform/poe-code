import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deadline } from './deadline.mjs';
import { authenticate, digest, census } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const [sealHash, moduleName, modesJson, label] = process.argv.slice(2); assert.match(label ?? '', /^[A-Z0-9-]{1,40}$/u);
const seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
authenticate(seal.node.path, seal.node.sha256); assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
assert.ok(['controller.mjs','controller-late-owner.mjs','controller-early-finish.mjs'].includes(moduleName));
const modes = JSON.parse(modesJson); assert.deepEqual(modes, moduleName === 'controller.mjs' ? ['owner','final'] : moduleName === 'controller-late-owner.mjs' ? ['owner'] : ['final']);
const allowed = new Map(seal.roles.map(row => [path.join(own, row.path), row.sha256])), loads = [];
for (const [file, hash] of allowed) authenticate(file, hash);
registerHooks({ load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  const file = fileURLToPath(url); assert.ok(allowed.has(file), 'exact harness mutation closure'); authenticate(file, allowed.get(file));
  const value = next(url, context); assert.ok(value.source !== null && value.source !== undefined); assert.equal(digest(Buffer.from(value.source)), allowed.get(file));
  loads.push({ path: file, sha256: allowed.get(file) }); return value;
} });
const moduleFile = path.join(here, moduleName), { controller } = await import(pathToFileURL(moduleFile).href);
assert.ok(loads.some(row => row.path === moduleFile && row.sha256 === allowed.get(moduleFile)));
const root = path.join(here, `MUTATION-${label}`); assert.equal(fs.existsSync(root), false); fs.mkdirSync(root);
const policy = JSON.parse(fs.readFileSync(path.join(here, '../preparation-v3/POLICY.json'))), observations = [], owners = [];
let unsafe = false;
try {
  for (const mode of modes) {
    const directory = path.join(root, mode); fs.mkdirSync(directory); let pass = false, error;
    try {
      if (mode === 'owner') {
        const sentinel = Object.freeze({ receipt: 'failed' }); let actualOwner;
        const budget = controller(directory, policy, { node: seal.node, git: seal.git }, () => {}, deadline(), { beforePersist() { throw sentinel; }, supervisorHooks: { afterSpawn(owner) { actualOwner = owner; owners.push(owner); } } });
        let caught = false;
        try { await budget.child('product', seal.node.path, ['--permission', `--allow-fs-read=${here}`, path.join(here, 'controlled-child.mjs'), 'quick'], { cwd: here, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 2000, maxBytes: 16384 }); }
        catch (reason) { assert.equal(reason, sentinel); caught = true; }
        assert.equal(caught, true); assert.ok(actualOwner); assert.equal(actualOwner.closeObserved, true); assert.equal(actualOwner.groupAbsent, true);
        assert.equal(budget.children.length, 1, 'receipt failure must not erase newest child'); assert.equal(budget.children[0], actualOwner); budget.cleanupReady();
      } else {
        let time = 0, announced = 0; const clock = deadline(6600000, () => time, 0);
        const budget = controller(directory, policy, { node: seal.node, git: seal.git }, () => {}, clock, { publish(filename, bytes) { put(filename, bytes); time = 6600000; } });
        await assert.rejects(budget.finalize({ complete: true, unsafeStop: false }, () => ({}), () => { announced++; }), reason => reason?.code === 'REVIEW_DEADLINE');
        assert.equal(announced, 0, 'expired final publication cannot authorize acceptance');
      }
      pass = true;
    } catch (reason) { error = String(reason?.stack ?? reason); }
    observations.push({ id: mode, pass, error });
  }
} finally {
  unsafe = owners.some(owner => !owner.closeObserved || owner.groupAbsent !== true);
  const finalCensus = census(root); if (!unsafe) { fs.rmSync(root, { recursive: true }); assert.equal(fs.existsSync(root), false); }
  for (const [file, hash] of allowed) authenticate(file, hash);
  authenticate(seal.node.path, seal.node.sha256);
  console.log(JSON.stringify({ kind: 'actual-loaded-harness-control-not-product-proof', moduleName, loads, observations, owners: owners.map(owner => ({ pid: owner.pid, spawnReturned: owner.spawnReturned, closeObserved: owner.closeObserved, code: owner.code, signal: owner.signal, groupAbsent: owner.groupAbsent })), finalCensus, unsafe, ownedScratchRetired: !fs.existsSync(root) }));
  process.exitCode = unsafe ? 78 : observations.every(row => row.pass) ? 0 : 1;
}
