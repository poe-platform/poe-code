import { lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'PUBLICATION-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), children: 0, sourceOnly: true }) + '\n', { flag: 'wx', mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const inventory = JSON.parse(await readFile(root + 'RUN-01/FINAL-SOURCE-INVENTORY.json', 'utf8'));
  const actual = [];
  const walkSource = async (directory, relative) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const pathname = directory + '/' + entry.name;
      const name = relative + '/' + entry.name;
      const expected = inventory.rows.find(row => row.path === name);
      assert(expected, 'UNEXPECTED_SOURCE_MEMBER');
      const stat = await lstat(pathname);
      assert.equal((stat.mode & 0o777).toString(8), expected.mode);
      if (entry.isDirectory()) { assert.equal(expected.type, '5'); actual.push(expected); await walkSource(pathname, name); }
      else { assert(entry.isFile() && !entry.isSymbolicLink()); assert.equal(stat.size, expected.bytes); const bytes = await readFile(pathname); assert.equal(hash(bytes), expected.sha256); actual.push(expected); }
    }
  };
  await walkSource(inventory.source, 'bash-5.3');
  assert.deepEqual(actual, inventory.rows);
  const tuples = JSON.stringify(actual.map(row => [row.path, row.type, row.mode, row.bytes ?? 0, row.sha256 ?? null]));
  assert.equal(hash(tuples), inventory.sha256);
  const ledger = { scope: 'Explicit tool/child launch roles, not independent kernel descendant telemetry', calls: [
    { id: 1, roles: ['shell'], note: 'Missing command lookups; no executable launched' },
    { id: 2, roles: ['shell', 'git-log'] },
    { id: 3, roles: ['shell', 'sed', 'git-root', 'git-status', 'sed', 'sed'] },
    { id: 4, roles: ['shell'] }, { id: 5, roles: ['shell'] },
    { id: 6, roles: ['shell', 'apply_patch', 'metadata-node'] },
    { id: 7, roles: ['shell'] }, { id: 8, roles: ['shell', 'data-node'] },
    { id: 9, roles: ['shell', 'apply_patch', 'patch-paths-node'] },
    { id: 10, roles: ['shell', 'apply_patch'] },
    { id: 11, roles: ['shell', 'apply_patch', 'seal-node', 'git-ls-tree', 'git-add', 'git-commit', 'git-log'] },
    { id: 12, roles: ['shell', 'source-node', ...Array(8).fill('llvm-otool-metadata'), ...Array(15).fill('patch')] },
    { id: 13, roles: ['shell', 'apply_patch', 'inspect-build-node'] },
    { id: 14, roles: ['shell', 'apply_patch', 'publish-node', 'git-add', 'git-commit', 'git-log'], disposition: 'Publication sequence; Git retirement recorded by outer tool result' }
  ] };
  ledger.totalRoles = ledger.calls.reduce((sum, call) => sum + call.roles.length, 0);
  assert.equal(ledger.totalRoles, 63);
  await writeFile(root + 'PROCESS-LEDGER.json', JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const result = JSON.parse(await readFile(root + 'RUN-01/RESULT.json', 'utf8'));
  assert.equal(result.closedChildren, 23); assert.equal(result.starts, 23); assert(result.ownedClosed);
  const publication = { at: new Date().toISOString(), signatureCommit: 'fe5d87a215310cbe847bee99bbe3c7650aa3f6e3', sourceInventoryHash: inventory.sha256, exactSourceMembers: actual.length, sourceRegularBytes: actual.reduce((sum, row) => sum + (row.bytes ?? 0), 0), appendAndMutationCheck: true, nativeChildrenClosed: 23, processRoleCeiling: 63, plannedOuterMaximum: 64, buildRuns: 0, activeOwnedChildren: 0, retainedWork: inventory.source, temporaryTarRemoved: true };
  await writeFile(root + 'PUBLICATION.json', JSON.stringify(publication, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const rows = [];
  const walk = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      const pathname = directory + '/' + entry.name;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(pathname, name + '/');
      else {
        assert(entry.isFile() && !entry.isSymbolicLink());
        const stat = await lstat(pathname);
        assert(stat.size <= 4 * 1024 * 1024);
        const bytes = await readFile(pathname);
        if (/\.(?:mjs|md)$/.test(name)) assert(!bytes.toString('utf8').split('\n').some(line => /[ \t]+$/.test(line)), 'NEW_CODE_OR_DOC_TRAILING_WHITESPACE');
        rows.push({ path: name, bytes: stat.size, mode: (stat.mode & 0o777).toString(8), sha256: hash(bytes), role: /\.(?:raw|json)$/.test(name) ? 'CAPTURE_OR_DATA' : 'REVIEW_CODE_OR_DOCUMENT' });
      }
    }
  };
  await walk(root.slice(0, -1));
  assert(rows.reduce((sum, row) => sum + row.bytes, 0) < 32 * 1024 * 1024);
  await writeFile(root + 'FINAL-SEAL.json', JSON.stringify({ rows, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), canonicalRowsSha256: hash(JSON.stringify(rows)), captureModeAuthority: 'Fresh exclusive file creation plus final lstat, not Git index mode', sourceProof: publication }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
} catch (error) {
  await writeFile(root + 'PUBLICATION-FAILURE.json', JSON.stringify({ message: error.message, stack: error.stack }) + '\n', { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
