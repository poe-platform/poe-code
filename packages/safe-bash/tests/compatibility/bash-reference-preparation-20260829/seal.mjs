import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const started = performance.now();
const exclusions = ['SEAL.json', 'seal.stdout.raw', 'seal.stderr.raw'];
const rows = [];
let total = 0;
const read = async relative => {
  const status = await lstat(root + relative);
  assert(status.isFile() && !status.isSymbolicLink());
  assert(status.size <= 1048576);
  return readFile(root + relative);
};
try {
  const local = JSON.parse(await read('DATA-01/RESULT.json'));
  assert.equal(local.status, 'COMPLETE_FINITE_SURVEY');
  assert.equal(local.pathsObserved, 32);
  const bash = local.records.filter(row => row.role === 'bash');
  assert.equal(bash.length, 13);
  assert.equal(bash.filter(row => row.disposition === 'ABSENT').length, 12);
  assert.equal(bash[0].sha256, '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3');
  assert.equal(local.bashExecutions, 0);
  assert.equal(local.compilerExecutions, 0);
  const http = JSON.parse(await read('HTTP-01/RESULT.json'));
  assert.equal(http.results.length, 4);
  for (const response of http.results) {
    assert.equal(response.status, 200);
    if (response.body) {
      const bytes = await read('HTTP-01/' + response.body.path);
      assert.equal(bytes.length, response.body.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), response.body.sha256);
    }
  }
  const patchListing = (await read('HTTP-01/2.body.data')).toString('utf8');
  const patches = [...patchListing.matchAll(/href="(bash53-[0-9]{3})"/g)].map(match => match[1]);
  assert.deepEqual(patches, Array.from({ length: 15 }, (_, index) => `bash53-${String(index + 1).padStart(3, '0')}`));
  const visit = async prefix => {
    for (const entry of (await readdir(root + prefix)).sort()) {
      const relative = prefix + entry;
      if (exclusions.includes(relative)) continue;
      assert(performance.now() - started < 30000);
      const status = await lstat(root + relative);
      assert(!status.isSymbolicLink());
      if (status.isDirectory()) {
        assert(['DATA-01', 'HTTP-01'].includes(relative));
        await visit(relative + '/');
      } else {
        const bytes = await read(relative);
        total += bytes.length;
        assert(total <= 4194304 && rows.length < 128);
        const capture = /^(DATA-01|HTTP-01)\//.test(relative) || relative.endsWith('.raw');
        if (capture) assert.equal(status.mode & 0o777, 0o600);
        rows.push({ path: relative, bytes: bytes.length, mode: (status.mode & 0o777).toString(8), modeAuthority: capture ? 'DECLARED_WX_0600_OR_OUTER_UMASK077_AND_OBSERVED_LSTAT' : 'OBSERVED_AUTHORED_REGULAR_FILE', sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  };
  await visit('');
  const result = { role: 'SOURCE_METADATA_SEAL_NOT_RUNTIME_QUALIFICATION', sealedAt: new Date().toISOString(), elapsedMs: performance.now() - started, localPaths: 32, bashPaths: 13, presentBashUnknownVersion: 1, absentBashPaths: 12, officialMetadataResponses: 4, patchNames: patches, executionsOfInspectedPrograms: 0, archiveBodyFetches: 0, childrenStarted: 0, totalBoundBytes: total, exclusions, rows };
  await writeFile(root + 'SEAL.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'SOURCE_METADATA_CHECKS_PASS', files: rows.length, bytes: total, elapsedMs: result.elapsedMs }));
} catch (error) {
  console.error(JSON.stringify({ status: 'STOP', name: error?.name, message: error?.message }));
  process.exitCode = 1;
}
