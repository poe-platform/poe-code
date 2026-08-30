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
const seal = JSON.parse(fs.readFileSync(path.join(root, 'CONTROL-SEAL.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version);
assert.equal(digest(fs.readFileSync(process.execPath)), seal.node.sha256);
for (const row of seal.files) { const bytes = fs.readFileSync(path.join(root, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); }
const output = path.join(root, 'RUN-CONTROLS-01'); fs.mkdirSync(output);
const rows = [], children = []; let internalAttempts = 0, applicationBirths = 0;
const save = () => fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify({ rows, children, internalAttempts, applicationBirths, productImports: 0, regexWorkers: 0 }, null, 2) + '\n');
function environment(caseId, directory) { return { PATH: path.dirname(seal.node.path), HOME: directory, TMPDIR: directory, LC_ALL: 'C', NO_COLOR: '1', CASE_ID: caseId, FIXTURE_MANIFEST: path.join(directory, 'manifest.json'), FIXTURE_LOG: path.join(directory, 'events.jsonl') }; }
const fixtureFiles = seal.files.filter(row => !['controls.mjs', 'admission.mjs', 'internal-loader-arguments.mjs'].includes(row.path)).map(row => ({ ...row, path: path.join(root, row.path) }));
function specification(caseId, directory) { return { caseId, output: directory, root, node: seal.node.path, loader: path.join(root, 'tiny-loader.mjs'), bootstrap: path.join(root, 'bootstrap.mjs'), consumer: path.join(root, 'consumer.mjs'), manifestPath: path.join(directory, 'manifest.json'), logPath: path.join(directory, 'events.jsonl'), files: fixtureFiles }; }
const argsFor = specification => ['--test-reporter=tap', '--loader', specification.loader, specification.consumer];
async function record(id, body) { try { const detail = await body(); rows.push({ id, pass: true, detail }); } catch (error) { rows.push({ id, pass: false, reasonPresent: true, reason: String(error?.stack ?? error) }); } save(); }
const parent = path.join(output, 'parent'); fs.mkdirSync(parent);
const base = specification('P02', parent), env = environment('P02', parent);
await record('C01', () => { const args = argsFor(base); assert.ok(admit(base, args, env).includes('--allow-worker')); const cross = vm.runInNewContext(JSON.stringify(args)); assert.deepEqual(admit(base, cross, env), admit(base, args, env)); });
await record('C02', () => assert.throws(() => admit(base, ['--test-reporter=tap', '--loader', 'file:///unbound-loader.mjs', base.consumer], env)));
await record('C03', () => { const filename = path.join(parent, 'changed-loader.mjs'); fs.writeFileSync(filename, fs.readFileSync(base.loader, 'utf8') + '\n'); const row = base.files.find(row => row.path === base.loader), changed = { ...base, loader: filename, files: [...base.files, { ...row, path: filename }] }; assert.throws(() => admit(changed, argsFor(changed), env), /source identity|Expected values/); });
await record('C04', () => assert.throws(() => admit(base, [...argsFor(base), '--allow-child-process'], env)));
await record('C05', () => assert.throws(() => admit(base, ['--test-reporter=tap', '--loader', base.loader, 1], env)));
await record('C06', () => { const args = argsFor(base); delete args[1]; assert.throws(() => admit(base, args, env)); });
await record('C07', () => { let calls = 0; const args = argsFor(base); Object.defineProperty(args, '1', { get() { calls++; return '--loader'; } }); assert.throws(() => admit(base, args, env)); assert.equal(calls, 0); });
await record('C08', () => { const filename = path.join(parent, 'changed-bootstrap.mjs'); fs.writeFileSync(filename, fs.readFileSync(base.bootstrap, 'utf8') + '\n'); const row = base.files.find(row => row.path === base.bootstrap), changed = { ...base, bootstrap: filename, files: [...base.files, { ...row, path: filename }] }; assert.throws(() => admit(changed, argsFor(changed), env)); });
await record('C09', () => { const filename = path.join(parent, 'symlink-loader.mjs'); fs.symlinkSync(base.loader, filename); const row = base.files.find(row => row.path === base.loader), changed = { ...base, loader: filename, files: [...base.files, { ...row, path: filename }] }; assert.throws(() => admit(changed, argsFor(changed), env)); });
await record('C10', () => { const changed = { ...base, consumer: path.join(path.dirname(root), 'outside.mjs') }; assert.throws(() => admit(changed, argsFor(changed), env), /containment/); });
await record('C11', () => assert.throws(() => admit(base, argsFor(base), { ...env, NODE_OPTIONS: '--allow-child-process' })));
await record('C12', () => { assert.equal(terminalVerdict(7, null, 0, true, true), false); assert.equal(terminalVerdict(0, null, 0, true, true), true); });
async function runCase(item) {
  const directory = path.join(output, item.id); fs.mkdirSync(directory);
  const specificationValue = specification(item.id, directory), environmentValue = environment(item.id, directory);
  const manifest = { files: fixtureFiles, applicationEntry: path.join(root, item.id === 'P09' ? 'application-error.mjs' : 'application.mjs') };
  fs.writeFileSync(specificationValue.manifestPath, JSON.stringify(manifest));
  let args = admit(specificationValue, argsFor(specificationValue), environmentValue);
  if (item.id === 'P01') args = args.filter(argument => argument !== '--allow-worker');
  const stdout = fs.openSync(path.join(directory, 'stdout.raw'), 'wx'), stderr = fs.openSync(path.join(directory, 'stderr.raw'), 'wx');
  const row = { id: item.id, args, environment: environmentValue, expectedCode: item.nodeExit, signals: [], closed: false };
  children.push(row); internalAttempts++; assert.ok(internalAttempts <= 12); save();
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
      assert.equal(row.internalStarts.length, 1); assert.equal(row.internalStarts[0].isMainThread, false);
      const loaderIndex = row.events.findIndex(event => event.kind === 'loader-start'), bootstrapIndex = row.events.findIndex(event => event.kind === 'bootstrap'), consumerIndex = row.events.findIndex(event => event.kind === 'consumer-start');
      assert.ok(loaderIndex >= 0 && bootstrapIndex > loaderIndex);
      if (item.id === 'P07') { assert.equal(consumerIndex, -1); assert.equal(out.length, 0); assert.match(err.toString(), /BOOTSTRAP_SENTINEL/); }
      else { assert.ok(consumerIndex > bootstrapIndex); const summary = JSON.parse(out.toString().trim()); assert.equal(summary.semantic, 'PASS'); assert.equal(summary.live, 0); if (item.id === 'P10') assert.equal(terminalVerdict(code, signal, 0, true, true), false); }
    }
    rows.push({ id: item.id, pass: true, detail });
  } catch (error) { rows.push({ id: item.id, pass: false, reasonPresent: true, reason: String(error?.stack ?? error), detail }); }
  save();
}
try {
  for (const item of seal.cases) await runCase(item);
  for (const row of seal.files) assert.equal(digest(fs.readFileSync(path.join(root, row.path))), row.sha256, 'post source equality');
} catch (error) { rows.push({ id: 'SAFETY_STOP', pass: false, reasonPresent: true, reason: String(error?.stack ?? error), safetyStop: true }); }
const pass = rows.filter(row => row.pass).length;
save(); console.log(JSON.stringify({ groups: rows.length, pass, fail: rows.length - pass, internalAttempts, observedInternalStarts: children.reduce((sum, row) => sum + (row.internalStarts?.length ?? 0), 0), applicationBirths, applicationExits: children.reduce((sum, row) => sum + (row.applicationExits ?? 0), 0), processChildren: children.length, allClosed: children.every(row => row.closed), productImports: 0, regexWorkers: 0 }));
process.exitCode = rows.length === 22 && pass === 22 ? 0 : 1;
