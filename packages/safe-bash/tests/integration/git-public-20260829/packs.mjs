import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const root = process.env.GIT_AUTHOR_ROOT;
const api = await import(pathToFileURL(path.join(root, 'dist/index.js')).href);
const { createGitCommand, gitCommands } = await import(pathToFileURL(path.join(root, 'dist/commands/git/index.js')).href);
const { Session } = await import(pathToFileURL(path.join(root, 'dist/commands/git/io.js')).href);
const { Repository } = await import(pathToFileURL(path.join(root, 'dist/commands/git/repository.js')).href);
const data = JSON.parse(await fs.readFile(new URL('packs.json', import.meta.url)));
const neutral = JSON.parse(await fs.readFile(new URL('fixture.json', import.meta.url)));
const cases = []; let invocations = 0, cleanupScopes = 0;
const hash = bytes => createHash('sha1').update(bytes).digest();
const oid = (type, bytes) => hash(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes])).toString('hex');
const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
const word = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const reseal = bytes => hash(bytes.subarray(0, -20)).copy(bytes, bytes.length - 20);
const record = async (id, run) => {
  if (process.env.PACK_CASE && process.env.PACK_CASE !== id) return;
  const started = Date.now(), timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
  await fs.appendFile(process.env.GIT_AUTHOR_RESULT + '.events', JSON.stringify({ id, state: 'START' }) + '\n');
  try { await run(); cases.push({ id, status: 'PASS', elapsedMs: Date.now() - started }); }
  catch (error) { cases.push({ id, status: 'FAIL', error: String(error?.stack ?? error), elapsedMs: Date.now() - started }); }
  finally { clearTimeout(timer); }
  await fs.appendFile(process.env.GIT_AUTHOR_RESULT + '.events', JSON.stringify(cases.at(-1)) + '\n');
};
async function put(memory, name, bytes) { await memory.mkdir(path.posix.dirname(name), { recursive: true }); await memory.writeFile(name, bytes); }
async function setup() {
  const memory = new api.MemoryFileSystem();
  for (const file of neutral.files) { await put(memory, '/repo/' + file.path, file.text === undefined ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text)); await memory.chmod('/repo/' + file.path, file.mode); }
  return memory;
}
async function packed(memory, fixture, remove = false) {
  if (remove) for (const name of data.workflowTransformation.removeExactly) await memory.rm('/repo/' + name);
  const pack = fixture.pack ?? Buffer.from(fixture.packBase64, 'base64'), index = fixture.index ?? Buffer.from(fixture.indexBase64, 'base64');
  const name = '/repo/.git/objects/pack/pack-' + pack.subarray(-20).toString('hex');
  await put(memory, name + '.pack', pack); await put(memory, name + '.idx', index); return name;
}
function proxied(memory, get) { return new Proxy(memory, { get(target, key) { const override = get(key); if (override !== undefined) return override; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }); }
async function execute(memory, args = ['rev-parse', '--absolute-git-dir'], options = {}) {
  const controller = options.controller ?? new AbortController(), cleanups = [], stdout = [], stderr = [];
  const context = { command: 'git', args, cwd: '/repo', env: {}, signal: controller.signal, fs: memory,
    stdin: { async *[Symbol.asyncIterator]() { throw Error('Git unexpectedly reads stdin'); } },
    stdout: options.stdout ?? { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); } };
  invocations++;
  let result, reason, rejected = false;
  try { result = await createGitCommand().execute(context); } catch (error) { rejected = true; reason = error; }
  const cleanup = await Promise.allSettled(cleanups.map(callback => callback())); cleanupScopes++;
  return { result, rejected, reason, cleanup, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), context };
}
async function good(memory, args, expected) { const result = await execute(memory, args); assert.equal(result.rejected, false, String(result.reason)); assert.equal(result.result.exitCode, 0, result.stderr.toString()); if (expected !== undefined) assert.deepEqual(result.stdout, Buffer.from(expected)); return result; }
async function refused(memory, message) { const result = await execute(memory); assert.equal(result.rejected, false, String(result.reason)); assert.equal(result.result.exitCode, 128, result.stderr.toString()); assert.equal(result.stdout.length, 0); if (message) assert.match(result.stderr.toString(), message); return result; }
function built(specs, options = {}) {
  const identities = specs.map(spec => spec.oid ?? oid(spec.type ?? 'blob', spec.body)), entries = [], pieces = []; let position = 12;
  for (const [number, spec] of specs.entries()) {
    const kind = spec.program ? 7 : ({ commit: 1, tree: 2, blob: 3, tag: 4 })[spec.type ?? 'blob'];
    const content = spec.program ?? spec.body; let size = content.length;
    const header = [(kind << 4) | (size & 15)]; size = Math.floor(size / 16);
    if (size) header[0] |= 128;
    while (size) { const part = size % 128; size = Math.floor(size / 128); header.push(part | (size ? 128 : 0)); }
    const prefix = spec.program ? Buffer.from(spec.baseOid ?? identities[spec.base ?? 0], 'hex') : Buffer.alloc(0);
    const bytes = Buffer.concat([Buffer.from(header), prefix, spec.compressed ?? deflateSync(content), spec.trailing ?? Buffer.alloc(0)]);
    entries.push({ offset: position, oid: identities[number], crc32: crc(bytes), entry: number }); pieces.push(bytes); position += bytes.length;
  }
  const payload = Buffer.concat([Buffer.from('PACK'), word(options.version ?? 2), word(specs.length), ...pieces]);
  const pack = Buffer.concat([payload, hash(payload)]), rows = [...entries].sort((left, right) => left.oid.localeCompare(right.oid));
  const fanout = Buffer.alloc(1024); for (let bucket = 0; bucket < 256; bucket++) fanout.writeUInt32BE(rows.filter(row => Number.parseInt(row.oid.slice(0, 2), 16) <= bucket).length, bucket * 4);
  const large = [], offsets = rows.map(row => { if (row.entry !== options.largeEntry) return word(row.offset); const value = Buffer.alloc(8); value.writeBigUInt64BE(BigInt(row.offset)); large.push(value); return word(0x80000000 + large.length - 1); });
  const indexBody = Buffer.concat([Buffer.from('ff744f6300000002', 'hex'), fanout, ...rows.map(row => Buffer.from(row.oid, 'hex')), ...rows.map(row => word(row.crc32)), ...offsets, ...large, pack.subarray(-20)]);
  return { pack, index: Buffer.concat([indexBody, hash(indexBody)]) };
}
for (const fixture of data.fixtures) await record(fixture.id, async () => {
  const memory = await setup(); await packed(memory, fixture);
  if (fixture.maxDepth > 32) { await refused(memory, /depth/); return; }
  await good(memory, undefined, '/repo/.git\n');
  const context = (await execute(memory)).context, session = new Session(context, '/');
  try { const repository = await Repository.discover(session, '/repo'); for (const entry of fixture.entries) { const object = await repository.object(entry.oid); assert.equal(object.type, entry.type); assert.deepEqual(object.bytes, Buffer.from(entry.bodyBase64, 'base64')); } }
  finally { await session.operation.close(); session.finish(); }
});
for (const fixture of data.malformed) await record(fixture.id, async () => { const memory = await setup(); await packed(memory, fixture); await refused(memory); });
for (const fixtureId of ['P01', 'P02']) for (const [index, workflow] of data.unchangedProposedOutputs.entries()) await record(`${fixtureId}-workflow-${index + 1}`, async () => {
  const memory = await setup(); await packed(memory, data.fixtures.find(row => row.id === fixtureId), true);
  const result = await execute(memory, workflow.args); assert.equal(result.rejected, false); assert.equal(result.result.exitCode, workflow.exitCode, result.stderr.toString()); assert.deepEqual(result.stdout, Buffer.from(workflow.stdout));
});
for (const descriptor of data.negatives) await record(descriptor.id, async () => {
  const fixture = data.fixtures.find(row => row.id === descriptor.fixture);
  assert.ok(fixture, JSON.stringify(descriptor));
  let pack = Buffer.from(fixture.packBase64, 'base64'), index = Buffer.from(fixture.indexBase64, 'base64');
  const count = fixture.count, crcStart = 1032 + count * 20, offsetStart = 1032 + count * 24, largeStart = 1032 + count * 28;
  let repairPack = false, repairCrc = false, repairIndex = true;
  switch (descriptor.mutation) {
    case 'pack-trailer': pack[pack.length - 1] ^= 1; break;
    case 'index-trailer': index[index.length - 1] ^= 1; repairIndex = false; break;
    case 'pack-reference': index[index.length - 21] ^= 1; break;
    case 'crc': index[crcStart] ^= 1; break;
    case 'fanout-bucket': index.writeUInt32BE(1, 8); break;
    case 'duplicate-oid': index.copy(index, 1052, 1032, 1052); break;
    case 'duplicate-offset': index.writeUInt32BE(12, offsetStart); index.writeUInt32BE(12, offsetStart + 4); break;
    case 'outside-offset': index.writeUInt32BE(0x7fffffff, offsetStart); break;
    case 'unsafe-large-offset': index.writeBigUInt64BE(9007199254740992n, largeStart); break;
    case 'version': pack.writeUInt32BE(4, 4); repairPack = true; break;
    case 'type-zero': pack[12] &= 0x8f; repairPack = true; repairCrc = true; break;
    case 'ofs-zero': pack[fixture.entries[1].compressedStart - 2] = 0; repairPack = true; repairCrc = true; break;
    case 'ofs-interior': pack[fixture.entries[1].compressedStart - 2] = 127; repairPack = true; repairCrc = true; break;
    case 'ref-missing': pack.fill(0, fixture.entries[1].compressedStart - 20, fixture.entries[1].compressedStart); repairPack = true; repairCrc = true; break;
    case 'trailing-byte': pack = Buffer.concat([pack.subarray(0, -20), Buffer.from([0]), pack.subarray(-20)]); repairPack = true; repairCrc = true; break;
    default: assert.fail(descriptor.mutation);
  }
  if (repairCrc) for (let row = 0; row < count; row++) { const id = index.subarray(1032 + row * 20, 1052 + row * 20).toString('hex'), position = fixture.entries.findIndex(entry => entry.oid === id), entry = fixture.entries[position], end = fixture.entries[position + 1]?.offset ?? pack.length - 20; index.writeUInt32BE(crc(pack.subarray(entry.offset, end)), crcStart + row * 4); }
  if (repairPack) { reseal(pack); pack.copy(index, index.length - 40, pack.length - 20); }
  if (repairIndex) reseal(index);
  const memory = await setup(); await packed(memory, { pack, index }); await refused(memory);
});
for (const length of [0, 1, 2, 3]) await record(`minimum-${length}`, async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.from('A') }, { body: Buffer.alloc(0), program: Buffer.from([1, 0, 0, 0]).subarray(0, length), base: 0 }])); await refused(memory); });
await record('zero-result-four', async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.from('A') }, { body: Buffer.alloc(0), program: Buffer.from('81008000', 'hex'), base: 0 }])); await good(memory); });
await record('empty-direct', async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.alloc(0) }])); await good(memory); });
await record('idx-n1-l1', async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.from('A') }], { largeEntry: 0 })); await refused(memory, /extent/); });
await record('idx-n0-slot', async () => { const memory = await setup(), fixture = built([]); fixture.index = Buffer.concat([fixture.index.subarray(0, -40), Buffer.alloc(8), fixture.index.subarray(-40)]); reseal(fixture.index); await packed(memory, fixture); await refused(memory, /extent/); });
await record('object-hash', async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.from('A'), oid: '1'.repeat(40) }])); await refused(memory, /hash/); });
await record('ref-cycle', async () => { const memory = await setup(), first = '1'.repeat(40), second = '2'.repeat(40); await packed(memory, built([{ body: Buffer.from('A'), oid: first, program: Buffer.from([1, 1, 1, 65]), baseOid: second }, { body: Buffer.from('B'), oid: second, program: Buffer.from([1, 1, 1, 66]), baseOid: first }])); await refused(memory, /cycle/); });
for (const kind of ['second-member', 'truncated', 'declared-short']) await record(kind, async () => { const memory = await setup(), body = Buffer.from('hello'), compressed = deflateSync(body); const spec = kind === 'second-member' ? { body, trailing: deflateSync(Buffer.from('bad')) } : kind === 'truncated' ? { body, compressed: compressed.subarray(0, -1) } : { body: Buffer.from('a'), compressed }; await packed(memory, built([spec])); await refused(memory); });
for (const suffix of ['rev', 'bitmap', 'keep', 'mtimes']) await record(`sidecar-${suffix}`, async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); await put(memory, name + '.' + suffix, Buffer.from('ignored')); await good(memory); });
for (const relative of ['objects/pack/multi-pack-index', 'objects/info/packs', 'objects/info/commit-graph']) await record(`sidecar-${relative}`, async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); await put(memory, '/repo/.git/' + relative, Buffer.from('ignored')); await good(memory); });
for (const suffix of ['promisor', 'unknown', 'idx-only', 'link']) await record(`refuse-${suffix}`, async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); if (suffix === 'idx-only') await memory.rm(name + '.pack'); else if (suffix === 'link') await memory.symlink('/repo/README.md', name + '.keep'); else await put(memory, name + '.' + suffix, Buffer.alloc(0)); await refused(memory); });
await record('sidecar-no-body-read', async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); await put(memory, name + '.keep', Buffer.from('ignored')); let reads = 0; const wrapped = proxied(memory, key => key === 'readStream' ? (file, options) => { if (file.endsWith('.keep')) { reads++; throw Error('inert body read'); } return memory.readStream(file, options); } : undefined); await good(wrapped); assert.equal(reads, 0); });
await record('sidecar-observable-change', async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); await put(memory, name + '.keep', Buffer.alloc(0)); let hits = 0; const wrapped = proxied(memory, key => key === 'lstat' ? async (...args) => { const value = await memory.lstat(...args); return args[0].endsWith('.keep') && ++hits > 1 ? { ...value, size: value.size + 1 } : value; } : undefined); await refused(wrapped, /changed/); });
await record('pack-content-change', async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); let passes = 0; const wrapped = proxied(memory, key => key === 'readStream' ? (file, options) => ({ async *[Symbol.asyncIterator]() { const change = file === name + '.pack' && ++passes === 2; for await (const bytes of memory.readStream(file, options)) { const copy = Buffer.from(bytes); if (change) copy[0] ^= 1; yield copy; } } }) : undefined); await refused(wrapped, /changed/); });
for (const value of [-1, NaN, Infinity, 33554433]) await record(`stat-${String(value)}`, async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); const wrapped = proxied(memory, key => key === 'lstat' ? async (...args) => { const stat = await memory.lstat(...args); return args[0].endsWith('.pack') ? { ...stat, size: value } : stat; } : undefined); await refused(wrapped); });
await record('borrowed-subarray', async () => { const memory = await setup(); await packed(memory, data.fixtures[0], true); const wrapped = proxied(memory, key => key === 'readStream' ? (file) => ({ async *[Symbol.asyncIterator]() { const bytes = await memory.readFile(file), buffer = Buffer.alloc(23, 222); for (let offset = 0; offset < bytes.length; offset += 17) { const length = Math.min(17, bytes.length - offset); buffer.set(bytes.subarray(offset, offset + length), 3); yield buffer.subarray(3, 3 + length); buffer.fill(123); } } }) : undefined); await good(wrapped, ['show', 'HEAD:src/app.txt'], 'two\n'); });
await record('readfile-fallback', async () => { const memory = await setup(); await packed(memory, data.fixtures[0], true); const wrapped = new Proxy(memory, { get(target, key) { if (key === 'readStream') return undefined; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }); await good(wrapped, ['show', 'HEAD:src/app.txt'], 'two\n'); });
for (const reason of [null, false, 0, 'abort']) await record(`abort-${String(reason)}`, async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); const controller = new AbortController(); let closed = 0; const wrapped = proxied(memory, key => key === 'readStream' ? (file, options) => ({ async *[Symbol.asyncIterator]() { try { for await (const bytes of memory.readStream(file, options)) { if (file.endsWith('.pack')) controller.abort(reason); yield bytes; } } finally { closed++; } } }) : undefined); const result = await execute(wrapped, undefined, { controller }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); assert.ok(closed > 0); assert.equal(result.stdout.length, 0); });
await record('preabort-no-read', async () => { const memory = await setup(), controller = new AbortController(), reason = {}; controller.abort(reason); let reads = 0; const wrapped = proxied(memory, key => key === 'lstat' ? async () => { reads++; throw Error('unexpected'); } : undefined); const result = await execute(wrapped, undefined, { controller }); assert.equal(result.reason, reason); assert.equal(reads, 0); });
await record('sink-identity', async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); const reason = {}; const result = await execute(memory, undefined, { stdout: { async write() { throw reason; } } }); assert.equal(result.rejected, true); assert.equal(result.reason, reason); });
await record('shell-pipeline', async () => { const memory = await setup(); await packed(memory, data.fixtures[0], true); const shell = new api.Shell({ fs: memory, cwd: '/repo' }).use(api.agentCommands()).use(gitCommands({ replace: true })); try { const result = await shell.exec('git show HEAD:src/app.txt | cat'); assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, 'two\n'); } finally { await shell.dispose(); } });
await record('duplicates-pinned', async () => { const memory = await setup(); await packed(memory, data.fixtures.find(row => row.id === 'P04')); await packed(memory, data.fixtures.find(row => row.id === 'P05')); await good(memory); });
await record('nine-packs', async () => { const memory = await setup(); for (let index = 0; index < 9; index++) await packed(memory, built([{ body: Buffer.from(`unique${index}`) }])); await refused(memory, /maxPacks/); });
await record('sidecar-unobservable-body', async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); await put(memory, name + '.keep', Buffer.from('A')); const initial = await memory.lstat(name + '.keep'); let observations = 0; const wrapped = proxied(memory, key => key === 'lstat' ? async (...args) => { if (args[0] === name + '.keep') { if (++observations === 2) await memory.writeFile(name + '.keep', Buffer.from('B')); return initial; } return memory.lstat(...args); } : undefined); await good(wrapped); assert.equal(Buffer.from(await memory.readFile(name + '.keep')).toString(), 'B'); });
await record('sidecar-stat-cap', async () => { const memory = await setup(), name = await packed(memory, data.fixtures[0]); await put(memory, name + '.keep', Buffer.alloc(0)); const wrapped = proxied(memory, key => key === 'lstat' ? async (...args) => { const stat = await memory.lstat(...args); return args[0].endsWith('.keep') ? { ...stat, size: 16777217 } : stat; } : undefined); await refused(wrapped, /size/); });
await record('pinned-three-large-bodies', async () => { const memory = await setup(); await packed(memory, built([0, 1, 2].map(value => ({ body: Buffer.alloc(4194304, value) })))); await good(memory); });
await record('cumulative-work-four-bodies', async () => { const memory = await setup(); await packed(memory, built([0, 1, 2, 3].map(value => ({ body: Buffer.alloc(4194304, value) })))); await refused(memory, /maxSteps/); });
await record('empty-chunk-budget', async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); let closed = 0; const wrapped = proxied(memory, key => key === 'readStream' ? (file, options) => file.endsWith('.pack') ? ({ async *[Symbol.asyncIterator]() { try { for (let index = 0; index < 32769; index++) yield new Uint8Array(); } finally { closed++; } } }) : memory.readStream(file, options) : undefined); await refused(wrapped, /maxChunks/); assert.equal(closed, 1); });
await record('preclosed-local-output', async () => { const memory = await setup(), local = new AbortController(); local.abort({ consumer: true }); let reads = 0; const wrapped = proxied(memory, key => key === 'lstat' ? async () => { reads++; throw Error('read after preclosure'); } : undefined); const result = await execute(wrapped, undefined, { stdout: { async write() { throw Error('write after closure'); }, ownedOutput: { consumerClosed: local.signal, async write() { throw Error('accounted write after closure'); } } } }); assert.equal(result.rejected, false); assert.equal(result.result.exitCode, 141); assert.equal(result.context.signal.aborted, false); assert.equal(reads, 0); });
await record('reader-cleanup-identity', async () => { const memory = await setup(); await packed(memory, data.fixtures[0]); const reason = { cleanup: true }; let closed = 0; const wrapped = proxied(memory, key => key === 'readStream' ? (file, options) => { if (!file.endsWith('.pack')) return memory.readStream(file, options); return { [Symbol.asyncIterator]() { let done = false; return { async next() { if (done) return { done: true }; done = true; return { done: false, value: await memory.readFile(file) }; }, async return() { closed++; throw reason; } }; } }; } : undefined); const result = await execute(wrapped); assert.equal(result.rejected, true); assert.equal(result.reason, reason); assert.equal(result.stdout.length, 0); assert.equal(closed, 1); });
await record('ref-external-loose-base', async () => { const memory = await setup(); await packed(memory, built([{ body: Buffer.from('hello'), program: Buffer.from([6, 5, 5, 104, 101, 108, 108, 111]), baseOid: 'ce013625030ba8dba906f756967f9e9ca394464a' }])); await refused(memory, /same pack/); });
const summary = { cases, pass: cases.filter(row => row.status === 'PASS').length, fail: cases.filter(row => row.status === 'FAIL').length, invocations, cleanupScopes, nativeRuns: 0, actualSafeJsRuns: 0, qualification: 'Finite author examples; allocation/native/observer and unexecuted matrix variants not inferred' };
assert.equal(invocations, cleanupScopes);
await fs.writeFile(process.env.GIT_AUTHOR_RESULT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail }));
process.exitCode = summary.fail ? 1 : 0;
