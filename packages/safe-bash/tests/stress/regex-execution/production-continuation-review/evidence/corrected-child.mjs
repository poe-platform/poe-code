import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases, globCases, files } from './cohort.mjs';

const [snapshotName, job] = process.argv.slice(2);
const owned = resolve('tests/stress/regex-execution/production-continuation-review');
const snapshot = resolve(owned, 'snapshots', snapshotName === 'packed' ? 'candidate' : snapshotName);
const workers = [];
let active = 0;
let peak = 0;
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    const started = performance.now();
    super(url, options);
    const record = { url: String(url), options, exited: false, terminationCalls: 0, worker: this };
    workers.push(record);
    active++;
    peak = Math.max(peak, active);
    this.once('exit', code => { record.exited = true; record.exitCode = code; active--; });
    this.once('message', message => { if (message?.ready === true) record.startupMs = performance.now() - started; });
    const terminate = this.terminate.bind(this);
    this.terminate = async () => { record.terminationCalls++; const result = await terminate(); record.terminationAwaited = true; return result; };
  }
};
syncBuiltinESMExports();
const moduleLocation = snapshotName === 'packed' ? import.meta.resolve('virtual-bash') : pathToFileURL(resolve(snapshot, 'dist/index.js')).href;
if (snapshotName === 'packed') assert.ok(moduleLocation.startsWith(new URL('./node_modules/virtual-bash/', import.meta.url).href), 'actual moved package, not repository self-reference');
const api = await import(moduleLocation);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const sleep = delay => new Promise(resolveSleep => setTimeout(resolveSleep, delay));
const deferred = () => { let resolveValue; let rejectValue; const promise = new Promise((resolvePromise, rejectPromise) => { resolveValue = resolvePromise; rejectValue = rejectPromise; }); return { promise, resolve: resolveValue, reject: rejectValue }; };
const checkWithin = async (promise, milliseconds) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('observation timeout ' + milliseconds + 'ms')), milliseconds); })]); } finally { clearTimeout(timer); } };
const makeShell = () => new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
const vector = result => ({ code: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64') });
const observations = [];
const metrics = () => workers.map(({worker, ...record}) => ({...record, listeners: Object.fromEntries(['message','messageerror','error','exit'].map(event => [event,worker.listenerCount(event)]))}));
async function drainObserved() {
  const deadline = performance.now() + 1500;
  while (active && performance.now() < deadline) await sleep(5);
  assert.equal(active, 0, 'eventual exact observed Worker exit before next independent case');
}
async function caseCheck(name, callback) {
  const before = workers.length;
  try { observations.push({ name, pass: true, details: await callback() }); }
  catch (error) { observations.push({ name, pass: false, error: error.stack }); }
  const observation = observations.at(-1);
  observation.publicSettlement = { active, ownedWorkers: metrics().slice(before) };
  await drainObserved();
}
async function cohort() {
  const historical = JSON.parse(await readFile(resolve(owned, '../production-review/evidence/production-final/cohort.json'))).result.observations;
  for (const fixture of cases) await caseCheck(fixture.id, async () => {
    const shell = makeShell();
    try {
      const actual = vector(await shell.exec(fixture.script ?? [fixture.command, ...fixture.args].map(quote).join(' '), { stdin: fixture.input ?? '' }));
      const previous = historical.find(item => item.name === fixture.id);
      assert.equal(previous.pass, true);
      const expected = previous.details.actual ?? previous.details;
      assert.deepEqual(actual, expected);
      return { actual, activeAtExec: active };
    } finally { await shell.dispose(); }
  });
}
async function lifecycle() {
  await caseCheck('preabort-before-construction-and-input', async () => {
    const shell = makeShell();
    const controller = new AbortController();
    const reason = new Error('independent preabort');
    controller.abort(reason);
    let pulled = false;
    const prior = workers.length;
    const input = { async *[Symbol.asyncIterator]() { pulled = true; yield Buffer.from('ab\n'); } };
    try { await assert.rejects(shell.exec("grep -E '['", { stdin: input, signal: controller.signal }), error => error === reason); }
    finally { await shell.dispose(); }
    assert.equal(pulled, false);
    assert.equal(workers.length, prior);
  });
  for (const command of ['grep -E', 'rg']) await caseCheck(`live-source-idle-and-cancel-${command}`, async () => {
    const shell = makeShell();
    const controller = new AbortController();
    const gate = deferred();
    const first = deferred();
    let output = '';
    let returned = false;
    const input = { async *[Symbol.asyncIterator]() { try { yield Buffer.from('ab\n'); await gate.promise; } finally { returned = true; } } };
    const running = shell.exec(`${command} '^a'`, { stdin: input, signal: controller.signal, stdout: { async write(bytes) { output += Buffer.from(bytes); if (output === 'ab\n') first.resolve(); } } });
    const settled = running.then(value => ({ value }), error => ({ error }));
    try {
      await checkWithin(first.promise, 1000);
      await sleep(180);
      assert.equal(active, 0, 'idle source must not pin workers');
      const reason = new Error('independent live-source abort');
      controller.abort(reason);
      gate.resolve();
      const outcome = await checkWithin(settled, 1000);
      assert.equal(outcome.error, reason);
      assert.equal(output, 'ab\n');
      assert.equal(returned, true);
      assert.equal(active, 0);
    } finally { gate.resolve(); controller.abort(); await settled; await shell.dispose(); }
  });
  await caseCheck('cross-shell-cancel-isolation', async () => {
    const first = makeShell();
    const second = makeShell();
    const controller = new AbortController();
    const gate = deferred();
    const pulled = deferred();
    const input = { async *[Symbol.asyncIterator]() { pulled.resolve(); await gate.promise; yield Buffer.from('ab\n'); } };
    const running = first.exec("rg '^a'", { stdin: input, signal: controller.signal }).catch(error => error);
    try {
      await checkWithin(pulled.promise, 1000);
      const unaffected = second.exec("grep -E 'b$'", { stdin: 'ab\n' });
      const reason = new Error('cancel first only');
      controller.abort(reason); gate.resolve();
      assert.equal(await running, reason);
      const result = await unaffected;
      assert.equal(result.stdout, 'ab\n'); assert.equal(result.exitCode, 0);
      assert.equal(active, 0);
    } finally { gate.resolve(); controller.abort(); await running; await first.dispose(); await second.dispose(); }
  });
  await caseCheck('six-concurrent-public-invocations', async () => {
    const shell = makeShell();
    try {
      const result = await Promise.all(Array.from({ length: 6 }, () => shell.exec("rg '^a'", { stdin: 'ab\ncd\n' })));
      for (const item of result) { assert.equal(item.exitCode, 0); assert.equal(item.stdout, 'ab\n'); }
      assert.equal(active, 0);
    } finally { await shell.dispose(); }
  });
  await caseCheck('early-downstream-zero-active', async () => {
    const shell = makeShell();
    try { const result = await shell.exec("grep -E '^a' | head -n 1", { stdin: 'ab\n'.repeat(200) }); assert.equal(result.stdout, 'ab\n'); assert.equal(result.exitCode, 0); assert.equal(active, 0); }
    finally { await shell.dispose(); }
  });
}

async function globs() {
  const native = JSON.parse(await readFile(resolve(owned, 'evidence/native-globs.json')));
  const previous = snapshotName === 'baseline' ? null : JSON.parse(await readFile(resolve(owned, 'evidence/baseline/globs.json'))).result.observations;
  for (const fixture of globCases) await caseCheck(fixture.id, async () => {
    const fs = new api.MemoryFileSystem();
    for (const [path, contents] of Object.entries(files)) {
      await fs.mkdir(dirname('/' + path), { recursive: true });
      await fs.writeFile('/' + path, Buffer.from(contents));
    }
    const shell = new api.Shell({fs}).use(api.agentCommands());
    try {
      const result = await shell.exec(['rg', ...fixture.args].map(quote).join(' '));
      const actual = vector(result);
      const reference = native.observations.find(item => item.id === fixture.id);
      assert.equal(result.exitCode, fixture.code);
      assert.equal(result.stdout, fixture.output);
      assert.equal(result.stderr.length > 0, fixture.code === 2);
      assert.equal(actual.code, reference.code);
      assert.equal(actual.stdout, reference.stdout);
      if (previous) assert.deepEqual(actual, previous.find(item => item.name === fixture.id).details.actual);
      assert.equal(active, 0);
      return {actual, nativeStatusOutputExact: true};
    } finally { await shell.dispose(); }
  });
}
async function publicCases() {
  await caseCheck('registration-and-preabort-invalid-options', async () => {
    const before = workers.length;
    const shell = makeShell();
    await shell.exec(':');
    assert.equal(workers.length, before);
    const controller = new AbortController();
    const reason = new Error('rg preabort before malformed glob');
    controller.abort(reason);
    try { await assert.rejects(shell.exec("rg -g '[' hit .", {signal: controller.signal}), error => error === reason); }
    finally { await shell.dispose(); }
    assert.equal(workers.length, before);
    const invalid = new api.Shell({fs:new api.MemoryFileSystem()}).use(api.agentCommands({search: {regex: {maxWorkers: 0}}}));
    try { await assert.rejects(invalid.exec(':'), /maxWorkers/); }
    finally { await invalid.dispose(); }
    assert.equal(workers.length, before);
  });
  await caseCheck('source-invalid-pattern-and-missing-pattern-file', async () => {
    const fs = new api.MemoryFileSystem();
    await fs.writeFile('/invalid', Buffer.from('[\n'));
    const shell = new api.Shell({fs}).use(api.agentCommands());
    const results = [];
    try {
      for (const command of ['grep -f /invalid', 'rg -f /invalid -', 'grep -f /missing', 'rg -f /missing -']) {
        const result = await shell.exec(command, {stdin:'a\n'});
        results.push({command,...vector(result)});
        assert.equal(result.exitCode, 2); assert.equal(result.stdout, ''); assert.notEqual(result.stderr, ''); assert.equal(active, 0);
      }
      return results;
    } finally { await shell.dispose(); }
  });
  await caseCheck('multistage-live-feedback-with-concurrent-siblings', async () => {
    const shell = makeShell();
    const gate = deferred();
    const first = deferred();
    let output = '';
    let producerClosed = false;
    shell.commands.register({name:'feedback',async execute(context) {
      try { await context.stdout.write(Buffer.from('ab\n')); await gate.promise; await context.stdout.write(Buffer.from('ac\n')); return {exitCode:0}; }
      finally { producerClosed = true; }
    }});
    const running = shell.exec("feedback | grep -E '^a' | rg '[bc]$'", {stdout:{async write(bytes){ output += Buffer.from(bytes); if (output === 'ab\n') first.resolve(); }}});
    const settled = running.then(value => ({value}), error => ({error}));
    try {
      await checkWithin(first.promise, 1500);
      const siblings = await checkWithin(Promise.all(Array.from({length:4}, () => shell.exec("rg '^a'", {stdin:'ab\ncd\n'}))), 2000);
      for (const result of siblings) { assert.equal(result.stdout, 'ab\n'); assert.equal(result.exitCode,0); }
      gate.resolve();
      const result = await checkWithin(running,1500);
      assert.equal(output,'ab\nac\n'); assert.equal(result.exitCode,0); assert.equal(result.stderr,''); assert.equal(producerClosed,true); assert.equal(active,0);
      return {output,siblings:siblings.length};
    } finally { gate.resolve(); await settled; await shell.dispose(); }
  });
  await caseCheck('rg-early-downstream-zero-active', async () => {
    const shell = makeShell();
    try { const result = await shell.exec("rg '^a' | head -n 1", {stdin:'ab\n'.repeat(200)}); assert.equal(result.exitCode,0); assert.equal(result.stdout,'ab\n'); assert.equal(result.stderr,''); assert.equal(active,0); }
    finally { await shell.dispose(); }
  });
  await caseCheck('caller-abort-active-benign-request', async () => {
    const controller = new AbortController();
    const reason = new Error('abort accepted benign regex');
    const originalPost = NativeWorker.prototype.postMessage;
    let posted = false;
    NativeWorker.prototype.postMessage = function(message,...rest) { const result = originalPost.call(this,message,...rest); if (!posted && message?.rows?.length) { posted=true; controller.abort(reason); } return result; };
    const shell = makeShell();
    try { await assert.rejects(shell.exec("rg '^a'", {stdin:'ab\n',signal:controller.signal}), error => error === reason); assert.equal(posted,true); assert.equal(active,0); }
    finally { NativeWorker.prototype.postMessage=originalPost; await shell.dispose(); }
  });
}
async function benchmark() {
  const baselineApi = await import(pathToFileURL(resolve(owned,'snapshots/baseline/dist/index.js')));
  for (let repeat=0;repeat<3;repeat++) await caseCheck('complete-command-pair-'+repeat,async () => {
    const result={};
    for (const variant of repeat % 2 ? ['candidate','baseline'] : ['baseline','candidate']) {
      const selected=variant==='baseline'?baselineApi:api;
      const before=workers.length;
      const started=performance.now();
      const shell=new selected.Shell({fs:new selected.MemoryFileSystem()}).use(selected.agentCommands());
      const output=await shell.exec("rg '^a'",{stdin:'ab\ncd\n'.repeat(1000)});
      await shell.dispose();
      result[variant]={milliseconds:performance.now()-started,output:vector(output),startupMs:workers.slice(before).map(item=>item.startupMs),activeAtSettlement:active};
    }
    assert.deepEqual(result.candidate.output,result.baseline.output);
    assert.equal(result.candidate.output.code,0);
    assert.equal(result.candidate.output.stdout,Buffer.from('ab\n'.repeat(1000)).toString('base64'));
    assert.equal(result.candidate.output.stderr,'');
    return result;
  });
}
process.send({kind:'ready'});
process.once('message',async message => {
  try {
    assert.equal(message.kind,'run');
    if (job==='cohort') await cohort();
    else if (job==='lifecycle') await lifecycle();
    else if (job==='globs') await globs();
    else if (job==='public') await publicCases();
    else if (job==='transport') await (await import('../production-review/transport.mjs')).runTransport(snapshot,caseCheck);
    else if (job==='benchmark') await benchmark();
    else throw new Error('unprepared benign job');
  } catch(error) {observations.push({name:'job-final',pass:false,error:error.stack});}
  const settlement=metrics();
  try {await drainObserved();} catch(error) {observations.push({name:'eventual-cleanup',pass:false,error:error.stack});}
  const cleanupFailures=observations.filter(item=>item.publicSettlement?.active || item.details?.activeAtExec).length;
  process.send({kind:'result',pass:observations.every(item=>item.pass)&&cleanupFailures===0,summary:{passed:observations.filter(item=>item.pass).length,total:observations.length,cleanupFailures,active,peak,workers:workers.length},moduleLocation,observations,settlement,final:metrics()},()=>process.disconnect());
});
