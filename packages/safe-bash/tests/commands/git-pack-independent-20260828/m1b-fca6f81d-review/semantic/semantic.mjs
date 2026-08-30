import { lstat, readFile } from 'node:fs/promises';
import { createFixture, digest } from './fixtures.mjs';

const bindings = {
  'FROZEN-DATA.json': [128512, 'a57c3da7b9354dd5d5cc1af23f5a10160aaafa0a2f05c94ee64d022946b4811d'],
  'CASE-DATA.json': [166027, 'cdff96c2817366c7506e1cf785f9b4ca9056cfc1d787df232bd1dde95d6f2ff0'],
};
const maximumOutput = 131072;
const maximumEvents = 512;
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset').get;
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength').get;

function requireFixture(condition, message) {
  if (!condition) throw new Error(`UNSAFE_SEMANTIC_FIXTURE: ${message}`);
}

async function boundData(name) {
  const [size, hash] = bindings[name];
  const location = new URL(name, import.meta.url);
  const stat = await lstat(location);
  requireFixture(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o644 && stat.size === size, 'data projection');
  const bytes = await readFile(location);
  requireFixture(bytes.length === size && digest(bytes) === hash, 'data hash');
  return JSON.parse(bytes);
}

function copyBytes(value) {
  requireFixture(ArrayBuffer.isView(value) && typedTag.call(value) === 'Uint8Array', 'byte payload brand');
  const length = typedLength.call(value);
  requireFixture(length <= maximumOutput, 'single byte payload cap');
  const keys = Reflect.ownKeys(value);
  requireFixture(keys.length === length, 'byte payload extras');
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireFixture(keys[index] === String(index) && descriptor && 'value' in descriptor && Number.isInteger(descriptor.value) && descriptor.value >= 0 && descriptor.value <= 255, 'byte own data');
  }
  return Buffer.from(new Uint8Array(typedBuffer.call(value), typedOffset.call(value), length));
}

function ownRecord(value, keys) {
  if (value === null || typeof value !== 'object') return { valid: false, fields: {} };
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) return { valid: false, fields: {} };
  const fields = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return { valid: false, fields: {} };
    fields[key] = descriptor.value;
  }
  return { valid: true, fields };
}

function reasonDescription(reason) {
  const description = { type: typeof reason, isNull: reason === null, ownMessage: null, ownCode: null, ownName: null, messageOversize: false, inspectionFailed: false };
  if (reason !== null && (typeof reason === 'object' || typeof reason === 'function')) {
    try {
      const field = Object.getOwnPropertyDescriptor(reason, 'message');
      if (field && 'value' in field && typeof field.value === 'string') {
        description.messageOversize = Buffer.byteLength(field.value) > 4096;
        if (!description.messageOversize) description.ownMessage = field.value;
      }
      for (const [key, output] of [['code', 'ownCode'], ['name', 'ownName']]) {
        const descriptor = Object.getOwnPropertyDescriptor(reason, key);
        if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
          if (Buffer.byteLength(descriptor.value) > 4096) description.messageOversize = true;
          else description[output] = descriptor.value;
        }
      }
    } catch {
      description.inspectionFailed = true;
    }
  }
  return description;
}

