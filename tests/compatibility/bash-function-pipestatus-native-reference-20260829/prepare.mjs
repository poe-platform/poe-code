import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv[2]);
assert.equal(root, '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-pipestatus-native-reference-20260829');
assert(Date.now() < Date.parse('2026-08-29T12:51:43Z'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const write = (relative, bytes) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
};
const read = (target, maximum = 4 * 1024 * 1024) => {
  const stat = fs.lstatSync(target);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev);
    const bytes = fs.readFileSync(descriptor);
    assert.equal(bytes.length, stat.size);
    return bytes;
  } finally { fs.closeSync(descriptor); }
};
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const parseBatch = bytes => {
  const members = new Map(); let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(10, offset); assert(end >= offset && end - offset < 128);
    const header = decode(bytes.subarray(offset, end)).split(' ');
    assert.equal(header[1], 'blob'); assert(/^[0-9a-f]{40}$/.test(header[0]));
    const size = Number(header[2]); assert(Number.isSafeInteger(size) && size >= 0 && size < 4 * 1024 * 1024);
    const payload = bytes.subarray(end + 1, end + 1 + size);
    assert.equal(payload.length, size); assert.equal(blob(payload), header[0]);
    assert.equal(bytes[end + size + 1], 10);
    members.set(header[0], payload); offset = end + size + 2;
  }
  return members;
};
const initial = parseBatch(read(path.join(root, 'raw/input-batch.data')));
const matrixBytes = initial.get('dd037378e4c58bdf514e38aa6240f6c9d2e62f54');
const bindingBytes = initial.get('0ba713f7cada744aae9d32651ed8789cf48a1b1b');
const matrix = JSON.parse(decode(matrixBytes));
const binding = JSON.parse(decode(bindingBytes));
write('inherited/PROOF-MATRIX.json.data', matrixBytes);
write('inherited/SOURCE-BINDINGS.json.data', bindingBytes);
const treeBytes = read(path.join(root, 'raw/owner-tree.nul'));
const tree = decode(treeBytes).split('\0').filter(Boolean).map(row => {
  const [metadata, name] = row.split('\t'); const [mode, type, oid] = metadata.split(' ');
  assert.equal(type, 'blob'); return { mode, name, oid };
});
const prefix = 'tests/compatibility/bash-ere-native-reference-20260829/preflight-v2/';
const selected = tree.filter(row => row.name.startsWith(prefix) && (
  /^materialized\/[^/]+\.(mjs|json)$/.test(row.name.slice(prefix.length)) ||
  ['HANDOFF.md', 'CONTROL-PRESEAL.json', 'SOURCE-DELTA.json', 'APPROVAL-PROPOSAL.template.json', 'CONTROLS.json'].includes(row.name.slice(prefix.length))
));
assert(selected.length >= 16 && selected.length <= 30);
const result = spawnSync('/usr/bin/git', ['cat-file', '--batch'], {
  cwd: '/Users/kjopek/Workspace/safe-bash', input: selected.map(row => row.oid).join('\n') + '\n',
  encoding: null, timeout: 20000, maxBuffer: 4 * 1024 * 1024,
});
write('raw/owner-batch.stdout.data', result.stdout ?? Buffer.alloc(0));
write('raw/owner-batch.stderr', result.stderr ?? Buffer.alloc(0));
assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
const members = parseBatch(result.stdout);
const inherited = [];
for (const row of selected) {
  const bytes = members.get(row.oid); assert(bytes);
  const relative = 'inherited/' + row.name.slice(prefix.length) + '.data';
  write(relative, bytes);
  inherited.push({ ...row, relative, bytes: bytes.length, sha256: hash(bytes), role: 'INERT_SOURCE_NOT_CURRENT_AUTHORITY' });
}
const programs = matrix.rows.filter(row => row.nativeAuthority === 'NEW_NATIVE_REQUIRES_FRESH_ROOT_AUTHORITY');
assert.equal(programs.length, 26);
const requests = programs.map(row => {
  const bytes = Buffer.from(row.program, 'utf8'); assert.equal(hash(bytes), row.programSha256);
  assert(bytes.every(byte => byte < 128 && byte !== 0));
  write(`programs/${row.id}.bash.data`, bytes);
  return { id: row.id, kind: row.kind, file: `programs/${row.id}.bash.data`, bytes: bytes.length,
    sha256: hash(bytes), gitBlob: blob(bytes), stdinBase64: '',
    argv: ['--noprofile', '--norc', '-c', row.program, 'surface-function-pipestatus'],
    disposition: ['F06', 'P15'].includes(row.id) ? 'WITHHELD_PENDING_EXACT_FAILED_LOOKUP_PERMISSION' : 'PROPOSED_UNRUN',
    effects: row.id === 'F05' ? ['work/out: absent-before; regular-after; bounded-bytes; owned namespace only'] : [],
    sourceForkReservation: ({P04:3,P05:2,P06:2,P10:2,P11:2,P12:1,P13:3,P18:2})[row.id] ?? 0,
  };
});
write('REQUESTS.json', JSON.stringify({ schema: 'function-pipestatus-observations-proposal-v1', status: 'NO_GO_ALL_UNRUN', count: 26, initialFixtures: [], requests }, null, 2) + '\n');
const sourceRoot = '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3';
const sourceRows = [];
const needles = ['set_pipestatus', 'PIPESTATUS', 'get_pipe_status', 'restore_pipestatus'];
for (const row of binding.gnu.files) {
  const bytes = read(path.join(sourceRoot, row.path));
  assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256);
  const lines = decode(bytes).split('\n'); const wanted = new Set();
  for (let index = 0; index < lines.length; index++) if (needles.some(needle => lines[index].includes(needle))) {
    for (let selectedLine = Math.max(0, index - 14); selectedLine < Math.min(lines.length, index + 36); selectedLine++) wanted.add(selectedLine);
  }
  write('gnu/' + row.path.replaceAll('/', '__') + '.excerpts.data', [...wanted].sort((left, right) => left - right).map(index => `${index + 1}: ${lines[index]}`).join('\n') + '\n');
  sourceRows.push({ ...row, sameBufferHashBeforeDecode: true });
}
const toolPaths = ['/bin/bash', '/usr/bin/env', '/bin/zsh', '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'];
const tools = [];
for (const tool of toolPaths) {
  const stat = fs.lstatSync(tool); assert(stat.isFile() && stat.size < 128 * 1024 * 1024);
  const stream = fs.createReadStream(tool, { highWaterMark: 65536 }); const digest = crypto.createHash('sha256'); let bytes = 0;
  for await (const chunk of stream) { bytes += chunk.length; digest.update(chunk); }
  assert.equal(bytes, stat.size); tools.push({ path: tool, bytes, sha256: digest.digest('hex'), mode: stat.mode & 0o7777, dev: stat.dev, ino: stat.ino });
}
assert.equal(tools[0].sha256, '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3');
assert.equal(tools[3].sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
write('TOOLS.json', JSON.stringify({ metadataOnly: true, tools }, null, 2) + '\n');
write('SOURCE-ADMISSION.json', JSON.stringify({ inherited, sourceRows, matrix: { bytes: matrixBytes.length, sha256: hash(matrixBytes) }, bindings: { bytes: bindingBytes.length, sha256: hash(bindingBytes) }, helperChildren: [{ executable: '/usr/bin/git', args: ['cat-file', '--batch'], status: result.status, signal: result.signal }], productLoads: 0, nativeStarts: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ admittedSourceFiles: sourceRows.length, inheritedMembers: inherited.length, programs: requests.length, withheld: requests.filter(row => row.disposition.startsWith('WITHHELD')).map(row => row.id), sourceOnly: true }));
