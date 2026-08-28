import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFixture, digest } from '../semantic/fixtures.mjs';

const bindings = {
  'WITNESSES.json': [10543, '7131dbdca29346915b4d2e600fd3dc63f30a4965ae80fd7fde67a34999dba3e3'],
  '../semantic/CASE-DATA.json': [166027, 'cdff96c2817366c7506e1cf785f9b4ca9056cfc1d787df232bd1dde95d6f2ff0'],
  '../semantic/FROZEN-DATA.json': [128512, 'a57c3da7b9354dd5d5cc1af23f5a10160aaafa0a2f05c94ee64d022946b4811d'],
};
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset').get;
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength').get;

function demand(condition, message) {
  if (!condition) throw new Error('UNSAFE_LOADED_WITNESS: ' + message);
}

async function boundData(name) {
  const [size, hash] = bindings[name];
  const location = new URL(name, import.meta.url);
  const stat = await lstat(location);
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o644 && stat.size === size, 'data projection');
  const bytes = await readFile(location);
  demand(bytes.length === size && digest(bytes) === hash, 'data hash');
  return JSON.parse(bytes);
}

function ownedBytes(value, maximum) {
  demand(ArrayBuffer.isView(value) && typedTag.call(value) === 'Uint8Array', 'byte payload type');
  const length = typedLength.call(value);
  demand(length <= maximum, 'byte payload bound');
  const keys = Reflect.ownKeys(value);
  demand(keys.length === length, 'byte payload extra fields');
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    demand(keys[index] === String(index) && descriptor && 'value' in descriptor && Number.isInteger(descriptor.value) && descriptor.value >= 0 && descriptor.value <= 255, 'byte own data');
  }
  return Buffer.from(new Uint8Array(typedBuffer.call(value), typedOffset.call(value), length));
}

function resultCode(value) {
  if (value === null || typeof value !== 'object') return null;
  const keys = Reflect.ownKeys(value);
  const field = Object.getOwnPropertyDescriptor(value, 'exitCode');
  return keys.length === 1 && keys[0] === 'exitCode' && field && 'value' in field && Number.isInteger(field.value) ? field.value : null;
}

function describeReason(value) {
  const result = { type: typeof value, isNull: value === null, ownMessage: null, inspectionFailed: false, oversized: false };
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'message');
      if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
        result.oversized = Buffer.byteLength(descriptor.value) > 4096;
        if (!result.oversized) result.ownMessage = descriptor.value;
      }
    } catch { result.inspectionFailed = true; }
  }
  return result;
}

async function candidateBinding(api, transform, stage, label) {
  const filename = resolve(api.candidateRoot, transform.outputPath);
  const expected = stage === 'MUTANT' ? transform.emittedPostimage : transform.emittedPreimage;
  demand(await realpath(filename) === filename, 'candidate canonical regular path');
  const stat = await lstat(filename);
  demand(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === transform.mode && stat.size === expected.bytes, 'candidate entry projection');
  const bytes = await readFile(filename);
  const actual = { path: filename, mode: stat.mode & 0o777, bytes: bytes.length, sha256: digest(bytes) };
  await api.capture(label, { actual, expected, transformId: transform.id, stage, qualification: 'Entry check only. Full910 membership and actual import closure are mandatory independent parent guards, not established by this receipt.' });
  demand(actual.bytes === expected.bytes && actual.sha256 === expected.sha256, 'candidate entry hash');
}

async function populate(memory, files, signal) {
  await memory.mkdir('/repo', { recursive: true, mode: 0o755, signal });
  for (const file of files) {
    signal.throwIfAborted();
    const path = '/repo/' + file.path;
    await memory.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o755, signal });
    demand(file.type === 'file', 'selected fixture file kind');
    await memory.writeFile(path, file.bytes, { mode: file.mode, signal });
  }
}