function parent(path) {
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

async function populate(memory, files, signal) {
  await memory.mkdir('/repo', { recursive: true, mode: 0o755, signal });
  for (const file of files) {
    signal.throwIfAborted();
    const path = '/repo/' + file.path;
    await memory.mkdir(parent(path), { recursive: true, mode: 0o755, signal });
    if (file.type === 'directory') await memory.mkdir(path, { mode: file.mode, signal });
    else await memory.writeFile(path, file.bytes, { mode: file.mode, signal });
  }
}

async function snapshot(memory, signal) {
  const output = [];
  const pending = ['/'];
  let readBytes = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const path = pending.pop();
    const stat = await memory.lstat(path, { signal });
    requireFixture(output.length < 128 && (stat.type === 'file' || stat.type === 'directory'), 'namespace bound/type');
    const row = { path, type: stat.type, mode: stat.mode, bytes: 0, sha256: null };
    if (stat.type === 'file') {
      requireFixture(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= 524288 - readBytes, 'snapshot extent');
      const bytes = await memory.readFile(path, { signal, maxBytes: stat.size });
      requireFixture(bytes.byteLength === stat.size, 'snapshot read size');
      readBytes += bytes.byteLength;
      row.bytes = bytes.byteLength;
      row.sha256 = digest(bytes);
    } else {
      const children = await memory.readdir(path, { signal });
      requireFixture(children.length <= 80, 'namespace fanout');
      for (const child of children) {
        requireFixture(typeof child.name === 'string' && child.name !== '.' && child.name !== '..' && !child.name.includes('/'), 'namespace component');
        pending.push((path === '/' ? '' : path) + '/' + child.name);
      }
    }
    output.push(row);
  }
  return output.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function expectedInventory(files, before, changedSidecar) {
  const names = new Set(['/', '/repo']);
  const expectedFiles = new Map();
  for (const file of files) {
    const path = '/repo/' + file.path;
    let ancestor = parent(path);
    while (ancestor !== '/') { names.add(ancestor); ancestor = parent(ancestor); }
    names.add(path);
    if (file.type === 'file') expectedFiles.set(path, { mode: file.mode, bytes: file.bytes.length, sha256: digest(file.bytes) });
  }
  const valid = before.length === names.size && before.every(row => names.has(row.path) && (expectedFiles.has(row.path) ? row.type === 'file' && row.mode === expectedFiles.get(row.path).mode && row.bytes === expectedFiles.get(row.path).bytes && row.sha256 === expectedFiles.get(row.path).sha256 : row.type === 'directory'));
  const after = before.map(row => changedSidecar === row.path ? { ...row, bytes: 1, sha256: digest(Buffer.from('B')) } : row);
  return { valid, after };
}

function provider(memory, fixture, spec, state, sentinel) {
  const keep = '/repo/' + fixture.lastStem + '.keep';
  const packedPath = '/repo/' + fixture.lastStem + '.pack';
  const add = (operation, path) => {
    requireFixture(state.events.length < maximumEvents, 'FS event capture cap');
    state.events.push({ operation, path });
  };
  return new Proxy(memory, {
    get(target, key) {
      if (key === 'lstat') return async (path, options) => {
        add('lstat', path);
        if (spec.actor === 'host-null' || spec.actor === 'host-undefined') { state.actorFired++; throw sentinel; }
        const stat = await target.lstat(path, options);
        if (path === keep && (spec.actor === 'sidecar-stat' || spec.actor === 'sidecar-body')) {
          state.keepObservations++;
          state.originalKeepStat ??= stat;
          if (state.keepObservations === 2) {
            state.actorFired++;
            if (spec.actor === 'sidecar-body') await target.writeFile(path, Buffer.from('B'), { signal: options?.signal });
          }
          if (spec.actor === 'sidecar-body') return state.originalKeepStat;
          if (state.keepObservations >= 2) return { ...stat, size: stat.size + 1 };
        }
        return stat;
      };
      if (key === 'readFile') return async (path, options) => { add('readFile', path); return target.readFile(path, options); };
      if (key === 'readStream') return (path, options) => {
        add('readStream', path);
        if (path === packedPath) state.packReads++;
        const change = spec.actor === 'pack-change' && path === packedPath && state.packReads === 2;
        if (spec.actor !== 'borrowed' && !change) return target.readStream(path, options);
        return { async *[Symbol.asyncIterator]() {
          state.readersStarted++;
          try {
            const bytes = await target.readFile(path, options);
            if (change) {
              const owned = Buffer.from(bytes);
              owned[0] ^= 1;
              state.actorFired++;
              yield owned;
              return;
            }
            const owner = new Uint8Array(23);
            for (let offset = 0; offset < bytes.length; offset += 17) {
              options?.signal?.throwIfAborted();
              const count = Math.min(17, bytes.length - offset);
              owner.set(bytes.subarray(offset, offset + count), 3);
              state.borrowedRows++;
              yield owner.subarray(3, 3 + count);
              owner.fill(123);
            }
          } finally { state.readersFinished++; }
        } };
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function quote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function observe(api, data, spec, expected, label) {
  const cleanups = [];
  let shell;
  let closing;
  let cleanupCompleted = 0;
  const close = () => closing ??= (async () => {
    const errors = [];
    if (shell) {
      try { await shell.dispose(); cleanupCompleted++; } catch (reason) { errors.push(reason); }
    }
    for (const cleanup of [...cleanups].reverse()) {
      try { await cleanup(); cleanupCompleted++; } catch (reason) { errors.push(reason); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Semantic owned cleanup failed');
  })();
  api.registerCleanup(close);
  api.signal.throwIfAborted();
  const fixture = createFixture(data, spec);
  await api.capture(label + '-fixture', { args: fixture.args, packs: fixture.facts, fileCount: fixture.files.length, fileBytes: fixture.files.reduce((sum, row) => sum + row.bytes.length, 0), role: 'FIXTURE_CONSTRUCTION_NOT_PRODUCT_PASS' });
  const memoryModule = await api.load('dist/fs/memory/index.js');
  const gitModule = await api.load('dist/commands/git/index.js');
  const memory = new memoryModule.MemoryFileSystem();
  await populate(memory, fixture.files, api.signal);
  const before = await snapshot(memory, api.signal);
  const changedSidecar = spec.actor === 'sidecar-body' ? '/repo/' + fixture.lastStem + '.keep' : null;
  const inventory = expectedInventory(fixture.files, before, changedSidecar);
  await api.capture(label + '-namespace-before', { inventory: before, matchesFixture: inventory.valid });
  requireFixture(inventory.valid, 'populated filesystem differs from declared fixture');
  const sentinel = spec.actor === 'host-null' ? null : spec.actor === 'host-undefined' ? undefined : { caseId: api.caseId, reason: spec.actor ?? 'none' };
  const state = { events: [], actorFired: 0, keepObservations: 0, originalKeepStat: null, packReads: 0, readersStarted: 0, readersFinished: 0, borrowedRows: 0, stdinReads: 0 };
  const virtual = provider(memory, fixture, spec, state, sentinel);
  const controller = new AbortController();
  if (spec.actor === 'preabort') controller.abort(sentinel);
  const signal = spec.actor === 'preabort' ? controller.signal : api.signal;
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const sink = (pieces, kind) => ({ async write(chunk) {
    if (kind === 'stdout' && spec.actor === 'sink-reason') { state.actorFired++; throw sentinel; }
    const bytes = copyBytes(chunk);
    const total = (kind === 'stdout' ? stdoutBytes : stderrBytes) + bytes.length;
    requireFixture(total <= maximumOutput && pieces.length < 128, 'stream collection cap');
    if (kind === 'stdout') stdoutBytes = total; else stderrBytes = total;
    pieces.push(bytes);
    await api.captureBytes(`${label}-${kind}-chunk-${pieces.length}`, bytes);
  } });
  let hasThrown = false;
  let thrown;
  let result;
  try {
    if (spec.shell) {
      const shellModule = await api.load('dist/shell/shell.js');
      shell = new shellModule.Shell({ fs: virtual, cwd: '/repo', env: {} });
      shell.use(gitModule.gitCommands());
      result = await shell.exec('git ' + fixture.args.map(quote).join(' '), { signal, stdout: sink(stdout, 'stdout'), stderr: sink(stderr, 'stderr') });
    } else {
      const command = gitModule.createGitCommand();
      result = await command.execute({ command: 'git', args: fixture.args, cwd: '/repo', env: {}, fs: virtual, signal,
        stdin: { async *[Symbol.asyncIterator]() { state.stdinReads++; throw new Error('Git unexpectedly consumed fixture stdin'); } }, stdinIsDefault: true,
        stdout: sink(stdout, 'stdout'), stderr: sink(stderr, 'stderr'),
        registerCleanup(cleanup) { requireFixture(typeof cleanup === 'function' && cleanups.length < 128, 'cleanup enrollment'); cleanups.push(cleanup); },
      });
    }
  } catch (reason) { hasThrown = true; thrown = reason; }
  const record = hasThrown ? { valid: false, fields: {} } : ownRecord(result, spec.shell ? ['stdout', 'stderr', 'stdoutBytes', 'stderrBytes', 'exitCode'] : ['exitCode']);
  const code = record.valid && typeof record.fields.exitCode === 'number' ? record.fields.exitCode : null;
  const out = Buffer.concat(stdout);
  const err = Buffer.concat(stderr);
  const reasonFact = reasonDescription(thrown);
  await api.captureBytes(label + '-stdout', out);
  await api.captureBytes(label + '-stderr', err);
  await api.capture(label + '-outcome', { hasThrown, reason: reasonFact, reasonMatchesExpectedInThisProcess: hasThrown && thrown === sentinel, resultOwnDataShape: record.valid, exitCode: code, signalAborted: signal.aborted, stdoutBytes: out.length, stderrBytes: err.length });
  try { await close(); }
  catch (reason) {
    await api.capture(label + '-cleanup-unsafe', { failed: true, reason: reasonDescription(reason), completed: cleanupCompleted, role: 'OWNED_HARNESS_CLEANUP_UNSAFE_STOP_NOT_H09_LEAK_CLAIM' });
    throw reason;
  }
  const after = await snapshot(memory, api.signal);
  await api.capture(label + '-observations', { after, expectedAfter: inventory.after, events: state.events, actorFired: state.actorFired, keepObservations: state.keepObservations, packReads: state.packReads, readersStarted: state.readersStarted, readersFinished: state.readersFinished, borrowedRows: state.borrowedRows, stdinReads: state.stdinReads, cleanupRegistered: cleanups.length + (shell ? 1 : 0), cleanupCompleted, qualification: 'Owned fixture/Shell cleanup only; no native codec, handle, callback or H09 credit.' });
  const expectedOut = expected.stdoutBase64 === undefined ? Buffer.from(expected.stdoutText) : Buffer.from(expected.stdoutBase64, 'base64');
  const expectedErr = Buffer.from(expected.stderrText);
  const checks = [
    ['rejection-presence', hasThrown === Boolean(expected.rejected)],
    ['status-or-actual-reason', expected.rejected ? hasThrown && thrown === sentinel : record.valid && Number.isInteger(code) && code === expected.exitCode],
    ['stdout-bytes', out.equals(expectedOut)],
    ['stderr-bytes', err.equals(expectedErr)],
    ['namespace-effects', JSON.stringify(after) === JSON.stringify(inventory.after)],
    ['owned-cleanup-completed', cleanupCompleted === cleanups.length + (shell ? 1 : 0)],
    ['reason-inspection', !reasonFact.messageOversize && !reasonFact.inspectionFailed],
  ];
  if (!spec.shell) checks.push(['stdin-not-consumed', state.stdinReads === 0]);
  if (spec.shell && !hasThrown && record.valid) {
    const shellBytes = { stdout: copyBytes(record.fields.stdoutBytes), stderr: copyBytes(record.fields.stderrBytes) };
    await api.capture(label + '-shell-projection', { stdoutType: typeof record.fields.stdout, stderrType: typeof record.fields.stderr, stdoutText: typeof record.fields.stdout === 'string' ? record.fields.stdout : null, stderrText: typeof record.fields.stderr === 'string' ? record.fields.stderr : null, stdoutHash: digest(shellBytes.stdout), stderrHash: digest(shellBytes.stderr) });
    checks.push(['shell-byte-projection', shellBytes.stdout.equals(out) && shellBytes.stderr.equals(err)]);
    checks.push(['shell-text-projection', record.fields.stdout === expectedOut.toString('utf8') && record.fields.stderr === expectedErr.toString('utf8')]);
  }
  if (spec.actor === 'borrowed') checks.push(['borrowed-fixture-reached-and-finalized', state.borrowedRows > 0 && state.readersStarted > 0 && state.readersStarted === state.readersFinished]);
  if (['sidecar-stat', 'sidecar-body', 'pack-change', 'sink-reason', 'host-null', 'host-undefined'].includes(spec.actor)) checks.push(['declared-actor-reached', state.actorFired > 0]);
  if (spec.actor === 'preabort') checks.push(['preabort-no-provider-admission', state.events.length === 0]);
  if (spec.actor?.startsWith('sidecar')) {
    const sidecarPaths = new Set((spec.extra ?? []).map(row => '/repo/' + row.path.replace('@PACK@', fixture.lastStem)));
    checks.push(['inert-sidecar-no-body-read', !state.events.some(row => (row.operation === 'readStream' || row.operation === 'readFile') && sidecarPaths.has(row.path))]);
  }
  for (const [name, passed] of checks) await api.check(label + '-' + name, passed, { caseId: api.caseId, layout: api.layout });
  return checks.every(([, passed]) => passed);
}

export async function runCase(api, caseId) {
  requireFixture(api.caseId === caseId && (api.layout === 'S' || api.layout === 'M'), 'runner identity');
  const data = await boundData('FROZEN-DATA.json');
  const table = await boundData('CASE-DATA.json');
  const row = table.cases.find(value => value.id === caseId);
  requireFixture(row !== undefined, 'undeclared case');
  if (row.control) {
    const success = await observe(api, data, row.control, { exitCode: 0, stdoutText: '/repo\n', stderrText: '' }, 'pristine');
    if (!success) {
      await api.capture('variant-unrun', { reason: 'pristine-control-contradiction', caseId, inheritedPass: false });
      return;
    }
  }
  await observe(api, data, row.spec, row.expected, 'variant');
}
