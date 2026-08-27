import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(own);
const repo = path.resolve(own, '../../../../..');
const relativeRoot = path.relative(repo, root);
const manifestFile = path.join(own, 'COMMIT-MANIFEST.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manifestBytes = fs.readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.scope, relativeRoot);
assert.equal(manifest.schema, 1);
assert.equal(manifest.selfHash.path, path.relative(repo, manifestFile));
const normalized = structuredClone(manifest);
const normalizedSelf = normalized.files.find(entry => entry.path === manifest.selfHash.path);
assert.ok(normalizedSelf);
normalizedSelf.sha256 = null;
normalizedSelf.bytes = null;
const canonicalSelfSha256 = hash(JSON.stringify(normalized));
const actual = [];
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    const relative = path.relative(repo, filename);
    assert.ok(!item.isSymbolicLink(), relative);
    assert.ok(!relative.split('/').some(component => ['node_modules', '.git', '.snapshot', 'execution-closure', 'authenticated-package'].includes(component)), relative);
    if (item.isDirectory()) walk(filename);
    else {
      const stat = fs.lstatSync(filename);
      assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < 64 * 1024 * 1024, relative);
      assert.ok(['.json', '.jsonl', '.mjs', '.py', '.md', '.txt', '.log', '.stdout', '.stderr'].includes(path.extname(relative)), relative);
      const bytes = fs.readFileSync(filename);
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      actual.push({ path: relative, bytes: bytes.length, mode: `0${(stat.mode & 0o777).toString(8)}`, gitMode: stat.mode & 0o111 ? '100755' : '100644', sha256: relative === manifest.selfHash.path ? canonicalSelfSha256 : hash(bytes), hashKind: relative === manifest.selfHash.path ? 'canonical-self' : 'raw-file' });
    }
  }
}
walk(root);
actual.sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(actual, manifest.files);
assert.equal(new Set(actual.map(entry => entry.path)).size, actual.length);
assert.equal(manifest.fileCount, actual.length);
for (const entry of actual) {
  assert.ok(entry.path.startsWith(relativeRoot + '/'));
  assert.equal(fs.lstatSync(path.join(repo, entry.path)).size, entry.bytes);
  if (entry.hashKind === 'raw-file') assert.equal(hash(fs.readFileSync(path.join(repo, entry.path))), entry.sha256);
}
assert.equal(hash(fs.readFileSync(manifestFile)), hash(manifestBytes));
const receipt = { at: new Date().toISOString(), status: 'AUTHENTICATION_SCOPE_EXACT_FILE_HASH_MODE_MANIFEST_PASS', productCalls: 0, manifest: path.relative(repo, manifestFile), manifestRawSha256: hash(manifestBytes), canonicalSelfSha256, files: actual.length, bytes: actual.reduce((total, entry) => total + entry.bytes, 0), authorFiles: actual.filter(entry => !entry.path.startsWith(path.relative(repo, own) + '/')).length, verifierFiles: actual.filter(entry => entry.path.startsWith(path.relative(repo, own) + '/')).length, regularTextFilesOnly: true, noDependencyTreeTarballOrUnsafeLinks: true, allRawEvidenceIncluded: true, privatePayloadQualification: 'No package/dependency/private-runtime payload copied; retained public harness/extractor source and text evidence only. Path/hash manifests are not vendored payloads.', exactFileArguments: actual.map(entry => entry.path) };
const output = path.resolve(process.argv[2] ?? '');
assert.ok(/^\/(?:private\/)?tmp\/safe-bash-baseline-auth-/u.test(output));
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, files: receipt.files, bytes: receipt.bytes, manifestRawSha256: receipt.manifestRawSha256 }));
