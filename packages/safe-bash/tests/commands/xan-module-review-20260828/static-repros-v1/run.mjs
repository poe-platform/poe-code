import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ROOT, REVIEW, NODE, gitBytes, identity, hash, json, durable, checkInputs, verifyTree } from './common.mjs';
import { assertObservation } from './recipe.mjs';
import { supervise } from '../preparation-v2/supervisor.mjs';

const commit = process.argv[2]; assert.match(commit, /^[a-f0-9]{40}$/);
const sealPath = path.join(ROOT, 'PRE-SEAL.json'); const sealId = await identity(sealPath);
assert.equal(hash(gitBytes(commit, sealPath)), sealId.sha256);
const seal = await json(sealPath);
for (const input of seal.inputs.filter(item => item.path.startsWith(ROOT))) assert.equal(hash(gitBytes(commit, input.path)), input.sha256);
const verify = async () => {
  assert.deepEqual(await identity(sealPath), sealId);
  await checkInputs(seal.inputs); await checkInputs(seal.binding.inputs);
  assert.deepEqual(await identity(path.join(ROOT, 'HOST-PRE.json')), seal.hostPre);
  await verifyTree(path.join(ROOT, 'qualification'), seal.qualification);
  for (const root of seal.binding.roots) await verifyTree(root.root, root.entries);
};
await verify();
const evidence = path.join(ROOT, 'attempt-1'); await mkdir(evidence);
const nonce = randomUUID(); const manifest = sealId.sha256;
const results = []; const children = []; let stopped;
await durable(path.join(evidence, 'PRE-RUN.json'), { at: new Date().toISOString(), commit, sealId, nonce, candidateAttempt: 1, retry: false, preIntegrity: 'append-aware verified' });
try {
  for (const layout of seal.binding.layouts) {
    for (const spec of seal.cases) {
      await verify();
      const id = `${layout.name}-${spec.id}`;
      const jobPath = path.join(evidence, `${id}.job.json`);
      await durable(jobPath, { nonce, manifest, root: layout.root, entries: layout.entries, builtinMap: layout.builtinMap, spec });
      const jobId = await identity(jobPath);
      const worker = path.join(ROOT, 'worker.mjs'); const loader = path.join(REVIEW, 'actual-review-v1/loader.mjs');
      const args = ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw', ...[worker, loader, jobPath, layout.root].map(filename => `--allow-fs-read=${filename}`), worker, jobPath, jobId.sha256];
      const receipt = await supervise({ executable: NODE, args, cwd: ROOT, directory: path.join(evidence, id), timeoutMs: seal.perChild.timeoutMs, rawBytes: seal.perChild.rawBytes, kind: id });
      children.push({ id, receipt });
      const raw = await readFile(path.join(evidence, id, 'stdout.raw'));
      const rawStderr = await readFile(path.join(evidence, id, 'stderr.raw'));
      await durable(path.join(evidence, id, 'ADMISSION-PRE.json'), { id, jobId, rawSha256: hash(raw), receipt, beforeAssertions: true });
      assert.equal(receipt.reaped, true, 'cleanup failure: stop');
      assert.equal(receipt.logs.some(item => item.error), false, 'spool failure: stop');
      await verify();
      if (/actual nextLoad|ACTUAL_LOADER_DENIED/.test(rawStderr.toString())) throw new Error('candidate load integrity failure: stop');
      let result;
      try {
        assert.equal(receipt.timeout, false, 'forced timeout is not natural settlement');
        assert.equal(receipt.overflow, false); assert.equal(receipt.signal, null); assert.equal(receipt.spawnError, null);
        assert.equal(receipt.code, 0, 'child exit mismatch');
        assert.equal(raw.length, receipt.logs[0].artifactBytes); assert.equal(hash(raw), receipt.logs[0].artifactSha256);
        const records = raw.toString().trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(records.map(item => item.stage), ['RAW', 'LOADS', 'FINAL']);
        try {
          const final = records[2]; assert.equal(final.id, spec.id); assert.equal(final.nonce, nonce); assert.equal(final.manifest, manifest); assert.equal(final.complete, true);
          assert.equal(final.closed, true, 'cooperative cleanup failure'); assert.equal(records[0].observation.closed, true);
          assert.equal(records[0].nonce, nonce); assert.equal(records[0].manifest, manifest);
          const leaf = records[1].loads.find(item => item.url.endsWith('/dist/commands/xan/index.js'));
          assert.equal(leaf?.sha256, layout.leaf.sha256); assert.equal(leaf?.bytes, 6090);
          for (const load of records[1].loads) {
            const filename = new URL(load.url); const prefix = new URL(`file://${layout.root}/`);
            assert.ok(filename.href.startsWith(prefix.href));
            const entry = layout.entries.find(item => item.path === decodeURIComponent(filename.pathname).slice(layout.root.length + 1));
            assert.equal(load.sha256, entry?.sha256); assert.equal(load.bytes, entry?.bytes);
          }
        } catch (error) { error.integral = true; throw error; }
        assertObservation(assert, spec, records[0].observation);
        result = { id, observation: 'MATCH', finding: spec.expected.classification === 'CONFIRMED_IF_MATCH' ? 'NORMATIVE_LOWER_BOUND_VIOLATED' : null, natural: true, loadCount: records[1].loads.length, elapsedMs: records[0].observation.elapsedMs };
      } catch (error) {
        if (error.integral || /actual nextLoad|ACTUAL_LOADER_DENIED|AssertionError.*hash/s.test(raw.toString())) throw error;
        result = { id, observation: 'FAIL', error: { name: error.name, message: error.message, stack: error.stack }, forced: receipt.timeout || receipt.signal !== null };
      }
      results.push(result); await durable(path.join(evidence, id, 'CASE.json'), result);
    }
  }
} catch (error) { stopped = { name: error.name, message: error.message, stack: error.stack }; }
const required = seal.binding.layouts.flatMap(layout => seal.cases.map(spec => `${layout.name}-${spec.id}`));
const unrun = required.filter(id => !results.some(item => item.id === id));
const summary = { at: new Date().toISOString(), commit, manifest, nonce, results, children, stopped: stopped ?? null, required: required.length, unrun,
  matches: results.filter(item => item.observation === 'MATCH').length, failures: results.filter(item => item.observation === 'FAIL').length,
  normativeViolations: results.filter(item => item.finding).length,
  dynamicYieldCount: 'UNPROVEN', diagnosticCharge: 'STATIC_ONLY_NOT_EXECUTED', wildcard: 'STATIC_ONLY_NOT_EXECUTED', wholeModuleAcceptance: false, exitCode: 1 };
await durable(path.join(evidence, 'RESULT.json'), summary);
console.log(JSON.stringify({ matches: summary.matches, failures: summary.failures, normativeViolations: summary.normativeViolations, unrun: unrun.length, stopped, reaped: children.filter(item => item.receipt.reaped).length, exitCode: summary.exitCode }));
process.exitCode = summary.exitCode;
