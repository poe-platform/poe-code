import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = '/Users/kjopek/Workspace/safe-bash';
export const retained = '/tmp/safe-bash-alias-final-0123-20260827T1634-02';
export const candidate = '0123c83d3aae72a15621acbb29a165b97b2c6ab6';
export const packageSha256 = '62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6';
export const historical = join(repository, 'tests/commands/grep-aliases-stress');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function inventory(directory, relative = '') {
  return readdirSync(join(directory, relative)).sort().flatMap(name => {
    const path = join(relative, name); const absolute = join(directory, path); const metadata = lstatSync(absolute);
    if (metadata.isDirectory()) return [{ path, kind: 'directory' }, ...inventory(directory, path)];
    if (metadata.isSymbolicLink()) { const target = readlinkSync(absolute); return [{ path, kind: 'symlink', target, size: Buffer.byteLength(target), sha256: sha256(target) }]; }
    assert.ok(metadata.isFile(), path);
    return [{ path, kind: 'file', mode: metadata.mode & 0o777, size: metadata.size, sha256: sha256(readFileSync(absolute)) }];
  });
}
export function digest(entries) { return { entries: entries.length, files: entries.filter(row => row.kind === 'file').length, symlinks: entries.filter(row => row.kind === 'symlink').length, sha256: sha256(JSON.stringify(entries)) }; }
function git(args) {
  const child = spawnSync('git', args, { cwd: repository, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr?.toString()); assert.equal(child.signal, null); assert.equal(child.error, undefined);
  return child.stdout;
}
export function audit(stage, additionalConsumer) {
  const final = join(historical, 'final-shared-replay');
  const sealBytes = readFileSync(join(final, 'SHA256SUMS'));
  assert.equal(sha256(sealBytes), '9758c71ee82e5a6a9703c71a8ba25f6d7622e2ec7f2f1a9e8dd76558aaf9e613');
  const sealedRows = sealBytes.toString().trim().split('\n').map(row => row.split('  '));
  assert.deepEqual(inventory(final).filter(row => row.kind !== 'directory').map(row => row.path).sort(), [...sealedRows.map(([, path]) => path), 'SHA256SUMS'].sort());
  for (const [hash, path] of sealedRows) assert.equal(sha256(readFileSync(join(final, path))), hash, path);
  const prior = JSON.parse(readFileSync(join(final, 'attempts/prepare-02/receipt.json')));
  const receiptBytes = readFileSync(join(retained, 'receipt.json'));
  assert.equal(sha256(receiptBytes), prior.projection.originalTemporaryReceiptSha256);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.candidate, candidate); assert.equal(receipt.packageSha256, packageSha256);
  assert.equal(git(['rev-parse', `${candidate}^{commit}`]).toString().trim(), candidate);
  for (const ancestor of receipt.authentication.ancestors) git(['merge-base', '--is-ancestor', ancestor, candidate]);
  for (const [path, identity] of Object.entries(receipt.authentication.identities)) assert.equal(git(['rev-parse', `${candidate}:${path}`]).toString().trim(), identity);
  assert.equal(sha256(readFileSync(join(retained, 'candidate.tar'))), receipt.archiveSha256);
  assert.equal(sha256(readFileSync(join(retained, receipt.packageFilename))), packageSha256);
  const source = join(retained, 'source'); const sourceEntries = inventory(source);
  assert.deepEqual(digest(sourceEntries), prior.preRun.source, 'All source membership including additions');
  const tree = git(['ls-tree', '-r', '-z', candidate]);
  const rows = tree.toString().split('\0').filter(Boolean).map(row => { const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row); assert.ok(match); return { mode: match[1], blob: match[2], path: match[3] }; });
  const committedEntries = sourceEntries.filter(row => row.kind !== 'directory' && !row.path.startsWith('dist/') && !row.path.startsWith('node_modules/'));
  assert.deepEqual(committedEntries.map(row => row.path).sort(), rows.map(row => row.path).sort());
  for (const row of rows) {
    const absolute = join(source, row.path); const metadata = lstatSync(absolute);
    assert.equal(metadata.isSymbolicLink(), row.mode === '120000', row.path);
    const bytes = row.mode === '120000' ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.blob, row.path);
    if (row.path.startsWith('src/')) assert.ok(metadata.isFile());
  }
  for (const dependency of receipt.dependencies) assert.deepEqual(digest(inventory(dependency.installed)), dependency.inventory);
  assert.equal(sha256(readFileSync(join(repository, 'node_modules/.package-lock.json'))), receipt.installedLockSha256);
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json')));
  assert.equal(sha256(readFileSync(join(source, 'package-lock.json'))), receipt.packageLockSha256);
  for (const dependency of receipt.dependencies) {
    const metadata = lock.packages[`node_modules/${dependency.name}`]; assert.equal(metadata.integrity, dependency.integrity); assert.equal(metadata.version, dependency.version);
    const hex = Buffer.from(metadata.integrity.split('-')[1], 'base64').toString('hex');
    const cached = readFileSync(join('/Users/kjopek/.npm/_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)));
    assert.equal(`sha512-${createHash('sha512').update(cached).digest('base64')}`, dependency.integrity); assert.equal(sha256(cached), dependency.cacheSha256);
  }
  for (const seal of receipt.originalSeals) {
    const absolute = join(historical, seal.path); assert.equal(sha256(readFileSync(absolute)), seal.sha256);
    for (const row of readFileSync(absolute, 'utf8').trim().split('\n')) { const [hash, path] = row.split('  '); assert.equal(sha256(readFileSync(join(dirname(absolute), path))), hash); }
  }
  const consumers = [...new Set([receipt.consumer, ...(additionalConsumer ? [additionalConsumer] : [])])].map(consumer => {
    const packageRoot = join(consumer, 'node_modules/virtual-bash'); const actual = inventory(packageRoot);
    assert.deepEqual(digest(actual), prior.preRun.package, 'All package membership including additions');
    const bindings = receipt.loadBindings.map(binding => {
      const absolute = join(packageRoot, binding.path); assert.ok(lstatSync(absolute).isFile());
      assert.equal(sha256(readFileSync(absolute)), binding.sha256);
      return { path: binding.path, sha256: binding.sha256, actualResolvedUrl: pathToFileURL(realpathSync(absolute)).href };
    });
    return { consumer, package: digest(actual), bindings };
  });
  return { stage, at: new Date().toISOString(), candidate, archiveSha256: receipt.archiveSha256, packageSha256, originalReceiptSha256: sha256(receiptBytes), completeSource: digest(sourceEntries), gitEntries: rows.length, gitMembershipSha256: sha256(tree), allGitBlobsVerified: true, additionDetectingInventories: true, dependencies: receipt.dependencies, originalSeals: receipt.originalSeals, finalReplaySeal: sha256(sealBytes), consumers, liveContextOnly: git(['status', '--short']).toString(), liveInputsUsed: false };
}
