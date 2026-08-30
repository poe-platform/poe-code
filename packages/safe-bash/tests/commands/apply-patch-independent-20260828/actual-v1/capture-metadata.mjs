import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = '/Users/kjopek/Workspace/safe-bash';
const evidence = '767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5';
const candidate = '58be2d6c5706f3e90f01d48e695ecfd9daa52669';
const owned = 'tests/commands/apply-patch-independent-20260828/actual-v1';
const gitCalls = [];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(args) {
  assert.ok(gitCalls.length < 12);
  gitCalls.push(args);
  return execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: root, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
}
function describe(filename) {
  const absolute = path.resolve(root, filename);
  const stat = fs.lstatSync(absolute);
  assert.ok(stat.isFile(), filename);
  assert.ok(stat.size <= 128 * 1024 * 1024);
  return { path: filename, bytes: stat.size, mode: stat.mode & 0o777, sha256: digest(fs.readFileSync(absolute)) };
}
function tree(directory) {
  const entries = [];
  let bytes = 0;
  function walk(relative, depth) {
    assert.ok(depth <= 20);
    for (const name of fs.readdirSync(path.resolve(root, relative)).sort()) {
      const filename = `${relative}/${name}`;
      const stat = fs.lstatSync(path.resolve(root, filename));
      assert.ok(entries.length < 2000);
      if (stat.isDirectory()) {
        entries.push({ path: filename, mode: stat.mode & 0o777, type: 'directory' });
        walk(filename, depth + 1);
      } else {
        const entry = describe(filename);
        bytes += entry.bytes;
        assert.ok(bytes <= 128 * 1024 * 1024);
        entries.push(entry);
      }
    }
  }
  walk(directory, 0);
  return { directory, bytes, entries, sha256: digest(JSON.stringify(entries)) };
}
assert.equal(git(['cat-file', '-t', candidate]).toString().trim(), 'commit');
assert.equal(git(['cat-file', '-t', evidence]).toString().trim(), 'commit');
const matrixRevision = git(['rev-parse', '7df79906^{commit}']).toString().trim();
const planRevision = git(['rev-parse', '19fc5c36^{commit}']).toString().trim();
const candidateData = git(['show', `${evidence}:tests/commands/apply-patch-author-20260828/CANDIDATE-v1.json`]);
const baseManifest = git(['show', `${evidence}:tests/integration/coherent78-shell-author-20260828/MANIFEST.json`]);
const sourceTree = git(['ls-tree', '-r', candidate, '--', 'src/commands/apply-patch']);
const candidateInventory = git(['ls-tree', '-r', '--full-tree', candidate]);
const source = JSON.parse(candidateData).source;
assert.equal(source.length, 6);
const sourceEntries = sourceTree.toString().trim().split('\n').map(line => {
  const [mode, type, blob, filename] = line.split(/\s+/);
  assert.equal(type, 'blob');
  return { ...source.find(entry => entry.path === filename), path: filename, mode, blob, revision: candidate };
});
assert.equal(sourceEntries.length, 6);
const manifests = ['README.md', 'PRESEAL-v1.json', 'ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json', 'LIMITS-v1.json', 'PROTOCOL-v1.json', 'POLICY-v1.json'];
const matrix = manifests.map(name => describe(`tests/commands/apply-patch-independent-20260828/matrix/${name}`));
const preparation = ['ADMISSION-v1.md', 'INPUTS-v1.json', 'MUTATIONS-v1.json', 'DATA-RESULT-v1.json', 'HANDOFF-v1.md'].map(name => describe(`tests/commands/apply-patch-independent-20260828/admission-plan/${name}`));
const tools = [describe(process.execPath), describe('/usr/bin/git'), tree('node_modules/typescript'), tree('node_modules/@types/node'), tree('node_modules/undici-types')];
const result = {
  schema: 'apply-patch-actual-v1-metadata', capturedAt: new Date().toISOString(),
  phase: 'METADATA_ONLY_BEFORE_IMPLEMENTATION_INSPECTION', candidate, evidence,
  matrixRevision, planRevision, candidateManifestSha256: digest(candidateData),
  baseManifestSha256: digest(baseManifest), baseManifest: JSON.parse(baseManifest), sourceEntries,
  candidateTrackedInventory: candidateInventory.toString(), candidateTrackedInventorySha256: digest(candidateInventory),
  matrix, preparation, tools, nodeVersion: process.version,
  instructionHashesOnly: [describe('AGENTS.md')],
  gitCalls, counts: { developerGitMetadataChildren: gitCalls.length, productImports: 0, builds: 0, runtimeChildren: 0 },
  closureQualification: 'Local compiler package, all lib data, @types/node and undici-types census; dynamic system libraries are OS trust, not vendored package closure. Candidate tracked names/modes/blobs only, not candidate code inspection.'
};
const text = JSON.stringify(result, null, 2) + '\n';
console.log(`*** Begin Patch\n*** Add File: ${owned}/METADATA.json\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch`);