async function snapshot(memory, signal) {
  const rows = [];
  const pending = ['/'];
  const visited = new Set();
  let bytesRead = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const path = pending.pop();
    demand(!visited.has(path) && rows.length < 128, 'namespace entry bound');
    visited.add(path);
    const stat = await memory.lstat(path, { signal });
    demand(stat.type === 'file' || stat.type === 'directory', 'namespace kind');
    const row = { path, type: stat.type, mode: stat.mode, bytes: 0, sha256: null };
    if (stat.type === 'file') {
      demand(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= 524288 - bytesRead, 'namespace bytes');
      const body = ownedBytes(await memory.readFile(path, { signal, maxBytes: stat.size }), stat.size);
      demand(body.length === stat.size, 'namespace read extent');
      bytesRead += body.length;
      row.bytes = body.length;
      row.sha256 = digest(body);
    } else {
      const children = await memory.readdir(path, { signal });
      demand(children.length <= 80 && pending.length + children.length <= 128, 'namespace fanout');
      for (const child of children) {
        demand(typeof child.name === 'string' && child.name.length > 0 && child.name !== '.' && child.name !== '..' && !child.name.includes('/'), 'namespace component');
        pending.push((path === '/' ? '' : path) + '/' + child.name);
      }
    }
    rows.push(row);
  }
  return rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function exactInitialNamespace(files, actual) {
  const expected = new Map([['/', { type: 'directory', mode: 0o040755 }], ['/repo', { type: 'directory', mode: 0o040755 }]]);
  for (const file of files) {
    const path = '/repo/' + file.path;
    expected.set(path, { type: 'file', mode: 0o100000 | file.mode, bytes: file.bytes.length, sha256: digest(file.bytes) });
    let ancestor = path.slice(0, path.lastIndexOf('/'));
    while (ancestor !== '/') {
      expected.set(ancestor, { type: 'directory', mode: 0o040755 });
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/')) || '/';
    }
  }
  return actual.length === expected.size && actual.every(row => {
    const wanted = expected.get(row.path);
    return wanted && row.type === wanted.type && row.mode === wanted.mode && (wanted.type === 'directory' || (row.bytes === wanted.bytes && row.sha256 === wanted.sha256));
  });
}

