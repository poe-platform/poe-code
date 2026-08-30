import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { createHash } from 'node:crypto';

export async function legacy(job) {

const api = await import(job.layout === 'source' ? pathToFileURL(path.join(job.product, 'dist/index.js')).href : 'virtual-bash');
const module = await import(pathToFileURL(path.join(job.product, 'dist/commands/apply-patch/index.js')).href);
const originals = JSON.parse(fs.readFileSync(new URL('./ORIGINAL32-v1.json', import.meta.url))).cases;
const supplements = JSON.parse(fs.readFileSync(new URL('./SUPPLEMENT-v1.json', import.meta.url))).cases;
const skipped = {
  S32: 'SOURCE_BINDING_REQUIRED: two operand authorities cannot be invented as one compareEntry callback; no actual composed provider fixture sealed',
  S54: 'STATIC_NONCONFORMANCE F02: bulk charge/copy admits more than4096 work units between checkpoints; exact private counter endpoint not exposed',
  S57: 'NOT_RUN: four host-owned lifecycle variants require independently qualified resource-admission probe',
  S61: 'NOT_RUN: zero remaining actual shared-budget checkpoint not independently sealed',
};
const reasons = {
  P09: 'Move destination already exists: b', P14: 'expected context not found: a', P16: 'expected context not found: a', P18: 'expected context not found: a',
  P25: 'duplicate', P26: 'parent traversal is unsupported', P28: 'invalid Add body', P29: 'missing target: missing', P30: 'expected context not found: b', P31: 'patch contains no file operations', P32: 'Update requires',
  S04: 'expected context not found: a', S09: 'expected context not found: a', S10: 'expected context not found: a', S12: 'expected context not found: a',
  S13: 'invalid UTF-8', S14: 'invalid UTF-8', S17: 'unpaired surrogate', S18: 'NUL bytes', S19: 'expected Begin Patch', S20: 'expected Begin Patch', S21: 'expected Begin Patch', S22: 'expected stdin or one literal patch argument',
  S23: 'path names a directory', S24: 'symlink paths are unsupported: /work/link', S25: 'symlink paths are unsupported: /work/a', S26: 'target is not a regular file: a', S27: 'not a directory: /work/a', S28: 'conflicting patch paths',
  S29: 'same backing entry', S30: 'same backing entry', S31: 'invalid entry comparison', S34: 'read-only file system', S35: 'permission denied: /work/a', S37: 'operation not permitted: /work/a', S38: 'operation not supported:',
  S39: 'file already exists: /work/a', S40: 'file already exists: /work/b', S41: 'input/output error: /work/b', S42: 'target changed since preflight: /work/a', S43: 'permission denied: /work/a', S44: 'input/output error: /work/b',
  S45: 'permission denied: /work/d/e', S46: 'parent is not a directory: /work/d', S47: 'expected context not found: b', S48: 'operation not supported: /work/b',
  S62: 'permission denied: /work/a', S63: 'read-only file system: /work/readonly', S65: 'EOF must terminate', S66: 'expected context not found: a', S67: 'duplicate', S68: 'duplicate', S69: 'path', S70: 'NUL bytes', S71: 'permission denied: /work', S72: 'read-only file system: /work/b', S74: 'target changed since preflight: /work/b',
};
const mutations = new Set(['writeFile', 'appendFile', 'writeStream', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'truncate', 'chmod', 'link', 'symlink', 'utimes']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function bytes(specification) {
  if (Object.hasOwn(specification, 'utf8')) return Buffer.from(specification.utf8);
  if (Object.hasOwn(specification, 'hex')) return Buffer.from(specification.hex, 'hex');
  if (specification.concat) return Buffer.concat(specification.concat.map(bytes));
  if (specification.repeat) {
    const fragment = bytes(specification.repeat);
    assert.ok(Number.isSafeInteger(specification.count) && specification.count >= 0 && fragment.length * specification.count <= 32 * 1024 * 1024);
    return Buffer.alloc(fragment.length * specification.count, fragment);
  }
  throw new Error(`unsupported byte recipe ${JSON.stringify(specification)}`);
}
function primitive(specification) {
  if (specification.kind === 'undefined') return undefined;
  if (specification.kind === 'primitive') return specification.value;
  return { marker: specification.ref };
}
function captured(payload) {
  const value = Buffer.from(payload);
  return { bytes: value.length, sha256: digest(value), ...(value.length <= 65536 ? { base64: value.toString('base64') } : {}) };
}
let shells = 0;
let disposed = 0;
let invocations = 0;
const results = [];
const unexpected = [];
const unhandled = reason => unexpected.push(reason);
process.on('unhandledRejection', unhandled);

async function snapshot(filesystem) {
  const result = {};
  async function walk(filename) {
    const stat = await filesystem.lstat(filename);
    if (stat.type === 'directory') {
      result[filename] = { type: 'directory' };
      for (const entry of await filesystem.readdir(filename)) await walk(path.posix.join(filename, typeof entry === 'string' ? entry : entry.name));
    } else if (stat.type === 'symlink') result[filename] = { type: 'symlink', target: await filesystem.readlink(filename) };
    else result[filename] = { type: 'file', ...captured(await filesystem.readFile(filename)) };
  }
  await walk('/');
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

async function runRow(row, variant) {
  const id = row.id + (variant ? `/${variant.key}` : '');
  if (skipped[row.id]) return { id, status: row.id === 'S54' ? 'STATIC_NONCONFORMANCE' : 'NOT_RUN', reason: skipped[row.id] };
  const initial = row.before;
  const realRoot = job.backend === 'real' ? path.join(job.fixtureRoot, id.replaceAll('/', '-')) : undefined;
  if (realRoot) fs.mkdirSync(realRoot);
  const base = realRoot ? new api.RealFileSystem(realRoot) : job.backend === 'mock-s3' ? new api.S3FileSystem({ transport: new api.MockS3Client({ buckets: ['independent-review'] }), bucket: 'independent-review', prefix: 'owned/' }) : new api.MemoryFileSystem();
  for (const directory of initial.directories ?? ['/', '/work']) if (directory !== '/') await base.mkdir(directory, { recursive: true });
  for (const [filename, value] of Object.entries(initial.files)) {
    await base.mkdir(path.posix.dirname(filename), { recursive: true });
    await base.writeFile(filename, bytes(value));
  }
  for (const [filename, target] of Object.entries(initial.symlinks ?? {})) await base.symlink(target, filename);
  await base.writeFile('/sentinel', Buffer.from('00ff8053656e74696e656c0d0a', 'hex'));
  const before = await snapshot(base);
  const root = new AbortController();
  const outputClosed = new AbortController();
  const refs = { primary: variant?.primary ? primitive(variant.primary) : undefined, 'sink-reason': variant?.reason ? primitive(variant.reason) : undefined };
  for (const ref of ['input-object', 'secondary-object', 'stderr-object', 'output-only-object', 'caller-object', 'late-next-object', 'late-return-object', 'cleanup-one', 'cleanup-two']) refs[ref] = { marker: ref };
  Object.assign(refs, row.provider?.reasonObjects);
  if (row.id === 'S52') root.abort(refs['caller-errno-object']);
  if (row.id === 'S60') outputClosed.abort(refs['output-only-object']);
  const calls = [];
  const occurrences = new Map();
  const provider = row.provider ?? {};
  const scope = {};
  let hiddenGarbageRemoved = false;
  let selectedSignal = root.signal;
  async function effect(event) {
    if (!event || typeof event !== 'object') return;
    for (const [filename, value] of Object.entries(event.create ?? event.replace ?? {})) await base.writeFile(filename, bytes(value));
    if (event.mkdir) await base.mkdir(event.mkdir);
  }
  const filesystem = new Proxy(base, { get(target, key) {
    if (key === 'capabilities') return { ...target.capabilities, ...provider.capabilities };
    const method = Reflect.get(target, key, target);
    if (key === 'compareEntry' && (provider.compareEntry !== undefined || provider.identity === 'omitted')) return async (filename, peer, peerPath, options) => {
      calls.push({ method: key, path: filename, peerPath, signalMatches: options?.signal === selectedSignal });
      if (typeof provider.compareEntry === 'object') throw refs[provider.compareEntry.rejectRef];
      return provider.compareEntry ?? 'unknown';
    };
    if (typeof method !== 'function') return method;
    return async (...args) => {
      const filename = args[0];
      const options = args.at(-1);
      const occurrence = (occurrences.get(`${key}:${filename}`) ?? 0) + 1;
      occurrences.set(`${key}:${filename}`, occurrence);
      const call = { method: key, path: filename, occurrence, signalMatches: options?.signal === selectedSignal };
      if (job.versioned && key === "access") call.mode = args[1];
      if (key === 'writeFile') Object.assign(call, { flag: options?.flag, payload: captured(args[1]) });
      if (key === 'readFile') call.maxBytes = options?.maxBytes;
      if (key === 'mkdir' || key === 'rm') call.recursive = options?.recursive ?? false;
      calls.push(call);
      const event = row.schedule?.find(item => item.at?.method === key && item.at.path === filename && (item.at.occurrence ?? 1) === occurrence);
      if (event) {
        await effect(event.beforeCallActor);
        await effect(event.effect);
        if (event.reject) throw new api.FsError(event.reject.code, { path: filename });
      }
      if (key === 'access') {
        const denial = provider.routes?.find(route => filename.startsWith(route.prefix))?.accessReject ?? ((!provider.access?.path || provider.access.path === filename) ? provider.access?.reject : undefined);
        if (denial) throw new api.FsError(denial.code, { path: filename, ...(denial.message ? { message: bytes(denial.message).toString() } : {}) });
      }
      if (key === 'readFile' && provider.housekeeping?.onReadFile === filename) hiddenGarbageRemoved = true;
      let value = await method.apply(target, args);
      if (key === 'lstat' || key === 'stat') {
        value = { ...value };
        if (provider.identity === 'omitted') { delete value.identityScope; delete value.dev; delete value.ino; }
        if (provider.identities?.[filename]) Object.assign(value, { identityScope: scope, dev: provider.identities[filename].dev, ino: provider.identities[filename].ino });
      }
      if (key === 'writeFile' && provider.backingAliases && provider.writeFile?.startsWith('in-place')) {
        const aliases = provider.backingAliases.find(group => group.includes(filename));
        for (const alias of aliases ?? []) if (alias !== filename) await base.writeFile(alias, args[1]);
      }
      for (const event of row.schedule ?? []) if (event.after?.method === key && event.after.path === filename) {
        await effect(event.actor);
        if (event.abort) root.abort(event.abort.value);
      }
      return value;
    };
  } });
  const invocation = structuredClone(row.invocation);
  if (variant?.headerPath !== undefined) invocation.stdin.chunks[0].utf8 = invocation.stdin.chunks[0].utf8.replace('*** Add File: a/\n', `*** Add File: ${variant.headerPath}\n`);
  const stdinSpec = invocation.stdin;
  let pulls = 0;
  let returns = 0;
  let acquired = 0;
  let handlerSettled = false;
  let returnWasPending = false;
  const deferred = [];
  const backing = Buffer.alloc(256, 0x7a);
  const stdin = { [Symbol.asyncIterator]() {
    acquired++;
    if (stdinSpec.acquire === 'THROW_IF_ACQUIRED') throw new Error('forbidden stdin acquisition');
    return {
      async next() {
        pulls++;
        if (row.id === 'S53') {
          const pending = new Promise((resolve, reject) => deferred.push(reject));
          root.abort(refs['caller-object']);
          return pending;
        }
        if (pulls > (stdinSpec.chunks?.length ?? 0)) {
          backing.fill(0x7a);
          if (stdinSpec.nextAfterChunks) throw refs[stdinSpec.nextAfterChunks.rejectRef];
          return { done: true };
        }
        const specification = stdinSpec.chunks[pulls - 1];
        if (specification.nonByteValue !== undefined) return { done: false, value: specification.nonByteValue };
        const payload = bytes(specification);
        if (row.id === 'S49') { backing.fill(0x7a); backing.set(payload, 7); return { done: false, value: backing.subarray(7, 7 + payload.length) }; }
        return { done: false, value: payload };
      },
      async return() {
        returns++;
        if (row.id === 'S53') return new Promise((resolve, reject) => deferred.push(reject));
        if (row.id === 'S79') {
          returnWasPending = !handlerSettled;
          await setImmediate();
          assert.equal(handlerSettled, false);
        }
        if (stdinSpec.return?.rejectRef) throw refs[stdinSpec.return.rejectRef];
        return { done: true };
      },
    };
  } };
  const stdout = [];
  const stderr = [];
  const cleanups = [];
  let outputWrites = 0;
  const stdoutSink = { async write(chunk) {
    outputWrites++;
    if (row.id === 'S58') throw refs['sink-reason'];
    stdout.push(Buffer.from(chunk));
  } };
  if (row.id === 'S60') stdoutSink.ownedOutput = { consumerClosed: outputClosed.signal, write: stdoutSink.write };
  const stderrSink = { async write(chunk) { if (row.id === 'S59') throw refs['stderr-object']; stderr.push(Buffer.from(chunk)); } };
  let args = (invocation.args ?? []).map(value => typeof value === 'string' ? value : String.fromCharCode(...value.utf16CodeUnits));
  if (invocation.argvUtf16) args = invocation.argvUtf16.map(sequence => String.fromCharCode(...sequence));
  if (invocation.argsUtf16) args = invocation.argsUtf16.map(sequence => String.fromCharCode(...sequence));
  const context = { command: 'apply_patch', args, cwd: invocation.cwd, env: {}, fs: filesystem, stdin, stdinIsDefault: false, signal: root.signal, stdout: stdoutSink, stderr: stderrSink, registerCleanup(cleanup) { cleanups.push(cleanup); } };
  if (row.id === 'S79') delete context.registerCleanup;
  let outcome;
  let rejected = false;
  let reason;
  let instance;
  let cleanupFailures = [];
  invocations++;
  try {
    if (invocation.route.startsWith('actual') || ['S52', 'S53', 'S55'].includes(row.id)) {
      instance = new api.Shell({ fs: filesystem, cwd: '/work' }); shells++;
      instance.use(module.applyPatchCommands());
      instance.use(async (commandContext, next) => {
        selectedSignal = commandContext.signal;
        if (row.id === 'S80' && commandContext.command === 'apply_patch') {
          commandContext.registerCleanup(async () => { throw refs['cleanup-one']; });
          commandContext.registerCleanup(async () => { throw refs['cleanup-two']; });
        }
        return next();
      });
      if (!invocation.script) instance.register({ name: 'review_parent', execute: parent => parent.invoke('apply_patch', args, { stdin, stdinIsDefault: false, ...(row.id === 'S64' ? { replaceEnv: true, env: { HOME: '/not-expanded' } } : {}) }) });
      outcome = await instance.exec(invocation.script ?? 'review_parent', { signal: root.signal, stdout: stdoutSink, stderr: stderrSink, ...(invocation.script ? {} : { stdin }) });
    } else outcome = await module.createApplyPatchCommand().execute(context);
  } catch (error) { rejected = true; reason = error; }
  finally {
    handlerSettled = true;
    for (const reject of deferred) reject(refs['late-next-object']);
    cleanupFailures = (await Promise.allSettled(cleanups.map(cleanup => cleanup()))).filter(entry => entry.status === 'rejected');
    if (instance) { await instance.dispose(); disposed++; }
    await setImmediate();
  }
  const after = await snapshot(base);
  const output = Buffer.concat(stdout);
  const errors = Buffer.concat(stderr);
  const raw = { before, after, rejected, exitCode: outcome?.exitCode ?? null, reasonType: rejected ? typeof reason : null, stdout: captured(output), stderr: captured(errors), calls, pulls, returns, acquired, outputWrites, cleanups: cleanups.length, hiddenGarbageRemoved, cleanupFailures: cleanupFailures.length, rootAborted: root.signal.aborted };
  const failures = [];
  const check = (label, action) => { try { action(); } catch (error) { failures.push({ label, message: error.message }); } };
  const expected = row.expected;
  check('outcome', () => {
    if (expected.outcome.kind === 'return') { assert.equal(rejected, false); assert.equal(outcome.exitCode, expected.outcome.exitCode); }
    else if (expected.outcome.kind === 'reject-class') { assert.equal(rejected, true); assert.equal(reason?.name, expected.outcome.class); }
    else if (expected.outcome.kind === 'reject-ref') { assert.equal(rejected, true); assert.equal(reason, expected.outcome.ref === 'caller-zero' ? 0 : refs[expected.outcome.ref]); }
    else if (expected.outcome.kind === 'reject-aggregate') { assert.equal(rejected, true); assert.ok(reason instanceof AggregateError); assert.equal(reason.errors.length, 2); assert.ok(reason.errors.includes(refs['cleanup-one']) && reason.errors.includes(refs['cleanup-two'])); }
    else assert.fail(`unbound outcome ${expected.outcome.kind}`);
  });
  check('stdout', () => { if (expected.stdout.utf8 !== undefined || expected.stdout.hex !== undefined) assert.deepEqual(output, bytes(expected.stdout)); else assert.fail('unbound stdout expectation'); });
  check('stderr', () => {
    if (job.versioned && expected.stderr.exactUtf8Alternatives) assert.ok(expected.stderr.exactUtf8Alternatives.some(value => errors.equals(Buffer.from(value))), "exact adjudicated diagnostic branch set");
    else if (expected.stderr.utf8 !== undefined || expected.stderr.hex !== undefined) assert.deepEqual(errors, bytes(expected.stderr));
    else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(errors);
      assert.ok(errors.length <= 16384 && text.startsWith('apply_patch: ') && text.endsWith('\n'));
      const meaning = row.diagnosticReason ?? reasons[row.id];
      assert.ok(meaning, 'missing source-bound diagnostic predicate');
      assert.ok(text.includes(meaning), `expected reason ${meaning}, got ${text}`);
      if (expected.operationOrdinal) assert.ok(text.includes(`operation ${expected.operationOrdinal}; prior changes may remain:`));
      else assert.ok(!text.includes('prior changes may remain'));
      if (expected.diagnosticTruncationSuffix) assert.ok(text.endsWith(expected.diagnosticTruncationSuffix));
    }
  });
  check('complete namespace and exact bytes', () => {
    const desired = { '/': { type: 'directory' }, '/sentinel': before['/sentinel'] };
    for (const directory of expected.directories ?? initial.directories ?? ['/', '/work']) desired[directory] = { type: 'directory' };
    for (const [filename, specification] of Object.entries(expected.files)) desired[filename] = { type: 'file', ...captured(bytes(specification)) };
    for (const [filename, target] of Object.entries(initial.symlinks ?? {})) desired[filename] = { type: 'symlink', target };
    assert.deepEqual(after, Object.fromEntries(Object.entries(desired).sort(([left], [right]) => left.localeCompare(right))));
    for (const filename of expected.absent ?? []) assert.equal(after[filename], undefined, filename);
  });
  check('trace and safety', () => {
    if (expected.constraints.includes('ZERO_FS_CALLS')) assert.equal(calls.length, 0);
    if (expected.constraints.includes('NO_COMMAND_MUTATION')) assert.equal(calls.filter(call => mutations.has(call.method)).length, 0);
    for (const call of calls) assert.equal(call.signalMatches, true, `signal ${call.method}`);
    for (const method of expected.operationTrace?.forbid ?? []) assert.ok(!calls.some(call => call.method === method), method);
    for (const filename of expected.operationTrace?.forbidPaths ?? []) assert.ok(!calls.some(call => call.path === filename), filename);
    for (const condition of expected.operationTrace?.forbidMatching ?? []) assert.ok(!calls.some(call => Object.entries(condition).every(([key, value]) => call[key] === value)));
    for (const condition of expected.operationTrace?.required ?? []) assert.ok(calls.some(call => Object.entries(condition).every(([key, value]) => key === 'phase' || key === 'bytes' || call[key] === value)), JSON.stringify(condition));
    if (expected.operationTrace?.writeFileCalls !== undefined) assert.equal(calls.filter(call => call.method === 'writeFile').length, expected.operationTrace.writeFileCalls);
    for (const flag of expected.operationTrace?.forbidFlags ?? []) assert.ok(!calls.some(call => call.flag === flag));
    for (const event of row.schedule ?? []) if (event.requireFlag) assert.equal(calls.find(call => call.method === event.at.method && call.path === event.at.path)?.flag, event.requireFlag);
    if (expected.constraints.includes('MOVE')) {
      const removal = calls.findIndex(call => call.method === 'rm');
      if (removal >= 0) { assert.ok(calls.slice(0, removal).some(call => call.method === 'writeFile' && call.flag === 'wx')); assert.equal(calls[removal].recursive, false); }
    }
    if (expected.iteratorReturnCalls !== undefined) assert.equal(returns, expected.iteratorReturnCalls);
    if (stdinSpec.acquire === 'THROW_IF_ACQUIRED') assert.equal(acquired, 0);
    if (job.versioned && expected.stdinPulls !== undefined) assert.equal(pulls, expected.stdinPulls);
    if (expected.adapterEffects?.hiddenGarbageRemoved) assert.equal(hiddenGarbageRemoved, true);
    if (row.id === 'S79') assert.equal(returnWasPending, true);
    if (row.id === 'S60') assert.equal(root.signal.aborted, false);
    assert.equal(cleanupFailures.length, 0);
  });
  return { id, status: failures.length ? 'FAIL' : 'PASS', raw, failures, qualification: 'Exact bytes/namespace/status-or-live-identity and listed trace predicates; phase labels on required trace entries are existence checks, not full phase-order instrumentation' };
}

function capCase(cap, endpoint) {
  const row = structuredClone(originals[0]);
  row.id = `${cap}/${endpoint}`;
  const delta = endpoint === 'minus' ? -1 : endpoint === 'over' ? 1 : 0;
  const wrap = body => `*** Begin Patch\n${body}*** End Patch\n`;
  row.expected.files = {};
  row.expected.stdout.utf8 = 'Success. Updated the following files:\n';
  let patch;
  if (cap === 'L01') {
    const amount = 4194304 + delta - 48;
    patch = wrap(`*** Add File: a\n+${'x'.repeat(amount)}\n`);
    row.expected.files['/work/a'] = { concat: [{ repeat: { utf8: 'x' }, count: amount }, { utf8: '\n' }] };
    row.expected.stdout.utf8 += 'A a\n';
    row.diagnosticReason = 'maxPatchBytes';
  } else if (cap === 'L02') {
    const amount = 8388608 + delta - 5;
    row.before.files['/work/a'] = { concat: [{ repeat: { utf8: 'x' }, count: amount }, { utf8: '\nold\n' }] };
    patch = wrap('*** Update File: a\n@@\n-old\n+new\n');
    row.expected.files['/work/a'] = { concat: [{ repeat: { utf8: 'x' }, count: amount }, { utf8: '\nnew\n' }] };
    row.expected.stdout.utf8 += 'M a\n';
    row.diagnosticReason = 'target size limit';
  } else if (cap === 'L05') {
    patch = wrap(Array.from({ length: 256 + delta }, (_, index) => `*** Add File: f${index}\n`).join(''));
    for (let index = 0; index < 256 + delta; index++) { row.expected.files[`/work/f${index}`] = { utf8: '' }; row.expected.stdout.utf8 += `A f${index}\n`; }
    row.diagnosticReason = 'maxFiles';
  } else if (cap === 'L06') {
    row.before.files['/work/a'] = { utf8: '' };
    patch = wrap(`*** Update File: a\n${'@@\n+x\n'.repeat(4096 + delta)}`);
    row.expected.files['/work/a'] = { repeat: { utf8: 'x\n' }, count: 4096 + delta };
    row.expected.stdout.utf8 += 'M a\n';
    row.diagnosticReason = 'maxHunks';
  } else if (cap === 'L07') {
    const filename = '/' + 'x'.repeat(16383 + delta);
    patch = wrap(`*** Add File: ${filename}\n+\n`);
    row.expected.files[filename] = { utf8: '\n' };
    row.expected.stdout.utf8 += `A ${filename}\n`;
    row.diagnosticReason = 'UTF-8 byte limit';
  } else if (cap === 'L10') {
    patch = wrap('*** Add File: a\n+x\n');
    row.invocation.stdin.chunks = [...Array.from({ length: 65535 + delta }, () => ({ hex: '' })), { utf8: patch }];
    row.expected.files['/work/a'] = { utf8: 'x\n' };
    row.expected.stdout.utf8 += 'A a\n';
    row.diagnosticReason = 'maxInputChunks';
  } else throw new Error(`unbound cap ${cap}`);
  if (cap !== 'L10') row.invocation.stdin.chunks = [{ utf8: patch }];
  if (endpoint === 'over') {
    row.expected.outcome.exitCode = 1;
    row.expected.files = structuredClone(row.before.files);
    row.expected.stdout = { utf8: '' };
    row.expected.stderr = { semantic: 'preflight-diagnostic' };
    row.expected.constraints = ['GLOBAL', 'INITIAL_PREFLIGHT', 'NO_COMMAND_MUTATION', ...(cap === 'L02' ? [] : ['ZERO_FS_CALLS'])];
  }
  return row;
}
assert.equal(api.createAgentCommands().length, 78);
assert.equal(Object.hasOwn(api, 'createApplyPatchCommand'), false);
const selected = job.rows ?? (job.cap ? [capCase(job.cap, job.endpoint)] : [...originals, ...supplements].filter(row => job.ids.includes(row.id)));
for (const row of selected) if (job.versioned) { row.versionedId = row.id; row.id = row.executionId; }
for (const row of selected) {
  for (const variant of row.variants ?? [undefined]) {
    const timer = setTimeout(() => { console.error('CASE_TIMEOUT_UNSAFE_STOP'); process.exit(91); }, 30000);
    let result;
    try { result = await runRow(row, variant); }
    catch (error) { result = { id: row.id + (variant ? `/${variant.key}` : ''), status: 'HARNESS_ERROR', message: error.stack }; }
    finally { clearTimeout(timer); }
    if (row.versionedId) result.id = row.versionedId;
    results.push(result);
    console.log(JSON.stringify({ kind: 'case', ...result }));
    if (result.status === 'HARNESS_ERROR' || unexpected.length) break;
  }
}
await setImmediate();
assert.equal(shells, disposed);
assert.equal(unexpected.length, 0, 'unhandled rejection stops dependent admission');
process.removeListener('unhandledRejection', unhandled);
return { kind: 'legacy', job: job.id, invocations, shells, disposed, complete: !results.some(row => row.status === 'HARNESS_ERROR'), cases: results.map(({ raw, ...row }) => row), markers: [...globalThis.reviewMarkers] };
}
