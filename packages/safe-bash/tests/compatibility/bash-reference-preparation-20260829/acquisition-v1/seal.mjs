import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const started = performance.now();
const rows = [];
let bytesTotal = 0;
const exclusions = ['SEAL.json', 'seal.stdout.raw', 'seal.stderr.raw'];
const json = async relative => {
  const status = await lstat(root + relative);
  assert(status.isFile() && !status.isSymbolicLink() && status.size < 1048576);
  return JSON.parse(await readFile(root + relative, 'utf8'));
};
const hash = async relative => {
  const before = await lstat(root + relative, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.size <= 16777216n);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(root + relative, { highWaterMark: 65536 })) digest.update(chunk);
  const after = await lstat(root + relative, { bigint: true });
  assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
  return { path: relative, bytes: Number(before.size), mode: Number(before.mode & 0o777n).toString(8), sha256: digest.digest('hex') };
};
const save = (relative, value) => writeFile(root + relative, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const result = await json('RUN-01/RESULT.json');
  const plan = await json('plan.json');
  assert.equal(result.requestsAttempted, 38);
  assert.equal(result.acquired, 33);
  assert.equal(result.starts, 1);
  assert.equal(result.ownedClosed, true);
  assert.equal(result.signatureVerifications, 0);
  assert.equal(result.extraction, false);
  const downloads = (await readdir(root + 'RUN-01/downloads')).sort();
  const acquired = result.results.filter(row => row.disposition === 'OPAQUE_ACQUIRED_NOT_SIGNATURE_VERIFIED');
  assert.deepEqual(downloads, acquired.map(row => row.path.split('/').at(-1)).sort());
  assert.equal(acquired.filter(row => row.role === 'OPAQUE_SOURCE').length, 16);
  assert.equal(acquired.filter(row => row.role === 'OPAQUE_DETACHED_SIGNATURE').length, 16);
  for (const row of acquired) {
    const actual = await hash('RUN-01/' + row.path);
    assert.equal(actual.sha256, row.sha256);
    assert.equal(actual.bytes, row.bytes);
    assert.equal(actual.mode, '600');
  }
  const probe = await json('RUN-01/VERSION-RESULT.json');
  assert.equal(probe.starts, 1);
  assert.equal(probe.ownedClosed, true);
  assert.equal(probe.termination, null);
  assert.deepEqual(probe.events.map(event => event.event), ['spawn-request', 'exit', 'close']);
  assert.equal(probe.events[1].code, 0);
  assert.equal(probe.events[2].code, 0);
  assert(probe.events[2].elapsedMs < plan.versionProbe.timeoutMs);
  assert.deepEqual(probe.lengths, { stdout: 109, stderr: 0 });
  for (const row of [(await json('RUN-01/TOOLS.json')).bash, await json('RUN-01/VERSION-POST-IDENTITY.json')]) {
    assert.equal(row.sha256, plan.versionProbe.sha256);
    assert.equal(row.bytes, plan.versionProbe.bytes);
    assert.equal(row.mode, plan.versionProbe.mode);
  }
  const admission = await json('RUN-01/VERSION-ADMISSION.json');
  assert.deepEqual(Object.keys(admission.environment).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'TZ']);
  assert.deepEqual(admission.argv, ['--noprofile', '--norc', '--version']);
  await save('OBJECTS.json', { role: 'ACQUISITION_IDENTITIES_NOT_CRYPTOGRAPHIC_VERIFICATION', target: plan.profile, archiveSha256: acquired[0].sha256, objects: result.results, sourcePayloads: 16, signatures: 16, publisherKeyrings: 1, failedEndpoints: 5, signatureVerifications: 0, authorizedSignerFingerprints: null });
  const visit = async prefix => {
    for (const name of (await readdir(root + prefix)).sort()) {
      const relative = prefix + name;
      if (exclusions.includes(relative)) continue;
      assert(performance.now() - started < 30000, 'SEAL_DEADLINE');
      const status = await lstat(root + relative);
      assert(!status.isSymbolicLink());
      if (status.isDirectory()) await visit(relative + '/');
      else {
        const identity = await hash(relative);
        bytesTotal += identity.bytes;
        assert(rows.length < 128 && bytesTotal < 33554432);
        const captured = relative.startsWith('RUN-01/') || relative.startsWith('VERIFY-GAP-01/') || relative.endsWith('.raw') || relative === 'OBJECTS.json';
        if (captured) assert.equal(identity.mode, '600');
        rows.push({ ...identity, role: captured ? 'CAPTURED_DATA' : 'AUTHORED_SOURCE', modeAuthority: captured ? 'EXCLUSIVE_CREATION_0600_OR_UMASK077_AND_CURRENT_LSTAT' : 'CURRENT_AUTHORED_FILE_LSTAT' });
      }
    }
  };
  await visit('');
  await save('SEAL.json', { role: 'SOURCE_DATA_CHECKS_ONLY_NOT_SIGNATURE_ACCEPTANCE', sealedAt: new Date().toISOString(), elapsedMs: performance.now() - started, files: rows.length, logicalBytes: bytesTotal, metadataBashStarts: 1, inspectedProgramsOtherwiseExecuted: 0, acquired: 33, unavailable: 5, signatureVerifications: 0, extraction: false, build: false, rows, exclusions });
  console.log(JSON.stringify({ status: 'SOURCE_DATA_CHECKS_PASS', files: rows.length, bytesTotal, acquired: 33, unavailable: 5, cryptoVerified: 0, elapsedMs: performance.now() - started }));
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ status: 'STOP', name: error.name, message: error.message }));
}
