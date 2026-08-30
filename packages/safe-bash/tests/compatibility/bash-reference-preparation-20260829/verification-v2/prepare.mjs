import { readFile, lstat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const parent = fileURLToPath(new URL('../', import.meta.url));
await writeFile(root + 'PREPARE-STARTUP.json', JSON.stringify({ startedAt: new Date().toISOString(), children: 0, network: false }) + '\n', { flag: 'wx', mode: 0o600 });
const text = async path => {
  const status = await lstat(path);
  assert(status.isFile() && !status.isSymbolicLink() && status.size <= 1048576);
  return readFile(path, 'utf8');
};
const check = async identity => {
  const status = await lstat(identity.path);
  assert(status.isFile() && !status.isSymbolicLink());
  assert.equal(status.size, identity.bytes);
  assert.equal((status.mode & 0o777).toString(8), identity.mode);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(identity.path, { highWaterMark: 65536 })) digest.update(chunk);
  assert.equal(digest.digest('hex'), identity.sha256);
};
try {
  const acquisition = JSON.parse(await text(root + 'frozen-acquisition-seal.json.data'));
  const previous = JSON.parse(await text(root + 'frozen-verification-seal.json.data'));
  const bound = async (prefix, seal, path) => {
    const matching = seal.rows.filter(row => row.path === path);
    assert.equal(matching.length, 1);
    const identity = { ...matching[0], path: parent + prefix + '/' + path };
    await check(identity);
    return JSON.parse(await text(identity.path));
  };
  const objects = await bound('acquisition-v1', acquisition, 'OBJECTS.json');
  const tools = await bound('acquisition-v1', acquisition, 'RUN-01/TOOLS.json');
  const admission = await bound('verification-v1', previous, 'KEY-INSPECTION-01/ADMISSION.json');
  const observations = await bound('verification-v1', previous, 'OBSERVATIONS.json');
  const authority = '7C0135FB088AAF6C66C650B9BB5869F064EA74AB';
  assert.equal(observations.publicKeyFingerprints[0], authority);
  const acquired = objects.objects.filter(row => row.disposition === 'OPAQUE_ACQUIRED_NOT_SIGNATURE_VERIFIED');
  assert.equal(acquired.length, 33);
  const artifact = row => ({ path: parent + 'acquisition-v1/RUN-01/' + row.path, bytes: row.bytes, mode: '600', sha256: row.sha256, role: row.role });
  const names = ['bash-5.3.tar.gz', ...Array.from({ length: 15 }, (_, index) => `bash53-${String(index + 1).padStart(3, '0')}`)];
  const pairs = names.map((name, index) => {
    const payload = acquired.filter(row => row.name === name);
    const signature = acquired.filter(row => row.name === name + '.sig');
    assert.equal(payload.length, 1);
    assert.equal(signature.length, 1);
    return { id: `PAIR-${String(index + 1).padStart(2, '0')}`, name, payload: artifact(payload[0]), signature: artifact(signature[0]) };
  });
  const authorityArtifacts = previous.rows.map(row => ({ ...row, path: parent + 'verification-v1/' + row.path }));
  const closure = admission.identities.map(row => ({ ...row, path: row.resolved ?? row.path }));
  const key = closure.find(row => row.sha256 === 'db4041b4d3896b9f21250e6c29861958bd5d4781f521f06beda849a9ed79fae8');
  assert(key);
  const gpg = closure.find(row => row.path === '/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpg');
  const gpgv = closure.find(row => row.path === '/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpgv');
  assert.equal(gpg.sha256, '9d8501878158144e8db80be1454f6c69d62b8a97c21441da3b720081f917f8ac');
  assert.equal(gpgv.sha256, 'd9eb7bc783a1a0f1f39bb1f12ff0c94d7c2aac3b25aac2a7909a647d60be7bd4');
  const output = root + 'RUN-01/';
  const keyringPath = output + 'keyring/ramey.gpg';
  const dearmorArgs = ['--no-options', '--homedir', output + 'KEYRING/gnupg', '--batch', '--no-autostart', '--no-default-keyring', '--no-keyring', '--no-auto-check-trustdb', '--no-auto-key-locate', '--no-auto-key-retrieve', '--no-auto-key-import', '--output', keyringPath, '--dearmor', '--', key.path];
  for (const pair of pairs) pair.argv = ['--homedir', output + pair.id + '/gnupg', '--keyring', keyringPath, '--status-fd', '1', '--', pair.signature.path, pair.payload.path];
  const plan = { sourceCommits: ['822e82a70dfebc071d3b6e27bc78967afa40a993', '193efc87c3ed3e1245b9d0a2d76d4ba293f54c88'], authoritativePrimary: authority, pairs, acquiredArtifacts: acquired.map(artifact), authorityArtifacts, closure, node: tools.node, gpg, gpgv, key, keyringPath, dearmorArgs, output, maxChildren: 17, caseMs: 10000, closeGraceMs: 1000, streamBytes: 262144, controllerMs: 480000, network: false, globalKeyringUsedForVerification: false };
  for (const identity of [...plan.acquiredArtifacts, ...plan.authorityArtifacts]) await check(identity);
  await writeFile(root + 'plan.json', JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'EXACT_PLAN_PREPARED', pairs: pairs.length, acquired: acquired.length, authorityFiles: authorityArtifacts.length, closure: closure.length, children: 0 }));
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ status: 'STOP', name: error.name, message: error.message }));
}