async function observe(api, frozen, spec, expected, label) {
  const cleanups = [];
  let closing;
  let cleanupCompleted = 0;
  const close = () => closing ??= (async () => {
    const errors = [];
    for (const cleanup of [...cleanups].reverse()) {
      try { await cleanup(); cleanupCompleted++; } catch (reason) { errors.push(reason); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Loaded witness owned cleanup failed');
  })();
  api.registerCleanup(close);
  api.signal.throwIfAborted();
  const fixture = createFixture(frozen, spec);
  demand(JSON.stringify(fixture.args) === '["rev-parse","--show-toplevel"]', 'unchanged witness argv');
  await api.capture(label + '-fixture', { args: fixture.args, packs: fixture.facts, fileCount: fixture.files.length, fileBytes: fixture.files.reduce((total, row) => total + row.bytes.length, 0), role: 'FIXTURE_DATA_NOT_PRODUCT_PROOF' });
  const memoryModule = await api.load('dist/fs/memory/index.js');
  const gitModule = await api.load('dist/commands/git/index.js');
  const memory = new memoryModule.MemoryFileSystem();
  await populate(memory, fixture.files, api.signal);
  const before = await snapshot(memory, api.signal);
  const initialMatches = exactInitialNamespace(fixture.files, before);
  await api.capture(label + '-namespace-before', { before, initialMatches });
  demand(initialMatches, 'fixture namespace construction');
  const stdout = [];
  const stderr = [];
  const streamSizes = { stdout: 0, stderr: 0 };
  const stdinReason = { caseId: api.caseId, boundary: 'unexpected-stdin' };
  let stdinReads = 0;
  let unsafe = false;
  let unsafeReason;
  const sink = (chunks, name) => ({ async write(chunk) {
    try {
      const owned = ownedBytes(chunk, 4096);
      demand(chunks.length < 32 && streamSizes[name] + owned.length <= 4096, 'output capture bound');
      streamSizes[name] += owned.length;
      chunks.push(owned);
      await api.captureBytes(label + '-' + name + '-chunk-' + chunks.length, owned);
    } catch (reason) { unsafe = true; unsafeReason = reason; throw reason; }
  } });
  let hasThrown = false;
  let thrown;
  let result;
  try {
    const command = gitModule.createGitCommand();
    result = await command.execute({ command: 'git', args: fixture.args, cwd: '/repo', env: {}, fs: memory, signal: api.signal,
      stdin: { async *[Symbol.asyncIterator]() { stdinReads++; throw stdinReason; } }, stdinIsDefault: true,
      stdout: sink(stdout, 'stdout'), stderr: sink(stderr, 'stderr'),
      registerCleanup(callback) {
        try { demand(typeof callback === 'function' && cleanups.length < 128, 'cleanup enrollment'); cleanups.push(callback); }
        catch (reason) { unsafe = true; unsafeReason = reason; throw reason; }
      },
    });
  } catch (reason) { hasThrown = true; thrown = reason; }
  const output = Buffer.concat(stdout);
  const diagnostic = Buffer.concat(stderr);
  const code = hasThrown ? null : resultCode(result);
  const reasonFact = describeReason(thrown);
  await api.captureBytes(label + '-stdout', output);
  await api.captureBytes(label + '-stderr', diagnostic);
  await api.capture(label + '-outcome', { hasThrown, code, resultShape: code !== null, reason: reasonFact, actualThrownMatchesStdinSentinelInThisProcess: hasThrown && thrown === stdinReason, stdinReads, expected });
  try { await close(); }
  catch (reason) {
    await api.capture(label + '-cleanup-unsafe', { failed: true, reason: describeReason(reason), cleanupCompleted, qualification: 'Unknown owned cooperative cleanup requires STOP; not an H09 native-leak inference.' });
    throw reason;
  }
  const after = await snapshot(memory, api.signal);
  await api.capture(label + '-namespace-after', { after, cleanupRegistered: cleanups.length, cleanupCompleted, unsafeCapture: unsafe });
  if (unsafe) throw unsafeReason;
  const checks = [
    ['no-target-throw', !hasThrown],
    ['exact-result-shape-status', code === expected.exitCode],
    ['exact-stdout', output.equals(Buffer.from(expected.stdoutText))],
    ['exact-stderr', diagnostic.equals(Buffer.from(expected.stderrText))],
    ['exact-namespace', JSON.stringify(before) === JSON.stringify(after)],
    ['stdin-not-consumed', stdinReads === 0],
    ['known-owned-cleanup', cleanupCompleted === cleanups.length],
    ['bounded-reason-description', !reasonFact.inspectionFailed && !reasonFact.oversized],
  ];
  for (const [name, passed] of checks) await api.check(label + '-' + name, passed, { proofRole: 'DEDICATED_LOADED_WITNESS_NOT_ORDINARY_STOCK_COHORT' });
  return checks.every(([, passed]) => passed);
}

export async function runCase(api, caseId) {
  demand(api.caseId === caseId && ['S', 'M'].includes(api.layout), 'runner identity');
  const match = /^(L-CRC|L-OID|L-DEPTH)-(STOCK|MUTANT|RESTORE)$/.exec(caseId);
  demand(match !== null, 'declared loaded case');
  const [, transformId, stage] = match;
  const witnesses = await boundData('WITNESSES.json');
  const table = await boundData('../semantic/CASE-DATA.json');
  const frozen = await boundData('../semantic/FROZEN-DATA.json');
  const witness = witnesses.entries.find(row => row.id === transformId);
  const original = table.cases.find(row => row.id === witness.fixtureId);
  demand(original && digest(Buffer.from(JSON.stringify(original))) === witness.fixtureDescriptorSha256, 'unchanged descriptor');
  demand(JSON.stringify(original.expected) === JSON.stringify(witness.stockExpected), 'unchanged stock expected bytes');
  await api.capture('loaded-role', { caseId, layout: api.layout, stage, transformId, fixtureId: witness.fixtureId, stockExpected: witness.stockExpected, predictedMutantExpected: witness.mutantExpected, qualification: 'Parent prerequisite, exact full-map admission, actual loader trace, physical copy/move/restore and known retirement are mandatory; a leaf PASS alone is not kill credit.' });
  await candidateBinding(api, witness.transform, stage, 'entry-before');
  const controlPassed = await observe(api, frozen, original.control, witness.controlExpected, 'control');
  if (!controlPassed) {
    await api.capture('witness-unrun', { reason: 'pristine-fixture-control-contradiction', stage, killCredit: false });
    await candidateBinding(api, witness.transform, stage, 'entry-after');
    return;
  }
  await observe(api, frozen, original.spec, stage === 'MUTANT' ? witness.mutantExpected : witness.stockExpected, 'witness');
  await candidateBinding(api, witness.transform, stage, 'entry-after');
}
