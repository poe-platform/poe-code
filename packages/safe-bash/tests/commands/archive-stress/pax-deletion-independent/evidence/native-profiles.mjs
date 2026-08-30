import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = '/Users/kjopek/Workspace/safe-bash';
const output = process.argv[2] ?? '/tmp/safe-bash-pax-deletion-native-evidence.json';
assert.ok(output.startsWith('/tmp/'));
assert.equal(existsSync(output), false);
const temporary = mkdtempSync('/tmp/safe-bash-pax-deletion-owned-');
chmodSync(temporary, 0o700);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rawTime = 1700123456;
const globalTime = '1700123400';
const localTime = '1700123499.125';
const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: temporary, TMPDIR: temporary, COPYFILE_DISABLE: '1', COPY_EXTENDED_ATTRIBUTES_DISABLE: '1' };
const calls = [];
const result = { startedUtc: new Date().toISOString(), node: process.version, nodeSha256: hash(readFileSync(process.execPath)), platform: process.platform, architecture: process.arch, scope: 'native-only benign profile observations; no product imports, no malicious/header-garbage host extraction; not normative expected values', temporary, env, calls, profiles: [], vectors: [] };

function run(executable, args) {
  const native = spawnSync(executable, args, { cwd: temporary, env, timeout: 10000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' });
  const call = { executable, args, cwd: temporary, status: native.status, signal: native.signal, error: native.error?.message, stdout: native.stdout?.toString('utf8'), stderr: native.stderr?.toString('utf8') };
  calls.push(call);
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  return call;
}

function record(key, value) {
  const suffix = Buffer.from(` ${key}=${value}\n`);
  for (let length = suffix.length + 1; ; length++) if (String(length).length + suffix.length === length) return Buffer.concat([Buffer.from(String(length)), suffix]);
}

function header(name, type, body) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'ascii');
  for (const [offset, width, value] of [[100, 8, 0o600], [108, 8, 0], [116, 8, 0], [124, 12, body.length], [136, 12, rawTime], [329, 8, 0], [337, 8, 0]]) block.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
  block.fill(32, 148, 156);
  block.write(type, 156, 1, 'ascii');
  block.write('ustar\0' + '00', 257, 8, 'ascii');
  block.write(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([block, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
const file = name => header(name, '0', Buffer.from(`${name}\n`));
const pax = (type, ...pairs) => header(type === 'g' ? 'global' : 'local', type, Buffer.concat(pairs.map(([key, value]) => record(key, value))));
const global = (...pairs) => pax('g', ...pairs);
const local = (...pairs) => pax('x', ...pairs);
const vectors = [
  ['D01-ordinary', [file('a'), file('b')]],
  ['D02-global-unrelated-key', [global(['mtime', globalTime], ['uid', '101']), file('a'), global(['gid', '202']), file('b')]],
  ['D03-global-delete-persistence-reintroduction', [global(['mtime', '']), file('a'), local(['mtime', localTime]), file('b'), file('c'), global(['mtime', globalTime]), file('d')]],
  ['D04-local-delete-reset-reintroduction', [global(['mtime', globalTime]), local(['mtime', '']), file('a'), local(['mtime', localTime]), file('b'), file('c')]],
  ['D05-local-duplicate-final-value', [local(['mtime', globalTime], ['mtime', ''], ['mtime', localTime]), file('a'), file('b')]],
  ['D06-local-duplicate-final-delete', [local(['mtime', localTime], ['mtime', '']), file('a'), file('b')]],
  ['D07-global-duplicate-final-delete-and-value', [global(['mtime', ''], ['mtime', globalTime]), file('a'), global(['mtime', localTime], ['mtime', '']), file('b'), file('c')]],
  ['D08-cli-omission-control', [local(['mtime', localTime]), file('a'), file('b')]],
];

function inspect(bytes) {
  const records = [];
  for (let offset = 0; offset < bytes.length - 1024;) {
    const block = bytes.subarray(offset, offset + 512);
    const field = (start, width) => block.subarray(start, start + width).toString('ascii').split('\0')[0];
    const size = parseInt(field(124, 12), 8);
    const type = field(156, 1);
    assert.equal(parseInt(field(148, 8), 8), block.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0));
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    const entry = { offset, name: field(0, 100), type, size, rawMtimeOctal: field(136, 12), rawMtimeSeconds: parseInt(field(136, 12), 8), headerHex: block.toString('hex'), bodyHex: body.toString('hex') };
    if (type === 'x' || type === 'g') {
      entry.pax = [];
      for (let start = 0; start < body.length;) {
        const space = body.indexOf(32, start);
        const length = Number(body.subarray(start, space).toString('ascii'));
        assert.ok(length > 0 && start + length <= body.length);
        assert.equal(body[start + length - 1], 10);
        entry.pax.push(body.subarray(start, start + length).toString('ascii'));
        start += length;
      }
    }
    records.push(entry);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(bytes.subarray(-1024).every(byte => byte === 0));
  return records;
}

try {
  for (const [name, executable, expectedHash] of [
    ['GNU', `${repo}/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`, '49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66'],
    ['BSD', '/usr/bin/bsdtar', 'bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9'],
  ]) {
    const sha256 = hash(readFileSync(executable));
    assert.equal(sha256, expectedHash);
    const version = run(executable, ['--version']);
    assert.equal(version.status, 0);
    result.profiles.push({ name, executable, sha256, version: version.stdout });
  }
  for (const [id, members] of vectors) {
    const bytes = Buffer.concat([...members, Buffer.alloc(1024)]);
    const archive = join(temporary, `${id}.tar`);
    writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' });
    const headers = inspect(bytes);
    const names = headers.filter(entry => entry.type === '0').map(entry => entry.name).sort();
    const vector = { id, sha256: hash(bytes), archiveBase64: bytes.toString('base64'), headers, observations: [] };
    result.vectors.push(vector);
    const profiles = id === 'D08-cli-omission-control' ? [...result.profiles, { ...result.profiles[0], name: 'GNU-cli-delete-mtime' }] : result.profiles;
    for (const profile of profiles) {
      const directory = join(temporary, `${id}-${profile.name}`);
      mkdirSync(directory, { mode: 0o700 });
      const extra = profile.name === 'GNU-cli-delete-mtime' ? ['--pax-option=delete=mtime'] : [];
      const listing = run(profile.executable, [...extra, ...(profile.name.startsWith('GNU') ? ['--full-time', '--numeric-owner'] : []), '-tvf', archive]);
      const extraction = run(profile.executable, [...extra, '--no-same-owner', '-xf', archive, '-C', directory]);
      const actualNames = readdirSync(directory).sort();
      const files = actualNames.map(name => {
        const stat = lstatSync(join(directory, name), { bigint: true });
        assert.ok(stat.isFile());
        const body = readFileSync(join(directory, name));
        assert.deepEqual(body, Buffer.from(`${name}\n`));
        return { name, bytes: body.length, sha256: hash(body), mtimeNs: String(stat.mtimeNs) };
      });
      assert.deepEqual(actualNames, names);
      vector.observations.push({ profile: profile.name, listing, extraction, files });
    }
  }
} catch (error) { result.failure = String(error.stack ?? error); process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true });
  result.cleanup = { fixturesAbsent: !existsSync(temporary), children: 'synchronous, no detached groups, all reaped' };
  result.endedUtc = new Date().toISOString();
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output, failure: result.failure, vectors: result.vectors.length, calls: calls.length, cleanup: result.cleanup }));
  for (const vector of result.vectors) console.log(vector.id, ...vector.observations.map(item => `${item.profile}[${item.listing.status}/${item.extraction.status}]:${item.files.map(file => `${file.name}=${file.mtimeNs}`).join(',')}`));
}
