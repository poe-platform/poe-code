import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const root = process.cwd(), scope = import.meta.dirname, base = path.dirname(scope);
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const relative = file => path.relative(root, file);
const read = (file, entry, maximum = 4194304) => {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, entry.bytes); assert.ok(stat.size <= maximum);
  const body = fs.readFileSync(file); assert.equal(body.length, entry.bytes); assert.equal(sha(body), entry.sha256); return body;
};
const write = (name, value) => fs.writeFileSync(path.join(scope, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
try {
  fs.mkdirSync(path.join(scope, 'capture'));
  const requests = ['5a0b49231c87be29bfca64150ddf8a8694d8fb75:tests/integration/agent-bash-coherent-author-20260829/stage-b1/evidence/MANIFEST.json'];
  const git = (label, args) => {
    const result = spawnSync('/usr/bin/git', args, { cwd: root, input: requests.join('\n') + '\n', maxBuffer: 1048576, timeout: 30000, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } });
    fs.writeFileSync(path.join(scope, 'capture', label + '.stdout'), result.stdout ?? Buffer.alloc(0), { flag: 'wx' });
    fs.writeFileSync(path.join(scope, 'capture', label + '.stderr'), result.stderr ?? Buffer.alloc(0), { flag: 'wx' });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0); return result.stdout;
  };
  const meta = git('manifest-type', ['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)']).toString().trim().split(' ');
  assert.equal(meta[1], 'blob'); assert.ok(Number(meta[2]) > 0 && Number(meta[2]) < 1048576);
  const packet = git('manifest-body', ['cat-file','--batch']); const end = packet.indexOf(10);
  assert.equal(packet.subarray(0,end).toString(), meta.join(' ')); const body = packet.subarray(end + 1, end + 1 + Number(meta[2]));
  assert.equal(body.length, Number(meta[2])); assert.equal(sha(body), 'ef6817949dcf63fff0b239646669947ca96c85c74a913027299619311c56c12e');
  const manifest = JSON.parse(body);
  const prior = name => { const entry = manifest.files.find(row => row.path === name); assert.ok(entry, name); return { entry, body: read(path.join(base, 'stage-b1', name), entry, 8388608) }; };
  const auth = JSON.parse(prior('AUTHENTICATED-INPUTS.json').body);
  const originals = new Map();
  for (const entry of auth.inputs) originals.set(path.basename(entry.path), { entry, body: read(path.join(root, entry.path), entry) });
  const receipt = JSON.parse(originals.get('PUBLIC-ENGINE-RECEIPT.json').body);
  const inflate = (entry, compressedLimit, decodedLimit) => {
    const gzip = Buffer.from(entry.body.toString('ascii').trim(), 'base64'); assert.ok(gzip.length <= compressedLimit);
    const output = gunzipSync(gzip, { info: true, maxOutputLength: decodedLimit }); assert.equal(output.engine.bytesWritten, gzip.length);
    assert.ok(entry.body.length + gzip.length + output.buffer.length <= 33554432); return JSON.parse(output.buffer);
  };
  const engine = inflate(originals.get('INPUTS-v1.json.gz.base64'), 2097152, 16777216);
  const provenance = inflate(originals.get('PUBLIC98.json.gz.base64'), 1048576, 8388608);
  assert.equal(engine.engine.length, 96); assert.equal(receipt.engine.length, 96); assert.equal(provenance.files.length, 98);
  const targets = new Set();
  for (const entry of engine.engine) {
    assert.ok(!targets.has(entry.target)); targets.add(entry.target);
    const expected = receipt.engine.find(row => row.archiveTarget === entry.target); assert.ok(expected);
    const decoded = Buffer.from(entry.body, 'base64'); assert.equal(decoded.length, expected.bytes); assert.equal(sha(decoded), expected.sha256);
    assert.ok(entry.target.startsWith('compiled/engine/') || entry.target === 'compiled/support/errors.js');
  }
  for (const entry of provenance.files) {
    const decoded = Buffer.from(entry.base64, 'base64'); assert.equal(decoded.length, entry.bytes); assert.equal(sha(decoded), entry.sha256);
    assert.equal(crypto.createHash('sha1').update(`blob ${decoded.length}\0`).update(decoded).digest('hex'), entry.blob);
  }
  const retained = JSON.parse(originals.get('RETAINED-SOURCES.json').body); assert.equal(retained.length, 14);
  for (const entry of retained) { assert.equal(Buffer.byteLength(entry.text), entry.bytes); assert.equal(sha(entry.text), entry.sha256); }
  const origins = [];
  let patch = '*** Begin Patch\n';
  for (const name of ['bootstrap.mjs','consumer.mjs','run.mjs','launch.sh']) {
    const original = prior(name);
    let text = original.body.toString('utf8');
    if (name === 'launch.sh') text = text.replaceAll('stage-b1/', 'stage-b1-r2/').replaceAll('public15-20260829-r1', 'public15-20260829-r2');
    origins.push({ target: name, sourceCommit: '01406364d05bd82bf4b8f5fd2dfd35a3ce729e1e', sourcePath: relative(path.join(base, 'stage-b1', name)), bytes: original.entry.bytes, sha256: original.entry.sha256, transformation: name === 'launch.sh' ? 'r2-only namespace/capture locators' : 'byte-identical' });
    assert.ok(text.endsWith('\n'));
    patch += `*** Add File: ${path.join(scope, name)}\n` + text.slice(0,-1).split('\n').map(line => '+' + line).join('\n') + '\n';
  }
  patch += '*** End Patch\n'; fs.writeFileSync(path.join(scope, 'DERIVED.patch'), patch, { flag: 'wx' });
  write('ORIGINALS.json', { at: new Date().toISOString(), authority: { commit: '5a0b49231c87be29bfca64150ddf8a8694d8fb75', path: 'stage-b1/evidence/MANIFEST.json', blob: meta[0], bytes: Number(meta[2]), sha256: sha(body) }, copiedSources: origins, authenticatedInputs: auth, counts: { engineEntries: 96, source98: 98, retained: 14 }, productImports: 0, engineImports: 0 });
  const b0 = JSON.parse(read(path.join(base, 'stage-b0-r3/PRESEAL.json'), { bytes: 11952, sha256: '78e6c945ceadfb54d51d806fbe57399ab5a552ad4571791cb916c085736e27a7' }));
  const ownerEntry = b0.files.find(entry => entry.path.endsWith('/stage-b0-r3/owner.mjs')); assert.ok(ownerEntry);
  const owner = read(path.join(root, ownerEntry.path), ownerEntry).toString();
  console.log('OWNER_SOURCE', owner.split('\n').slice(0,45).join('\n'));
  console.log('AUTHENTICATED', JSON.stringify({ at: new Date().toISOString(), engine: 96, source98: 98, retained: 14, derivedSources: origins, imports: 0 }));
} catch (error) { console.error(error); process.exitCode = 78; }
