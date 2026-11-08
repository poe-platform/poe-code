import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { own, repo, node, privateRoot, candidate, packHash, sha, hashFile, read, write, save, gitRead, gitReceipts, setGitDeadline, privateState, inventory, authenticate, reason } from './common.mjs';
import { predicateControls } from './predicates.mjs';
import { tarEntries } from '../../commands/timeout-independent-20260828/repaired-f22-v1/recipe/io.mjs';

const binding = read(join(own, 'BINDINGS.json')), cases = read(join(own, 'CASES.json')), manifest = read(join(own, 'MANIFEST.json'));
const work = join(own, 'node_modules/attempt-01'), raw = join(own, 'raw-01');
assert.ok(!fs.existsSync(work) && !fs.existsSync(raw) && !fs.existsSync(join(own, 'RESULT.json')), 'ONE_ATTEMPT_ONLY');
fs.mkdirSync(raw, { recursive: true }); fs.mkdirSync(work, { recursive: true });
const report = { schema: 'timeout-curl-actual-safejs-workflow-result-v1', startedAt: new Date().toISOString(), candidate, packageSHA256: packHash, recipeSHA256: hashFile(join(own, 'MANIFEST.json')), recipeCommit: gitRead(repo, ['log', '-1', '--format=%H', '--', relative(repo, join(own, 'MANIFEST.json'))]).toString().trim(), children: [], guards: [], rows: [], controls: [], predicateControls: [], classification: 'UNPROVED', buildAndTypes: 'Bound accepted public78 proof only; not rerun', native: 0, safeJsOld25Replays: 0, fullGate: 0 };
let privateBefore, protectedTree, viewPath, productRows;
const normalize = rows => rows.map(({ path, mode, bytes, sha256 }) => ({ path, mode, bytes, sha256 })).sort((left, right) => left.path.localeCompare(right.path));
const started = Date.now();
setGitDeadline(started + cases.cohortDeadlineMs);
function guard(label) {
  assert.ok(Date.now() - started <= cases.cohortDeadlineMs, 'COHORT_DEADLINE');
  for (const row of manifest.files) assert.equal(hashFile(join(own, row.path)), row.sha256, `RECIPE_GUARD:${row.path}`);
  for (const row of binding.references) authenticate(row);
  for (const row of binding.tools) authenticate({ ...row, absolute: true });
  assert.equal(hashFile(binding.package.pack.physical), packHash, 'ORIGINAL_PACK');
  assert.deepEqual(privateState(), privateBefore, 'PRIVATE_PRE_POST_GUARD');
  if (viewPath) assert.deepEqual(inventory(viewPath), protectedTree, 'FRESH_TREE_APPEND_MODE_HASH_GUARD');
  report.guards.push({ label, at: new Date().toISOString(), privateUnchanged: true, freshTreeChecked: !!viewPath });
}
function absent(pid) {
  for (const target of [pid, -pid]) { let caught; try { process.kill(target, 0); } catch (error) { caught = error; } assert.equal(caught?.code, 'ESRCH', `CHILD_REAPED:${target}`); }
}
async function child(label, id, control) {
  guard(`${label}:PRE`);
  const directory = join(raw, label); fs.mkdirSync(directory);
  const resultFile = join(directory, 'RESULT.json'), traceFile = join(directory, 'LOADS.jsonl');
  const args = ['--permission', `--allow-fs-read=${viewPath}`, `--allow-fs-write=${directory}`, '--import', join(viewPath, 'harness/loader.mjs'), join(viewPath, 'harness/child.mjs')];
  const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NODE_NO_WARNINGS: '1', WORKFLOW_ROOT: viewPath, WORKFLOW_RESULT: resultFile, WORKFLOW_TRACE: traceFile, WORKFLOW_ID: id ?? label, WORKFLOW_LAYOUT: label.split('-')[0], ...(control ? { WORKFLOW_CONTROL: control } : {}) };
  const record = { label, id, control, args, env, startedAt: new Date().toISOString(), forced: false, bytes: 0, nodeSHA256: hashFile(node) };
  save(join(directory, 'PRE.json'), record); report.children.push(record);
  const handle = spawn(node, args, { cwd: viewPath, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); record.pid = handle.pid;
  const stdout = [], stderr = []; let escalation;
  const kill = cause => { if (record.forced) return; record.forced = cause; try { process.kill(-record.pid, 'SIGTERM'); } catch {} escalation = setTimeout(() => { try { process.kill(-record.pid, 'SIGKILL'); } catch {} }, 1000); };
  for (const [stream, rows] of [[handle.stdout, stdout], [handle.stderr, stderr]]) stream.on('data', bytes => { record.bytes += bytes.length; if (record.bytes > cases.childOutputMaxBytes) kill('OUTPUT_BOUND'); else rows.push(Buffer.from(bytes)); });
  const watchdog = setTimeout(() => kill('PARENT_DEADLINE'), cases.parentChildDeadlineMs);
  await new Promise(done => {
    handle.on('error', error => { record.spawnError = reason(error); });
    handle.on('exit', (code, signal) => { record.exit = { code, signal }; });
    handle.on('close', (code, signal) => { record.close = { code, signal }; clearTimeout(watchdog); clearTimeout(escalation); done(); });
  });
  write(join(directory, 'stdout.data'), Buffer.concat(stdout)); write(join(directory, 'stderr.data'), Buffer.concat(stderr));
  if (record.pid) { absent(record.pid); record.reaped = true; }
  record.finishedAt = new Date().toISOString(); save(join(directory, 'STATUS.json'), record);
  guard(`${label}:POST`);
  assert.equal(record.forced, false, 'CONTAINMENT_NOT_PASS'); assert.equal(record.spawnError, undefined); assert.deepEqual(record.exit, record.close);
  assert.ok(fs.existsSync(resultFile), 'NUMERIC_RECEIPT_REQUIRED'); assert.ok(fs.statSync(resultFile).size <= cases.receiptMaxBytes);
  const result = read(resultFile), trace = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const loads = trace.filter(row => row.event === 'load'), engineLoads = loads.filter(row => row.path.startsWith('node_modules/engine/'));
  const productLoads = loads.filter(row => row.path.startsWith('node_modules/virtual-bash/'));
  const outcome = { id: id ?? control, layout: env.WORKFLOW_LAYOUT, status: record.close.code, classification: result.classification, clean: result.clean, engineRuns: result.engineRuns, actualProductLoadObservations: productLoads.length, actualEngineLoadObservations: engineLoads.length, actualCompilerLoadObservations: loads.filter(row => row.path.startsWith('node_modules/typescript/')).length, failures: result.assertions.filter(row => !row.pass), fatal: result.fatal, resultSHA256: hashFile(resultFile), traceSHA256: fs.existsSync(traceFile) ? hashFile(traceFile) : null, rawDirectory: relative(own, directory) };
  if (control) {
    assert.equal(productLoads.length, 0, 'NEGATIVE_CONTROL_NO_PRODUCT_LOAD'); assert.equal(engineLoads.length, 0, 'NEGATIVE_CONTROL_NO_ENGINE_LOAD');
    assert.equal(trace.filter(row => row.event === 'reject' && row.kind === cases.controls.find(row => row.id === control).expected).length, 1, 'ACTUAL_DESIGNATED_GUARD');
    report.controls.push(outcome);
  } else {
    assert.deepEqual([...new Set(engineLoads.map(row => row.path.slice('node_modules/engine/'.length)))].sort(), binding.engineClosure.map(row => row.path).sort(), 'ACTUAL_COMPLETE_ENGINE_CLOSURE');
    for (const path of ['dist/index.js', 'dist/commands/timeout/index.js', 'dist/commands/network/curl.js', 'dist/commands/safejs/index.js', 'dist/integrations/safejs/shell.js']) assert.ok(productLoads.some(row => row.path === `node_modules/virtual-bash/${path}` && row.method === 'nextLoad'), `ACTUAL_PRODUCT_NEXT_LOAD:${path}`);
    assert.ok(!trace.some(row => row.event === 'NETWORK_DENIED'), 'UNEXPECTED_EXTERNAL_NETWORK_ATTEMPT');
    report.rows.push(outcome);
  }
  save(join(directory, 'ASSESSMENT.json'), outcome);
  assert.equal(result.clean, true, 'UNCLEAN_CASE_STOP');
  assert.equal(record.close.signal, null); assert.equal(record.close.code, result.classification === 'PASS' ? 0 : 1);
  console.log(JSON.stringify(outcome));
  return outcome;
}
function materialize() {
  const packed = authenticate({ ...binding.package.pack, path: binding.package.pack.physical, absolute: true });
  const parsed = tarEntries(packed, true).map(row => { assert.ok(row.path.startsWith('package/')); return { ...row, path: row.path.slice(8) }; });
  productRows = binding.package.files.entries.filter(row => row.kind === 'file');
  assert.equal(parsed.length, 858); assert.deepEqual(normalize(parsed), normalize(productRows), 'FULL_PACK_INVENTORY');
  const view = join(work, 'installed/consumer');
  write(join(view, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const row of parsed) write(join(view, 'node_modules/virtual-bash', row.path), row.body, row.mode);
  for (const row of binding.engine) write(join(view, 'node_modules/engine', row.path), authenticate(row, join(privateRoot, 'packages/safejs')), row.mode);
  for (const row of binding.typescript.records.filter(row => row.type === 'file')) write(join(view, 'node_modules/typescript', row.path), authenticate(row, binding.typescript.root), row.mode);
  for (const name of ['child.mjs', 'loader.mjs', 'predicates.mjs', 'CASES.json']) write(join(view, 'harness', name), fs.readFileSync(join(own, name)));
  write(join(view, 'harness/clock.mjs'), fs.readFileSync(join(repo, 'tests/commands/timeout-independent-20260828/clock.mjs')));
  const packageProbe = parsed.find(row => row.path === 'dist/commands/timeout/index.js').body;
  const engineProbe = fs.readFileSync(join(view, 'node_modules/engine/src/run.ts'));
  write(join(view, 'harness/mutant-package.mjs'), Buffer.concat([packageProbe, Buffer.from('\nexport const injectedTamper = true;\n')]));
  write(join(view, 'harness/mutant-engine.mjs'), Buffer.concat([engineProbe, Buffer.from('\nexport const injectedTamper = true;\n')]));
  write(join(view, 'harness/unbound.mjs'), 'throw new Error("UNBOUND_CODE_EXECUTED");\n');
  const files = Object.fromEntries(inventory(view).filter(row => row.kind === 'file').map(row => [row.path, row.sha256]));
  files['harness/mutant-package.mjs'] = sha(packageProbe); files['harness/mutant-engine.mjs'] = sha(engineProbe); delete files['harness/unbound.mjs'];
  save(join(view, 'LOAD.json'), { files, engineClosure: binding.engineClosure.map(row => `node_modules/engine/${row.path}`), countercontrols: 'Intentional separately pinned tampered copies; original product/engine and their bindings remain unchanged.' });
  return view;
}
try {
  privateBefore = privateState(); report.privateBefore = privateBefore;
  assert.equal(privateBefore.head, binding.engineCommit);
  assert.deepEqual(normalize(privateBefore.engine.filter(row => row.kind === 'file')), normalize(binding.engine));
  assert.equal(gitRead(repo, ['rev-parse', `${candidate}^{tree}`]).toString().trim(), binding.tree);
  for (const row of binding.source) assert.equal(sha(gitRead(repo, ['show', `${candidate}:${row.path}`])), row.sha256, `PINNED_SOURCE:${row.path}`);
  report.sourceInputs = binding.source.length;
  report.predicateControls = predicateControls(); save(join(raw, 'PREDICATE-CONTROLS.json'), report.predicateControls);
  viewPath = materialize(); protectedTree = inventory(viewPath); report.materialized = { packageFiles: productRows.length, engineFiles: binding.engine.length, compilerFiles: binding.typescript.records.filter(row => row.type === 'file').length, treeSHA256: sha(JSON.stringify(protectedTree)) };
  save(join(raw, 'MATERIALIZED.json'), protectedTree);
  guard('MATERIALIZED');
  for (const control of cases.controls) { const outcome = await child(`control-${control.id}`, undefined, control.id); assert.equal(outcome.classification, 'PASS', 'PREREQUISITE_CONTROL_STOP'); }
  for (const layout of cases.layouts) {
    if (layout === 'moved') {
      guard('BEFORE_PHYSICAL_MOVE'); const old = viewPath, moved = join(work, 'moved/deep/consumer'); fs.mkdirSync(dirname(moved), { recursive: true }); fs.renameSync(old, moved); viewPath = moved;
      assert.equal(fs.existsSync(old), false, 'OLD_CONSUMER_ABSENT'); assert.deepEqual(inventory(viewPath), protectedTree);
      report.move = { old: relative(own, old), moved: relative(own, moved), oldAbsent: true, sameInventory: true }; guard('AFTER_PHYSICAL_MOVE');
    }
    for (const row of cases.rows) await child(`${layout}-${row.id}`, row.id);
  }
  report.classification = report.rows.length === 24 && report.rows.every(row => row.classification === 'PASS') ? 'SCOPED_PASS' : 'SCOPED_FINDINGS';
} catch (error) { report.fatal = reason(error); report.classification = 'STOP'; console.error(error.stack); }
finally {
  if (privateBefore) { try { guard('FINAL'); report.privateAfter = privateState(); report.privateUnchanged = true; } catch (error) { report.finalGuardError = reason(error); report.classification = 'STOP'; } }
  report.finishedAt = new Date().toISOString();
  report.gitChildren = gitReceipts;
  report.counts = { installed: { executed: report.rows.filter(row => row.layout === 'installed').length, passed: report.rows.filter(row => row.layout === 'installed' && row.classification === 'PASS').length }, moved: { executed: report.rows.filter(row => row.layout === 'moved').length, passed: report.rows.filter(row => row.layout === 'moved' && row.classification === 'PASS').length }, controls: { executed: report.controls.length, passed: report.controls.filter(row => row.classification === 'PASS').length }, predicateControls: report.predicateControls.length, naturalChildren: report.children.filter(row => row.reaped && !row.forced && row.exit?.signal === null).length, actualEngineRuns: report.rows.reduce((count, row) => count + row.engineRuns, 0), unexecutedWorkflows: 24 - report.rows.length };
  save(join(own, 'RESULT.json'), report);
  const rawRows = inventory(raw).filter(row => row.kind === 'file').map(row => ({ ...row, base64: fs.readFileSync(join(raw, row.path)).toString('base64') }));
  const archive = gzipSync(Buffer.from(JSON.stringify({ schema: 'timeout-curl-safejs-raw-v1', rows: rawRows })), { level: 9 });
  write(join(own, 'RAW.json.gz'), archive); save(join(own, 'RAW-MANIFEST.json'), { sha256: sha(archive), bytes: archive.length, files: rawRows.length, rawInventory: rawRows.map(({ base64, ...row }) => row) });
  console.log(JSON.stringify({ classification: report.classification, counts: report.counts, fatal: report.fatal, finalGuardError: report.finalGuardError }));
  process.exitCode = report.classification === 'SCOPED_PASS' ? 0 : 1;
}
