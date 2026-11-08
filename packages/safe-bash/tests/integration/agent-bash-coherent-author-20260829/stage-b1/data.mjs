import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const scope = path.resolve('tests/integration/agent-bash-coherent-author-20260829/stage-b1');
const base = path.dirname(scope);
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const rows = [
  ['cdbf1813', 'tests/integration/agent-bash-coherent-author-20260829/stage-b/PUBLIC-ENGINE-RECEIPT.json', 'a4d3614d6d944660aaddc1fd95c8fe6ebef1d92fc0dd8607400578d9a82254de'],
  ['30ac56acbf12a69b90e1923810958bcbcf367fe0', 'tests/commands/node-author-20260829/validation-v2/author-v5/INPUTS-v1.json.gz.base64', '18a3bf6ebf467f3c76a7c0b04c9c72a57f22d21e00ef4d58267c90d0403871c4'],
  ['463a945125b900cbb98436b9e9292d78ca6c98aa', 'tests/commands/node-worker-experiments-20260828/preparation-v3/PUBLIC98.json.gz.base64', '8a65517b0105b3fbfb9337eda671442fa6c44d6b00185b98199ca05f17c2e637'],
  ['30ac56acbf12a69b90e1923810958bcbcf367fe0', 'tests/commands/node-author-20260829/validation-v2/author-v5/engine-adapter-v1.mjs', '2108bf2e7eee28ecd16c7e644c0684518cbfd68219c2971d2df67b155bf4e80d'],
  ['30ac56acbf12a69b90e1923810958bcbcf367fe0', 'tests/integration/node-public-author-20260829/node-policy.mjs', 'c617030cd82a379e0285eb4e4ab53beac7fe0caea34ae0d68995a6d64abee123'],
  ['30ac56acbf12a69b90e1923810958bcbcf367fe0', 'tests/integration/node-public-author-20260829/node-load-guard.mjs', '7d525601f62fccdd61e5393fb1a770c8c9b0ffffc86777e568a2c72b0b277ed1'],
  ['cdbf1813', 'tests/integration/agent-bash-coherent-author-20260829/stage-b/RETAINED-SOURCES.json', '806c9ee4706132fd169925aaa84b569764029f5c3af303c338f773e224bd03a4'],
];
try {
  const captures = path.join(scope, 'capture');
  fs.mkdirSync(captures);
  const requested = rows.map(([commit, relative]) => `${commit}:${relative}`).join('\n') + '\n';
  const git = (label, args) => {
    const child = spawnSync('/usr/bin/git', args, { cwd: root, input: requested, maxBuffer: 8388608, timeout: 30000, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } });
    fs.writeFileSync(path.join(captures, label + '.stdout'), child.stdout ?? Buffer.alloc(0), { flag: 'wx' });
    fs.writeFileSync(path.join(captures, label + '.stderr'), child.stderr ?? Buffer.alloc(0), { flag: 'wx' });
    assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(child.error, undefined);
    return child.stdout;
  };
  const metadata = git('metadata', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)']).toString().trim().split('\n').map(line => line.split(' '));
  assert.equal(metadata.length, rows.length);
  for (const [oid, type, size] of metadata) { assert.match(oid, /^[a-f0-9]{40}$/); assert.equal(type, 'blob'); assert.ok(Number(size) > 0 && Number(size) <= 2097152); }
  const bodies = git('bodies', ['cat-file', '--batch']);
  let offset = 0;
  const admitted = [];
  for (let index = 0; index < rows.length; index++) {
    const end = bodies.indexOf(10, offset); assert.ok(end > offset);
    const [oid, type, sizeText] = bodies.subarray(offset, end).toString().split(' ');
    assert.deepEqual([oid, type, sizeText], metadata[index]);
    const size = Number(sizeText), body = bodies.subarray(end + 1, end + 1 + size);
    assert.equal(body.length, size); assert.equal(bodies[end + 1 + size], 10);
    offset = end + 2 + size;
    const [commit, relative, expectedHash] = rows[index];
    assert.equal(sha(body), expectedHash);
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, size);
    const current = fs.readFileSync(absolute); assert.equal(current.length, size); assert.equal(sha(current), expectedHash);
    admitted.push({ commit, path: relative, absolute, blob: oid, bytes: size, sha256: expectedHash, body: current });
  }
  assert.equal(offset, bodies.length);
  const receipt = JSON.parse(admitted[0].body);
  const decode = (entry, compressedLimit, inflatedLimit) => {
    const gzip = Buffer.from(entry.body.toString('ascii').trim(), 'base64');
    assert.ok(gzip.length <= compressedLimit);
    const inflated = gunzipSync(gzip, { maxOutputLength: inflatedLimit, info: true });
    assert.equal(inflated.engine.bytesWritten, gzip.length);
    assert.ok(entry.body.length + gzip.length + inflated.buffer.length <= 33554432);
    return { value: JSON.parse(inflated.buffer), gzipBytes: gzip.length, gzipSha256: sha(gzip), inflatedBytes: inflated.buffer.length };
  };
  const archive = decode(admitted[1], 2097152, 16777216);
  const provenance = decode(admitted[2], 1048576, 8388608);
  assert.equal(archive.gzipBytes, 1454742);
  assert.equal(archive.gzipSha256, '014ebf5c1f325c9f7288e8cb55970bd41bf02604ee727089d0bdb07655692c3c');
  assert.equal(archive.value.schema, 'node-author-input-archive-v1');
  assert.equal(archive.value.engine.length, 96);
  assert.equal(provenance.value.files.length, 98);
  const engines = archive.value.engine.map(entry => {
    assert.ok(entry.target.startsWith('compiled/engine/') || entry.target === 'compiled/support/errors.js');
    assert.ok(!entry.target.split('/').includes('..') && !entry.target.endsWith('/AGENTS.md'));
    const body = Buffer.from(entry.body, 'base64');
    assert.equal(body.length, entry.bytes); assert.equal(sha(body), entry.sha256);
    return { target: entry.target, stagedRelativePath: entry.target.slice(9), bytes: entry.bytes, sha256: entry.sha256, source: entry.source, inputRole: entry.inputRole, commit: entry.commit };
  });
  for (const entry of provenance.value.files) {
    const body = Buffer.from(entry.base64, 'base64'); assert.equal(body.length, entry.bytes); assert.equal(sha(body), entry.sha256);
    assert.equal(crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'), entry.blob);
  }
  const retained = JSON.parse(admitted[6].body);
  for (const entry of retained) { assert.equal(Buffer.byteLength(entry.text), entry.bytes); assert.equal(sha(entry.text), entry.sha256); }
  fs.writeFileSync(path.join(scope, 'AUTHENTICATED-INPUTS.json'), JSON.stringify({ at: new Date().toISOString(), inputs: admitted.map(({ body, ...entry }) => entry), engine: engines, engineArchive: { gzipBytes: archive.gzipBytes, gzipSha256: archive.gzipSha256, inflatedBytes: archive.inflatedBytes }, public98: { files: 98, inflatedBytes: provenance.inflatedBytes }, engineImports: 0, productImports: 0 }, null, 2) + '\n', { flag: 'wx' });
  const selectedLines = retained.map(entry => ({ path: entry.path, sha256: entry.sha256, lines: entry.text.split('\n').filter(line => /id:|\.push\(|for ?\(|for \(|const cases|const rows|export|length|case '/.test(line)).map(line => line.length > 1600 ? line.slice(0, 1600) + ' [DISPLAY ONLY TRUNCATED]' : line) }));
  fs.writeFileSync(path.join(scope, 'RETAINED-SOURCE-MAP.json'), JSON.stringify(selectedLines, null, 2) + '\n', { flag: 'wx' });
  console.log('RECEIPT_KEYS', Object.keys(receipt));
  console.log('ENGINE_RECEIPT_FIRST', JSON.stringify(receipt.engine[0]));
  console.log('AUTHENTICATED', JSON.stringify({ inputs: admitted.map(({ body, ...entry }) => entry), engine: engines.length, public98: 98, retained: retained.length, productImports: 0 }));
  for (const entry of selectedLines) if (!entry.path.endsWith('.json')) console.log('RETAINED_ID_SOURCE', entry.path, entry.lines.join('\n'));
} catch (error) { console.error(error); process.exitCode = 78; }
