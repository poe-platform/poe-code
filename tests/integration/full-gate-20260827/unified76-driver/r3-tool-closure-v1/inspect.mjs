import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
assert.equal(root, '/Users/kjopek/Workspace/safe-bash');
const base = 'tests/integration/full-gate-20260827/unified76-driver/';
const targets = [
  ['cut', '/usr/bin/cut', 'f2199a84b3bcad698217c78448615f296ee30d2b8dca713036cf8cdce3b783da'],
  ['sort', '/usr/bin/sort', 'e1cae8c9638af1466950fd7c241434c81242d4bbc54fff5f2d18e0e86ea9c7e3'],
  ['tee', '/usr/bin/tee', '97832f8519ebacf737782b40cf0a33dc5b27bd4bfe7493e952c6c65ef309bea0'],
  ['xargs', '/usr/bin/xargs', 'aebe3d43c7bfa8df51a2c14a0f3718e24f08e68698cb2fd89ffdb980c4ab3213'],
  ['cat', '/bin/cat', '580599dd318fa34bb0f91c29106894852c49c3a3df724b637113df95c6758fe6'],
];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let totalBytes = 0;
let reads = 0;
function read(origin) {
  assert(++reads <= 40);
  const physical = fs.realpathSync(origin);
  const descriptor = fs.openSync(physical, 'r');
  try {
    const before = fs.fstatSync(descriptor);
    assert(before.isFile() && before.size <= 8 * 1024 * 1024);
    totalBytes += before.size;
    assert(totalBytes <= 24 * 1024 * 1024);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs], [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs]);
    assert.equal(bytes.length, before.size);
    assert.equal(fs.realpathSync(origin), physical);
    const links = [];
    let current = path.parse(origin).root;
    for (const segment of origin.split('/').filter(Boolean)) {
      current = path.join(current, segment);
      const entry = fs.lstatSync(current);
      links.push({path: current, kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file', mode: entry.mode & 0o777, ...(entry.isSymbolicLink() ? {target: fs.readlinkSync(current), physical: fs.realpathSync(current)} : {})});
    }
    return {bytes, identity: {origin, physical, bytes: bytes.length, mode: before.mode & 0o777, sha256: digest(bytes), links}};
  } finally { fs.closeSync(descriptor); }
}
function mach(bytes) {
  assert.equal(bytes.readUInt32BE(0), 0xcafebabe, 'only observed big-endian fat container supported');
  const count = bytes.readUInt32BE(4);
  assert(count > 0 && count <= 8 && 8 + count * 20 <= bytes.length);
  const slices = [];
  for (let index = 0; index < count; index++) {
    const record = 8 + index * 20;
    const offset = bytes.readUInt32BE(record + 8), size = bytes.readUInt32BE(record + 12);
    assert(offset >= 8 + count * 20 && size >= 32 && offset + size <= bytes.length);
    const slice = bytes.subarray(offset, offset + size);
    assert.equal(slice.readUInt32LE(0), 0xfeedfacf, 'only observed little-endian 64-bit slice supported');
    const commands = slice.readUInt32LE(16), commandBytes = slice.readUInt32LE(20);
    assert(commands <= 128 && commandBytes <= size - 32);
    const references = [], commandRecords = [];
    let position = 32;
    for (let command = 0; command < commands; command++) {
      assert(position + 8 <= 32 + commandBytes);
      const kind = slice.readUInt32LE(position), length = slice.readUInt32LE(position + 4);
      assert(length >= 8 && position + length <= 32 + commandBytes);
      const data = slice.subarray(position, position + length);
      const item = {kind, length, sha256: digest(data)};
      if ([12, 14, 0x80000018, 0x8000001c, 0x8000001f, 0x20, 0x80000023, 0x27].includes(kind)) {
        assert(length >= 12);
        const start = data.readUInt32LE(8), end = data.indexOf(0, start);
        assert(start >= 12 && start < length && end >= start && end < length);
        const name = data.subarray(start, end).toString('utf8');
        assert(Buffer.from(name).equals(data.subarray(start, end)));
        const reference = {kind, path: name};
        if ([12, 0x80000018, 0x8000001f, 0x20, 0x80000023].includes(kind)) {
          assert(length >= 24);
          reference.currentVersion = data.readUInt32LE(16);
          reference.compatibilityVersion = data.readUInt32LE(20);
        }
        references.push(reference);
      }
      if (kind === 0x1b) { assert.equal(length, 24); item.uuidHex = data.subarray(8).toString('hex'); }
      if (kind === 0x32) {
        assert(length >= 24);
        item.platform = data.readUInt32LE(8); item.minimumOS = data.readUInt32LE(12); item.sdk = data.readUInt32LE(16);
      }
      commandRecords.push(item);
      position += length;
    }
    assert.equal(position, 32 + commandBytes);
    slices.push({cpu: slice.readUInt32LE(4), subtype: slice.readUInt32LE(8), offset, size, sha256: digest(slice), references, commands: commandRecords});
  }
  return slices;
}
const inspected = targets.map(([name, origin, expected]) => {
  const data = read(origin);
  assert.equal(data.identity.physical, origin);
  assert.equal(data.identity.sha256, expected);
  assert.equal(data.identity.mode, 0o755);
  assert(data.identity.links.every(entry => entry.kind !== 'symlink'));
  const slices = mach(data.bytes);
  for (const slice of slices) assert.deepEqual(slice.references.map(reference => [reference.kind, reference.path]), [[14, '/usr/lib/dyld'], [12, '/usr/lib/libSystem.B.dylib']]);
  return {name, ...data.identity, slices, utilityVersion: null, utilityVersionQualification: 'No utility executed. Exact system-file bytes plus host metadata identify this proposed profile; not a GNU version or historical resolution claim.'};
});
const linker = read('/usr/lib/dyld');
const linkerSlices = mach(linker.bytes);
let missingCode;
try { fs.lstatSync('/usr/lib/libSystem.B.dylib'); } catch (error) { missingCode = error.code; }
assert.equal(missingCode, 'ENOENT');
const os = read('/System/Library/CoreServices/SystemVersion.plist');
assert(os.bytes.toString().includes('<string>26.4.1</string>') && os.bytes.toString().includes('<string>25E253</string>'));
const headers = ['loader.h', 'fat.h'].map(name => read('/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/include/mach-o/' + name).identity);
const fixtureBindings = [
  ['tests/commands/search-stress/harness.ts', 'f3d35ec00766263a804fc4b52abfb4ce8c0c45e7'],
  ['tests/commands/search-stress/pipelines.test.ts', '6b949c63f57f0f8596447d099fd5a96a5cd7d9e3'],
].map(([relative, expectedBlob]) => {
  const data = read(path.join(root, relative));
  const blob = crypto.createHash('sha1').update(`blob ${data.bytes.length}\0`).update(data.bytes).digest('hex');
  assert.equal(blob, expectedBlob);
  return {path: relative, gitBlob: blob, bytes: data.bytes.length, mode: data.identity.mode, sha256: data.identity.sha256};
});
const parentBindings = ['launcher-v3/DRIVER.json', 'launcher-v3/TOOL-ROUTES.json', 'launcher-v3/EXTERNAL-RECEIPT.json', 'launcher-v3/EXTERNAL.json.gz.base64', 'r3-repair-v1/SOURCE-CANDIDATE.json', 'r3-repair-v1/EVIDENCE-SEAL.json', 'r3-diagnosis-v1/FAILURES.json'].map(relative => {
  const data = read(path.join(root, base, relative));
  return {path: base + relative, bytes: data.bytes.length, sha256: data.identity.sha256};
});
const result = {
  schema: 'r3-five-platform-tools-inspection/1', date: '2026-08-28', mode: 'readonly-static-bytes-no-target-execution',
  candidate: 'f5e9fc49b6abb38e180cc9de16c95fced102ff75', futureFixtureSource: '437778996f60109e212e20b1b242455866fda285',
  inspected, linker: {...linker.identity, slices: linkerSlices, qualification: 'Readable loader file bound as data, not dynamic-image or transitive runtime closure proof.'},
  library: {path: '/usr/lib/libSystem.B.dylib', observedError: missingCode, sha256: null, newToolPairs: inspected.map(tool => [tool.origin, '/usr/lib/libSystem.B.dylib']), admission: 'PENDING_EXPLICIT_OS_METADATA_PAIR_DECISION'},
  host: {...os.identity, productVersion: '26.4.1', build: '25E253', qualification: 'Read-only plist metadata, not executed sw_vers, full OS attestation or library-file hash.'},
  primaryLocalLayoutHeaders: headers, fixtureBindings, parentBindings, reads, totalBytes,
  execution: {nativeVersions: 0, nativeOracles: 0, toolsInspectedByExecution: 0, compiler: 0, product: 0, gate: 0, admissionControls: 0},
  status: 'PREPARATION_ONLY_NOT_ADMITTED',
  qualifications: ['Static Mach-O load-command extraction only; all command hashes recorded, unknown runtime images/dlopen/code execution not established.', 'No external inspector, target utility, install, download, PATH modification, symlink creation or old-root mutation.', 'Known exact binaries are proposed platform selections; the original bare names did not pin a utility version or record a successful historical PATH resolution.'],
};
const serialized = JSON.stringify(result, null, 2) + '\n';
assert(Buffer.byteLength(serialized) <= 256 * 1024);
process.stdout.write(serialized);
