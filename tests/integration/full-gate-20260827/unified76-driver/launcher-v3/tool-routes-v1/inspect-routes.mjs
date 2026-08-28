import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstatSync, readFileSync, readlinkSync, realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const launcher = resolve(directory, '..');
const repository = resolve(launcher, '../../../../..');
const candidate = 'f5e9fc49b6abb38e180cc9de16c95fced102ff75';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const toolchain = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function boundedRead(path, maximum = 8 * 1024 * 1024) {
  const before = lstatSync(path);
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.ok(before.size <= maximum);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.mode], [before.dev, before.ino, before.size, before.mtimeMs, before.mode]);
  assert.equal(bytes.length, before.size);
  return bytes;
}
function identity(path) {
  const physical = realpathSync(path);
  const bytes = boundedRead(physical);
  return {path, physical, bytes: bytes.length, mode: lstatSync(physical).mode & 0o777, sha256: sha(bytes)};
}
function arm64Commands(path) {
  const bytes = boundedRead(path);
  let offset = 0;
  let size = bytes.length;
  if (bytes.readUInt32BE(0) === 0xcafebabe) {
    const count = bytes.readUInt32BE(4);
    assert.ok(count > 0 && count <= 16 && 8 + count * 20 <= bytes.length);
    const slices = [];
    for (let index = 0; index < count; index++) {
      const entry = 8 + index * 20;
      if (bytes.readUInt32BE(entry) === 0x100000c) slices.push([bytes.readUInt32BE(entry + 8), bytes.readUInt32BE(entry + 12)]);
    }
    assert.equal(slices.length, 1);
    [offset, size] = slices[0];
  }
  assert.ok(size >= 32 && offset + size <= bytes.length);
  assert.equal(bytes.readUInt32LE(offset), 0xfeedfacf);
  assert.equal(bytes.readUInt32LE(offset + 4), 0x100000c);
  const count = bytes.readUInt32LE(offset + 16);
  const commandBytes = bytes.readUInt32LE(offset + 20);
  assert.ok(count <= 1000 && commandBytes <= size - 32);
  const commands = [];
  let cursor = offset + 32;
  const end = cursor + commandBytes;
  for (let index = 0; index < count; index++) {
    assert.ok(cursor + 8 <= end);
    const kind = bytes.readUInt32LE(cursor);
    const length = bytes.readUInt32LE(cursor + 4);
    assert.ok(length >= 8 && cursor + length <= end);
    if ([0xc, 0xd, 0x80000018, 0x8000001f, 0x20, 0x80000023, 0x8000001c, 0xe].includes(kind)) {
      assert.ok(length >= 12);
      const stringOffset = bytes.readUInt32LE(cursor + 8);
      assert.ok(stringOffset >= 12 && stringOffset < length);
      const start = cursor + stringOffset;
      const nul = bytes.indexOf(0, start);
      assert.ok(nul >= start && nul < cursor + length);
      commands.push({kind: '0x' + kind.toString(16), name: bytes.subarray(start, nul).toString('utf8')});
    }
    cursor += length;
  }
  assert.equal(cursor, end);
  return {sliceOffset: offset, sliceBytes: size, commands, qualification: 'Read-only arm64 direct load-command metadata, not an execution or complete dynamic-image closure.'};
}
const paths = ['/usr/bin/git', '/usr/bin/otool', '/usr/bin/xcrun', git, toolchain + 'llvm-otool', toolchain + 'otool-classic', '/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'];
const tools = paths.map(path => ({...identity(path), machO: arm64Commands(path)}));
assert.equal(tools.find(tool => tool.path === git).sha256, '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
const environment = {PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0'};
const profileBytes = boundedRead(resolve(launcher, 'PROFILE.json.gz.base64'));
const profile = JSON.parse(gunzipSync(Buffer.from(profileBytes.toString().trim(), 'base64')));
assert.equal(profile.candidate, candidate);
assert.equal(profile.canonicalFiles.length, 632);
function gitRead(args) {
  const result = spawnSync(git, ['--no-replace-objects', ...args], {cwd: repository, env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  return {argv: ['--no-replace-objects', ...args], status: result.status, stdout: result.stdout, stderr: result.stderr};
}
const scan = gitRead(['grep', '-n', '-F', '-e', '/usr/bin/git', '-e', '/usr/bin/otool', '-e', 'xcrun', '-e', 'xcodebuild', candidate, '--', 'scripts', ...profile.canonicalFiles]);
assert.equal(scan.status, 1);
assert.equal(scan.stdout, '');
const helper = gitRead(['show', candidate + ':scripts/typecheck-inputs.mjs']);
assert.equal(helper.status, 0);
const helperLines = helper.stdout.split('\n').map((text, index) => ({line: index + 1, text})).filter(row => /execFileSync\("git"/.test(row.text));
assert.equal(helperLines.length, 1);
const tracePath = resolve(launcher, '../../unified76-driver-independent/resolved-write-v9/SAFETY-RESULTS.json');
const traceBytes = boundedRead(tracePath);
const trace = JSON.parse(traceBytes);
const observed = new Map();
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.pid && value.command && [39225, 39226].includes(value.pid)) observed.set(value.pid, value);
  for (const child of Object.values(value)) visit(child);
}
visit(trace);
assert.equal(observed.get(39226).parent, 39225);
const absence = ['/usr/lib/libc++.1.dylib', '/usr/lib/libSystem.B.dylib', '/usr/lib/libxcselect.dylib'].map(path => {
  let errorCode;
  try { lstatSync(path); } catch (error) { errorCode = error.code; }
  assert.equal(errorCode, 'ENOENT');
  return {path, errorCode, qualification: 'Absent readable file, not a library hash.'};
});
const report = {
  schema: 'unified76-tool-route-read-only/1', createdAt: new Date().toISOString(), candidate,
  diagnosticSourceSha256: sha(boundedRead(fileURLToPath(import.meta.url))),
  profileEncodedSha256: sha(profileBytes), tools,
  developerSelection: {path: '/var/db/xcode_select_link', target: readlinkSync('/var/db/xcode_select_link'), physical: realpathSync('/var/db/xcode_select_link')},
  installedManual: identity('/Applications/Xcode.app/Contents/Developer/usr/share/man/man1/xcrun.1'), absence,
  recordedTrace: {path: tracePath.slice(repository.length + 1), sha256: sha(traceBytes), records: [...observed.values()]},
  canonicalScan: {entryFiles: 632, scriptsIncluded: true, literalPatterns: ['/usr/bin/git', '/usr/bin/otool', 'xcrun', 'xcodebuild'], status: scan.status, matches: [], qualification: 'No transitive closure assertion.'},
  bareGitHelper: {path: 'scripts/typecheck-inputs.mjs', sha256: sha(helper.stdout), matches: helperLines},
  executedCommands: [scan.argv.slice(0, scan.argv.indexOf('--') + 1), helper.argv],
  executedTool: tools.find(tool => tool.path === git), childEnvironment: environment,
  replacementToolExecutions: 0, builds: 0, fullGatePhases: 0, routeControlsExecuted: 0,
  decision: 'HOLD exact direct-otool-classic tool/reference approval; no shipping source or OS exception changed.'
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
