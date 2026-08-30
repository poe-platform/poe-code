import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { admit } from './admission.mjs';
import { terminalVerdict } from './worker-policy.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const seal = JSON.parse(fs.readFileSync(path.join(root, 'CONTROL-SEAL-V2.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
assert.equal(digest(fs.readFileSync(process.execPath)), seal.node.sha256);
for (const row of seal.files) { const bytes = fs.readFileSync(path.join(root, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); }
const output = path.join(root, 'RUN-CORRECTION-01'); fs.mkdirSync(output);
const rows = [], children = []; let internalAttempts = 0, applicationBirths = 0;
const save = () => fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify({ rows, children, internalAttempts, applicationBirths, productImports: 0, regexWorkers: 0 }, null, 2) + '\n');
function environment(caseId, directory) { return { PATH: path.dirname(seal.node.path), HOME: directory, TMPDIR: directory, LC_ALL: 'C', NO_COLOR: '1', CASE_ID: caseId, FIXTURE_MANIFEST: path.join(directory, 'manifest.json'), FIXTURE_LOG: path.join(directory, 'events.jsonl') }; }
const fixtureFiles = seal.files.filter(row => ['tiny-loader.mjs', 'bootstrap.mjs', 'worker-policy.mjs', 'consumer-v2.mjs', 'application.mjs', 'application-error.mjs'].includes(row.path)).map(row => ({ ...row, path: path.join(root, row.path) }));
function specification(caseId, directory) { return { caseId, output: directory, root, node: seal.node.path, loader: path.join(root, 'tiny-loader.mjs'), bootstrap: path.join(root, 'bootstrap.mjs'), consumer: path.join(root, 'consumer-v2.mjs'), manifestPath: path.join(directory, 'manifest.json'), logPath: path.join(directory, 'events.jsonl'), files: fixtureFiles }; }
const argsFor = specification => ['--test-reporter=tap', '--loader', specification.loader, specification.consumer];
async function record(id, body) { try { const detail = await body(); rows.push({ id, pass: true, detail }); } catch (error) { rows.push({ id, pass: false, reasonPresent: true, reason: String(error?.stack ?? error) }); } save(); }
async function runCase(item) {
  const directory = path.join(output, item.newId); fs.mkdirSync(directory);
  const specificationValue = specification(item.id, directory), environmentValue = environment(item.id, directory);
  const manifest = { files: fixtureFiles, applicationEntry: path.join(root, item.id === 'P09' ? 'application-error.mjs' : 'application.mjs') };
  fs.writeFileSync(specificationValue.manifestPath, JSON.stringify(manifest));
  let args = admit(specificationValue, argsFor(specificationValue), environmentValue);
  if (item.noCustomLoader) args = args.filter(argument => argument !== '--loader' && argument !== specificationValue.loader);
  const stdout = fs.openSync(path.join(directory, 'stdout.raw'), 'wx'), stderr = fs.openSync(path.join(directory, 'stderr.raw'), 'wx');
  const row = { id: item.newId, semanticCase: item.id, args, environment: environmentValue, expectedCode: item.nodeExit, signals: [], closed: false };
  children.push(row); if (!item.noCustomLoader) internalAttempts++; assert.ok(internalAttempts <= 2); save();
  let child, timeout, rescue, spawnError, code, signal;
  try {
    child = spawn(seal.node.path, args, { cwd: root, env: { ...environmentValue }, stdio: ['ignore', stdout, stderr] });
    row.pid = child.pid;
    const settled = new Promise(resolve => {
      child.once('error', error => { spawnError = String(error); });
      child.once('exit', (exitCode, exitSignal) => { row.exitEvent = { code: exitCode, signal: exitSignal }; });
      child.once('close', (exitCode, exitSignal) => { row.closed = true; resolve([exitCode, exitSignal]); });
    });
    timeout = setTimeout(() => { row.signals.push('SIGTERM'); child.kill('SIGTERM'); rescue = setTimeout(() => { if (!row.closed) { row.signals.push('SIGKILL'); child.kill('SIGKILL'); } }, 1000); }, 15000);
    [code, signal] = await settled;
  } finally { clearTimeout(timeout); clearTimeout(rescue); const failures = []; for (const descriptor of [stdout, stderr]) { try { fs.closeSync(descriptor); } catch (error) { failures.push(String(error)); } } if (failures.length) throw Error('capture retirement: ' + failures.join(';')); }
  row.code = code; row.signal = signal; row.spawnError = spawnError;
  const out = fs.readFileSync(path.join(directory, 'stdout.raw')), err = fs.readFileSync(path.join(directory, 'stderr.raw'));
  row.stdoutSha256 = digest(out); row.stderrSha256 = digest(err); row.captureBytes = out.length + err.length;
  const eventFile = specificationValue.logPath;
  row.events = fs.existsSync(eventFile) ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const births = row.events.filter(event => event.kind === 'application-create'), exits = row.events.filter(event => event.kind === 'application-exit');
  applicationBirths += births.length;
  row.internalStarts = row.events.filter(event => event.kind === 'loader-start');
  row.applicationBirths = births.length; row.applicationExits = exits.length;
  save();
  if (!row.closed || spawnError || signal !== null || row.signals.length || row.captureBytes > 262144 || applicationBirths > 8 || births.length !== exits.length || births.some(birth => !exits.some(exit => exit.id === birth.id))) throw Object.assign(Error('safety/capture/retirement STOP ' + item.id), { safetyStop: true });
  const detail = { code, internalStarts: row.internalStarts.length, applicationBirths: births.length, applicationExits: exits.length, processClosed: true, noInternalExitEventClaim: true };
  try {
    assert.equal(code, item.nodeExit);
    assert.equal(births.length, item.application);
    if (item.id === 'P01') { assert.equal(out.length, 0); assert.match(err.toString(), /ERR_ACCESS_DENIED/); assert.match(err.toString(), /WorkerThreads/); assert.equal(row.events.length, 0); }
    else {
      assert.equal(row.internalStarts.length, item.noCustomLoader ? 0 : 1); if (!item.noCustomLoader) assert.equal(row.internalStarts[0].isMainThread, false);
      const loaderIndex = row.events.findIndex(event => event.kind === 'loader-start'), bootstrapIndex = row.events.findIndex(event => event.kind === 'bootstrap'), consumerIndex = row.events.findIndex(event => event.kind === 'consumer-start');
      assert.ok(bootstrapIndex >= 0); if (!item.noCustomLoader) assert.ok(loaderIndex >= 0 && bootstrapIndex > loaderIndex);
      if (item.id === 'P07') { assert.equal(consumerIndex, -1); assert.equal(out.length, 0); assert.match(err.toString(), /BOOTSTRAP_SENTINEL/); }
      else { assert.ok(consumerIndex > bootstrapIndex); const summary = JSON.parse(out.toString().trim()); assert.equal(summary.semantic, 'PASS'); assert.equal(summary.live, 0); if (item.id === 'P08') { assert.equal(terminalVerdict(code, signal, 0, true, true), false); const refusalIndex = row.events.findIndex(event => event.kind === 'six-option-refusals'); assert.ok(refusalIndex > consumerIndex && refusalIndex < row.events.findIndex(event => event.kind === 'application-create')); assert.equal(row.events[refusalIndex].count, 6); } }
    }
    rows.push({ id: item.newId, pass: true, detail });
  } catch (error) { rows.push({ id: item.newId, pass: false, reasonPresent: true, reason: String(error?.stack ?? error), detail }); }
  save();
}
try {
  for (const item of seal.cases) await runCase(item);
  for (const row of seal.files) assert.equal(digest(fs.readFileSync(path.join(root, row.path))), row.sha256, 'post source equality');
} catch (error) { rows.push({ id: 'SAFETY_STOP', pass: false, reasonPresent: true, reason: String(error?.stack ?? error), safetyStop: true }); }
const pass = rows.filter(row => row.pass).length;
save(); console.log(JSON.stringify({ groups: rows.length, pass, fail: rows.length - pass, internalAttempts, observedInternalStarts: children.reduce((sum, row) => sum + (row.internalStarts?.length ?? 0), 0), applicationBirths, applicationExits: children.reduce((sum, row) => sum + (row.applicationExits ?? 0), 0), processChildren: children.length, allClosed: children.every(row => row.closed), productImports: 0, regexWorkers: 0 }));
process.exitCode = rows.length === 3 && pass === 3 ? 0 : 1;
