import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
const output="/private/tmp/safe-bash-b1-data-independent-r3-controls",finalHash="89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b",maximum=1048576,aggregateMaximum=25165824,reserve=8388608,deadline=1788024369000; let written=0,filesWritten=0; const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function clock() { assert(Date.now() < deadline, 'recovery stage deadline'); }
function put(filename, bytes, mode = 0o600) {
  clock(); assert(filesWritten + 1 <= 512); assert(written + bytes.length <= aggregateMaximum - reserve, 'recovery data leaves16MiB publication tail');
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(count > 0); offset += count; } fs.fchmodSync(descriptor, mode); }
  finally { fs.closeSync(descriptor); }
  written += bytes.length; filesWritten++;
}
const json = (filename, value) => put(filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
async function identity(filename, expected) {
  clock(); assert(path.isAbsolute(filename) && path.normalize(filename) === filename); assert.notEqual(path.basename(filename), 'AGENTS.md');
  const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink(), 'regular nonsymlink only');
  assert.equal(fs.realpathSync(filename), filename, 'physical source pathname');
  if (expected) assert.equal(stat.size, expected.bytes);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { clock(); hash.update(chunk); }
  const result = { path: filename, bytes: stat.size, sha256: hash.digest('hex'), mode: stat.mode & 0o7777, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, origin: { finalSha256: finalHash, locator: filename } };
  const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.size, stat.size); assert.equal(after.mode, stat.mode); assert.equal(after.mtimeMs, stat.mtimeMs);
  if (expected) assert.equal(result.sha256, expected.sha256);
  if (stat.size > maximum) { json(path.join(output, 'OVERSIZE-STOP.json'), { status: 'COPY_STOP_NO_TRUNCATION', result }); throw new Error('source exceeds1MiB; stat/hash retained only'); }
  return result;
}
async function bytesFor(record) {
  const current = await identity(record.path, record); assert.deepEqual(current, Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'role')));
  const bytes = fs.readFileSync(record.path); assert.equal(bytes.length, record.bytes); assert.equal(digest(bytes), record.sha256); return bytes;
}
function combine(records) {
  const unique = new Map();
  for (const row of records) {
    if (unique.has(row.path)) assert.deepEqual(row, unique.get(row.path), 'conflicting identity for same source path');
    else unique.set(row.path, row);
  }
  return [...unique.values()];
}

export {identity,bytesFor,combine}; export async function controls(){ const groups=[];
  const sample = { path: '/private/tmp/synthetic/source', bytes: 3, sha256: 'a'.repeat(64), mode: 0o600, origin: { locator: '/private/tmp/synthetic/source', finalSha256: finalHash }, dev: 1, ino: 2, mtimeMs: 3 };
  const control = async (id, action) => { await action(); groups.push({ id, status: 'PASS' }); };
  await control('D01-identical-reference-union', () => assert.equal(combine([sample, structuredClone(sample)]).length, 1));
  await control('D02-conflicting-identity', () => { for (const change of [{ bytes: 4 }, { sha256: 'b'.repeat(64) }, { mode: 0o644 }, { origin: { locator: '/other', finalSha256: finalHash } }]) assert.throws(() => combine([sample, { ...sample, ...change }])); });
  const fixtures = path.join(output, 'control-data'); fs.mkdirSync(fixtures);
  await control('D03-byte-and-mode-preservation', async () => {
    for (const [index, bytes, mode] of [[0, Buffer.from([0, 255, 10, 13]), 0o640], [1, Buffer.alloc(0), 0o600]]) {
      const source = path.join(fixtures, `source-${index}`); put(source, bytes, mode); const record = await identity(source);
      const copy = path.join(fixtures, `copy-${index}`); put(copy, await bytesFor(record), record.mode);
      assert.deepEqual(fs.readFileSync(copy), bytes); assert.equal(fs.lstatSync(copy).mode & 0o7777, mode);
    }
  });
  await control('D04-collision-safe-names', () => { const names = ['/x/copy','/x/copy.source.json','/y/copy'].map(name => digest(Buffer.from(name))); assert.equal(new Set(names).size, 3); });
  await control('D05-provenance-mismatch', () => { assert.throws(() => combine([sample, { ...sample, ino: 3 }])); assert.throws(() => combine([sample, { ...sample, origin: { ...sample.origin, finalSha256: 'b'.repeat(64) } }])); });
  await control('D06-symlink-refusal', async () => { const link = path.join(fixtures, 'symlink'); fs.symlinkSync('source-0', link); try { await assert.rejects(identity(link), /regular nonsymlink/); } finally { fs.unlinkSync(link); } });

return groups;}
