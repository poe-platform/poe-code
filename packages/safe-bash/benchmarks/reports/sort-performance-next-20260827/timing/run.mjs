import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { command, directory, git, hash, inventory, json, repo } from './common.mjs';

const frozen = JSON.parse(readFileSync(join(directory, 'frozen.json')));
const root = frozen.root;
assert.match(root, /^\/private\/tmp\/sort-cache-timing-[^/]+$/u);
const evidence = join(directory, 'evidence-002');
mkdirSync(evidence);
const started = Date.now();
const overallDeadline = started + 480000;
const planCommit = git('log', '-1', '--format=%H', '--', directory).toString().trim();
assert.equal(git('status', '--porcelain', '--untracked-files=no', '--', directory).toString(), '');
const isFrozenInput = file => !file.path.startsWith('evidence/') && !file.path.startsWith('evidence-002/');
const inputs = inventory(directory).filter(isFrozenInput);
const encoded = gunzipSync(readFileSync(join(directory, 'fixtures.json.gz')));
assert.equal(hash(encoded), frozen.fixtureSha256);
assert.equal(hash(readFileSync(join(directory, 'fixtures.json.gz'))), frozen.fixtureGzipSha256);
assert.equal(hash(readFileSync(process.execPath)), frozen.nodeExecutableSha256);
assert.equal(hash(readFileSync(join(repo, 'node_modules/typescript/bin/tsc'))), frozen.compilerSha256);
assert.equal(hash(readFileSync(join(repo, 'node_modules/typescript/lib/_tsc.js'))), frozen.compilerRuntimeSha256);
const specimens = JSON.parse(encoded);
const owned = new Map();
const cleanup = [];
const prepared = {};
const correctness = [];
const samples = [];
const warmups = [];
const admissions = [];
let status = 'BLOCKED';
let reason;
let observer;
let noise;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function remaining(deadline = overallDeadline) { const value = Math.min(deadline, overallDeadline) - Date.now(); assert.ok(value > 0, 'frozen overall/phase deadline'); return value; }
function track(child, label) {
  owned.set(child.pid, { child, label });
  child.once('close', (code, signal) => { cleanup.push({ pid: child.pid, label, code, signal, settled: true }); owned.delete(child.pid); });
  return child;
}
async function terminate(child) {
  if (!owned.has(child.pid)) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => { if (owned.has(child.pid)) child.kill('SIGKILL'); }, 1000);
  await closed;
  clearTimeout(timer);
}
async function execute(program, args, options = {}, timeout = 60000) {
  const child = track(spawn(program, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options }), `${program} ${args.join(' ')}`);
  const output = [], errors = [];
  let bytes = 0;
  const collect = target => chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) { void terminate(child); return; } target.push(chunk); };
  child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void terminate(child); }, Math.min(timeout, remaining()));
  const outcome = await new Promise(resolve => { child.once('error', error => resolve({ error: String(error) })); child.once('close', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  return { ...outcome, pid: child.pid, timedOut, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
}
function ready(stage) {
  const value = { stage, planCommit, sourceArchiveSha256: frozen.sourceArchiveSha256, base: frozen.base, revisions: frozen.revisions, textHashes: frozen.textHashes, fixturesSha256: frozen.fixtureSha256, frozenManifestSha256: hash(readFileSync(join(directory, 'frozen.json'))), profiles: frozen.profiles, counts: { correctness: frozen.correctnessCalls, measuredWarm: 192, measuredCold: 32, warmups: 32 }, loadPolicy: 'PLAN.md: conjunctive absolute 1/5/15 load 2/2.5/3, normalized load1 <=.15, CPU <=10%, CPU range <=5pp, load1 range <=.25, competing visible CPU <25%; 3 attempts, 45 seconds; fail closed; during/post gates mandatory', commands: [`node ${directory}run.mjs`], root, loadObserved: admissions.length > 0, timingSamples: samples.length, allTimingClaims: 'PENDING DIFFERENT ROOT-ROUTED REVIEWER' };
  json(join(evidence, `readiness-${stage}.json`), value);
  writeFileSync('/tmp/sort-cache-timing-frozen.ready', JSON.stringify(value, null, 2) + '\n');
  console.log(JSON.stringify({ checkpoint: stage, planCommit, readiness: '/tmp/sort-cache-timing-frozen.ready', correctnessPassed: correctness.length, loadObserved: admissions.length > 0, timingSamples: samples.length }));
}
function parseTop(raw, exempt) {
  const parts = raw.split(/(?=Processes:)/u).filter(part => part.startsWith('Processes:'));
  return parts.map((part, index) => {
    const load = /Load Avg:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/u.exec(part);
    const cpu = /CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/u.exec(part);
    const processes = [...part.matchAll(/^\s*(\d+)\s+(.+?)\s+([\d.]+)\s*$/gmu)].map(match => ({ pid: Number(match[1]), command: match[2], cpu: Number(match[3]) }));
    const valid = !!load && !!cpu && processes.length > 0;
    return { index, valid, load: load ? load.slice(1).map(Number) : [], busy: cpu ? Number(cpu[1]) + Number(cpu[2]) : null, processes, exempt: [...exempt], completeRaw: part };
  });
}
function qualify(rows, during = false) {
  const failures = [];
  if (!during && rows.length !== 5) failures.push('not-exactly-five-valid-intervals');
  if (!rows.length) failures.push('no-intervals');
  const cpus = os.cpus().length;
  for (const row of rows) {
    if (!row.valid || ![...row.load, row.busy].every(Number.isFinite)) { failures.push('unavailable-metric'); continue; }
    if (row.load[0] > (during ? 3 : 2) || row.load[1] > 2.5 || row.load[2] > 3 || row.load[0] / cpus > (during ? .20 : .15)) failures.push('load-level');
    if (row.busy > (during ? 20 : 10)) failures.push('aggregate-cpu');
    if (row.processes.some(process => !row.exempt.includes(process.pid) && process.cpu >= 25)) failures.push('competing-process-cpu');
  }
  if (Math.max(...rows.map(row => row.busy)) - Math.min(...rows.map(row => row.busy)) > (during ? 10 : 5)) failures.push('cpu-variability');
  if (Math.max(...rows.map(row => row.load[0])) - Math.min(...rows.map(row => row.load[0])) > .25) failures.push('load-variability');
  return { qualified: failures.length === 0, failures: [...new Set(failures)] };
}
const topArgs = count => ['-l', String(count), '-s', '1', '-n', '12', '-o', 'cpu', '-stats', 'pid,command,cpu', '-F', '-R'];
async function observe(name, timeout = 10000) {
  const result = await execute('/usr/bin/top', topArgs(6), {}, timeout);
  writeFileSync(join(evidence, `${name}.top.txt`), result.stdout, { flag: 'wx' });
  const rows = parseTop(result.stdout, new Set([process.pid, result.pid])).slice(1);
  const qualification = qualify(rows);
  if (result.code !== 0 || result.timedOut || result.error) { qualification.qualified = false; qualification.failures.push('observer-failure'); }
  const observation = { name, observedAt: new Date().toISOString(), ...result, stdout: undefined, rows, qualification };
  json(join(evidence, `${name}.json`), observation);
  return observation;
}
function waitMessage(child, send) {
  return new Promise((resolve, reject) => {
    const finish = (error, result) => { clearTimeout(timer); child.off('message', onMessage); child.off('close', onClose); child.off('error', onError); error ? reject(error) : resolve(result); };
    const onMessage = result => result.type === 'failure' ? finish(new Error(result.error)) : finish(null, result);
    const onClose = () => finish(new Error('worker exited before expected message'));
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error('worker 10s deadline')), Math.min(10000, remaining()));
    child.once('message', onMessage); child.once('close', onClose); child.once('error', onError);
    if (send) child.send(send);
  });
}
async function worker(label, mode = 'warm-or-correctness') {
  const variant = prepared[label];
  const child = track(fork(join(variant.consumer, 'worker.mjs'), [variant.packageRoot, variant.manifestPath, mode], { cwd: variant.consumer, execArgv: ['--max-old-space-size=512'], env: { PATH: '/usr/bin:/bin', TZ: 'UTC', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), `worker-${label}`);
  const journal = join(evidence, `worker-${child.pid}.jsonl`);
  writeFileSync(journal, JSON.stringify({ label, mode, pid: child.pid }) + '\n', { flag: 'wx' });
  child.on('message', message => appendFileSync(journal, JSON.stringify(message) + '\n'));
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  const identity = await waitMessage(child);
  assert.equal(identity.type, 'ready');
  const run = (specimen, measured) => waitMessage(child, { type: 'run', specimen, measured });
  const close = async () => {
    const response = await waitMessage(child, { type: 'close' });
    assert.equal(response.packageUnchanged, true);
    if (owned.has(child.pid)) await new Promise(resolve => child.once('close', resolve));
    assert.equal(logs, '', 'unexpected worker logs');
    return response;
  };
  return { child, identity, run, close };
}
function startObserver(deadline) {
  const child = track(spawn('/usr/bin/top', topArgs(181), { stdio: ['ignore', 'pipe', 'pipe'] }), 'during-top');
  let raw = '', errors = '', seen = 0;
  const rows = [];
  const absorb = () => {
    const parsed = parseTop(raw, new Set([process.pid, ...owned.keys()]));
    while (seen < parsed.length - 1) {
      const row = parsed[seen++];
      if (row.index === 0) continue;
      rows.push(row);
      const check = qualify(rows.slice(-5), true);
      if (!check.qualified) noise ??= check.failures;
    }
  };
  child.stdout.on('data', chunk => { raw += chunk; absorb(); });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.on('close', () => { if (Date.now() < deadline && !observer?.stopping) noise ??= ['observer-exit']; });
  return { child, rows, stopping: false, async stop() { this.stopping = true; await terminate(child); absorb(); writeFileSync(join(evidence, 'during.top.txt'), raw, { flag: 'wx' }); json(join(evidence, 'during.json'), { rows, errors, noise, lastPartialSampleRetained: true }); } };
}
function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const quantile = fraction => { const position = (sorted.length - 1) * fraction; const lower = Math.floor(position); return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower); };
  return { count: sorted.length, min: sorted[0], p25: quantile(.25), median: quantile(.5), p75: quantile(.75), max: sorted.at(-1) };
}
try {
  ready('frozen');
  const host = { recordedAt: new Date().toISOString(), platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().map(cpu => ({ model: cpu.model, speedReportedMHz: cpu.speed })), totalMemory: os.totalmem(), node: process.version, versions: process.versions, execPath: process.execPath, nodeExecutableSha256: frozen.nodeExecutableSha256, sysctl: command('/usr/sbin/sysctl', ['-n', 'hw.model', 'hw.ncpu', 'machdep.cpu.brand_string']).toString(), swVers: command('/usr/bin/sw_vers', []).toString(), topSha256: hash(readFileSync('/usr/bin/top')), noPriorLoadObservation: true };
  json(join(evidence, 'host.json'), host);
  writeFileSync(join(evidence, 'top-manual.raw.txt'), command('/usr/bin/man', ['top'], { env: { PATH: '/usr/bin:/bin', MANPAGER: 'cat', PAGER: 'cat' } }), { flag: 'wx' });
  assert.equal(host.platform, 'darwin');
  const preparationDeadline = started + 240000;
  const userConfig = join(root, 'npm-user-empty.conf');
  const globalConfig = join(root, 'npm-global-empty.conf');
  writeFileSync(userConfig, '', { flag: 'wx' });
  writeFileSync(globalConfig, '', { flag: 'wx' });
  for (const label of ['A', 'B', 'C']) {
    const build = join(root, label);
    assert.deepEqual(inventory(build), frozen.sources[label]);
    symlinkSync(join(repo, 'node_modules'), join(build, 'node_modules'), 'dir');
    const buildResult = await execute(process.execPath, ['--max-old-space-size=512', join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: build }, Math.min(60000, remaining(preparationDeadline)));
    json(join(evidence, `build-${label}.json`), buildResult); assert.equal(buildResult.code, 0);
    const dist = inventory(join(build, 'dist'));
    const npm = process.execPath.replace(/node$/u, 'npm');
    const packResult = await execute(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', join(root, 'npm-cache')], { cwd: build, env: { PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:/usr/bin:/bin`, HOME: root, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig } }, Math.min(30000, remaining(preparationDeadline)));
    json(join(evidence, `pack-${label}.json`), packResult); assert.equal(packResult.code, 0);
    const pack = JSON.parse(packResult.stdout)[0];
    const tarball = join(root, `${label}.tgz`); renameSync(join(root, pack.filename), tarball);
    const staging = join(root, `stage-${label}`); mkdirSync(staging);
    command('/usr/bin/tar', ['-xf', tarball, '-C', staging]);
    const consumer = join(root, `consumer-${label}`); mkdirSync(join(consumer, 'node_modules'), { recursive: true });
    const packageRoot = join(consumer, 'node_modules/virtual-bash'); renameSync(join(staging, 'package'), packageRoot);
    cpSync(join(directory, 'worker.mjs'), join(consumer, 'worker.mjs'), { errorOnExist: true });
    const packageManifest = inventory(packageRoot);
    const manifestPath = join(root, `package-${label}.json`); json(manifestPath, packageManifest);
    assert.deepEqual(packageManifest.filter(file => file.path.startsWith('dist/')).map(file => ({ ...file, path: file.path.slice(5) })), dist);
    if (label !== 'A') assert.deepEqual(packageManifest.filter(file => !/^dist\/commands\/text\./u.test(file.path)), prepared.A.packageManifest.filter(file => !/^dist\/commands\/text\./u.test(file.path)));
    prepared[label] = { label, build, consumer, packageRoot, manifestPath, packageManifest, dist, tarball, tarballSha256: hash(readFileSync(tarball)) };
  }
  json(join(evidence, 'prepared.json'), prepared);
  for (const label of ['A', 'B', 'C']) {
    remaining(preparationDeadline);
    const session = await worker(label);
    const rows = [];
    for (const specimen of specimens) { remaining(preparationDeadline); const result = await session.run(specimen, false); rows.push(result); correctness.push({ label, ...result }); }
    const after = await session.close();
    json(join(evidence, `correctness-${label}.json`), { identity: session.identity, rows, after });
  }
  assert.equal(correctness.length, frozen.correctnessCalls);
  ready('correctness-passed');
  const admissionDeadline = Date.now() + 45000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    remaining(admissionDeadline);
    const observation = await observe(`admission-${attempt}`, Math.min(10000, remaining(admissionDeadline)));
    admissions.push(observation);
    console.log(JSON.stringify({ admission: attempt, ...observation.qualification }));
    if (observation.qualification.qualified) break;
    if (attempt < 3) await sleep(Math.min(5000, remaining(admissionDeadline)));
  }
  if (!admissions.at(-1)?.qualification.qualified) { status = 'TIMING DEFERRED'; reason = 'No qualified local window in the three frozen attempts.'; }
  else {
    const timingDeadline = Date.now() + 180000;
    observer = startObserver(timingDeadline);
    const check = () => { remaining(timingDeadline); if (noise) throw new Error(`midrun noise: ${noise.join(',')}`); };
    while (observer.rows.length < 2) { check(); await sleep(100); }
    for (const specimen of specimens.filter(row => row.timing)) {
      const [left, right] = specimen.pair;
      const sessions = { [left]: await worker(left), [right]: await worker(right) };
      for (const label of [left, right]) for (let repeat = 0; repeat < 2; repeat++) { check(); warmups.push({ label, ...await sessions[label].run(specimen, false) }); }
      for (let block = 0; block < 6; block++) for (const [position, label] of [left, right, right, left].entries()) { check(); const row = { mode: 'warm', profile: specimen.id, block, position, label, pair: specimen.pair, ...await sessions[label].run(specimen, true) }; samples.push(row); json(join(evidence, `sample-${String(samples.length).padStart(3, '0')}.json`), row); }
      await sessions[left].close(); await sessions[right].close();
      if (specimen.cold) for (let block = 0; block < 2; block++) for (const [position, label] of [left, right, right, left].entries()) {
        check();
        const start = process.hrtime.bigint();
        const session = await worker(label, 'cold');
        const forkToReadyMs = Number(process.hrtime.bigint() - start) / 1e6;
        const result = await session.run(specimen, true);
        const forkToValidatedResultMs = Number(process.hrtime.bigint() - start) / 1e6;
        const after = await session.close();
        const row = { mode: 'cold', profile: specimen.id, block, position, label, pair: specimen.pair, forkToReadyMs, forkToValidatedResultMs, identity: session.identity, after, ...result };
        samples.push(row); json(join(evidence, `sample-${String(samples.length).padStart(3, '0')}.json`), row);
      }
    }
    check();
    await sleep(2100); check();
    await observer.stop(); observer = undefined;
    const after = await observe('post-run', Math.min(10000, remaining(timingDeadline)));
    if (!after.qualification.qualified) throw new Error('post-run noise invalidates complete cohort');
    assert.equal(samples.length, 224);
    const effects = [];
    for (const specimen of specimens.filter(row => row.timing)) for (const mode of specimen.cold ? ['warm', 'cold'] : ['warm']) {
      const selected = samples.filter(row => row.profile === specimen.id && row.mode === mode);
      const [left, right] = specimen.pair;
      const ratios = [];
      for (let index = 0; index < selected.length; index += 2) {
        const first = selected[index], second = selected[index + 1];
        ratios.push((first.label === right ? first.elapsedMs : second.elapsedMs) / (first.label === left ? first.elapsedMs : second.elapsedMs));
      }
      effects.push({ profile: specimen.id, mode, pair: specimen.pair, beforeMs: statistics(selected.filter(row => row.label === left).map(row => row.elapsedMs)), afterMs: statistics(selected.filter(row => row.label === right).map(row => row.elapsedMs)), pairedAfterBeforeRatio: statistics(ratios), pairedLogRatios: ratios.map(Math.log), reviewerStatus: 'PENDING DIFFERENT ROOT-ROUTED REVIEWER' });
    }
    json(join(evidence, 'effects-PENDING-REVIEW.json'), effects);
    status = 'COMPLETE QUALIFIED — PENDING INDEPENDENT REVIEW';
  }
} catch (error) { reason = error.stack; status = samples.length ? 'INCOMPLETE/NOISY — NO EFFECT CLAIM' : 'BLOCKED — NO TIMING CLAIM'; }
finally {
  if (observer) await observer.stop();
  for (const { child } of [...owned.values()]) await terminate(child);
  const integrity = { archiveUnchanged: hash(readFileSync(join(root, 'source.tar'))) === frozen.sourceArchiveSha256, detectsAddedEntries: true, variants: {} };
  try {
    assert.equal(integrity.archiveUnchanged, true);
    for (const [label, variant] of Object.entries(prepared)) {
      assert.deepEqual(inventory(variant.build, true).filter(file => !file.path.startsWith('dist/')), frozen.sources[label]);
      assert.deepEqual(inventory(join(variant.build, 'dist')), variant.dist);
      assert.deepEqual(inventory(variant.packageRoot), variant.packageManifest);
      assert.equal(hash(readFileSync(variant.tarball)), variant.tarballSha256);
      integrity.variants[label] = 'source/build/moved-package/tarball unchanged';
    }
    assert.deepEqual(inventory(directory).filter(isFrozenInput), inputs);
    integrity.frozenHarnessAndInputsUnchanged = true;
  } catch (error) { integrity.failure = String(error); status = 'INTEGRITY FAILURE — NO TIMING CLAIM'; }
  json(join(evidence, 'integrity.json'), integrity);
  json(join(evidence, 'cleanup.json'), { ownedChildren: cleanup, activeOwnedChildren: [...owned.keys()], inertScratchRetained: root, noOtherProcessSignals: true, noServersStarted: true });
  const report = { status, reason, planCommit, measuredSamples: samples.length, correctnessPassed: correctness.length, correctnessExpected: frozen.correctnessCalls, warmups: warmups.length, admissions: admissions.map(row => ({ name: row.name, qualification: row.qualification })), elapsedExecutionSecondsNotBenchmark: (Date.now() - started) / 1000, inputManifestSha256: hash(readFileSync(join(directory, 'frozen.json'))), root, allTimingClaims: 'PENDING DIFFERENT ROOT-ROUTED REVIEWER', limits: ['Narrow own-cache effects only; no comparator or old 720 campaign.', 'Host load qualification is not isolation, thermal or frequency assurance.', 'Synthetic common-base archives, not full historical packages or current HEAD.', 'Correctness admission is not the full accepted regression/native suite.', 'No counter-to-speed, RSS, overall superiority or completion claim.'] };
  json(join(evidence, 'summary.json'), report);
  writeFileSync(join(evidence, 'REPORT.md'), `# ${status}\n\nFrozen plan: \`${planCommit}\`.\n\nCorrectness: ${correctness.length}/${frozen.correctnessCalls}; measured samples: ${samples.length}.\n\n${reason ?? 'All timing interpretation remains pending a different root-routed reviewer.'}\n\nSee summary.json, host.json, prepared.json, admission raw observations, integrity.json and cleanup.json. No outliers were removed. No external comparator was invoked.\n`, { flag: 'wx' });
  json(join(evidence, 'seal.json'), { planCommit, generatedAt: new Date().toISOString(), files: inventory(evidence), sealExcludesOnlyItself: true, addedEntriesMustBeRejectedOnReview: true });
  console.log(JSON.stringify(report));
}
