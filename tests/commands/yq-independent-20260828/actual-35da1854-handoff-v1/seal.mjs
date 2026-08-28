import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repository = '/Users/kjopek/Workspace/safe-bash';
const scope = join(repository, 'tests/commands/yq-independent-20260828/actual-35da1854-handoff-v1');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sealPath = join(scope, 'FINAL-SEAL.json');
const entries = [];

function visit(path, relative) {
  const stat = lstatSync(path);
  assert(!stat.isSymbolicLink());
  assert.equal(realpathSync(path), path);
  if (stat.isDirectory()) {
    entries.push({ path: relative || '.', kind: 'directory', mode: stat.mode & 0o7777 });
    for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
  } else {
    assert(stat.isFile() && stat.nlink === 1);
    const bytes = readFileSync(path);
    entries.push({ path: relative, kind: 'file', mode: stat.mode & 0o7777, bytes: bytes.length, sha256: digest(bytes) });
  }
}

assert.equal(process.cwd(), repository);
assert(!existsSync(sealPath));
const extraction = JSON.parse(readFileSync(join(scope, 'evidence/EXTRACTION-RESULT.json')));
const validation = JSON.parse(readFileSync(join(scope, 'evidence/VALIDATION.json')));
assert.equal(extraction.sourceCommit, '903860c4fc34dd5482a3fc751dab8a25d85851c9');
assert.equal(extraction.newProductRuns, 0);
assert.equal(validation.exitCode, 0);
assert.equal(validation.productOrHarnessRuns, 0);
assert.equal(validation.originalAggregate, 'FAIL');
assert.equal(readFileSync(join(scope, 'extract.stderr.bin')).length, 0);
assert.equal(readFileSync(join(scope, 'validate.stderr.bin')).length, 0);
visit(scope, '');
const seal = {
  schema: 1,
  date: '2026-08-28',
  classification: 'ARTIFACT_ONLY_HANDOFF_NO_EXECUTION_AUTHORIZATION',
  sourceCommit: extraction.sourceCommit,
  actualEvidenceCommit: extraction.oldActualCommit,
  independentBuildCommit: extraction.buildCommit,
  originalAggregate: 'FAIL',
  oldEvidenceImmutable: true,
  files: entries.filter((entry) => entry.kind === 'file').length,
  entryDigest: digest(JSON.stringify(entries)),
  excludes: ['FINAL-SEAL.json'],
  entries,
};
writeFileSync(sealPath, `${JSON.stringify(seal, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ status: 'HANDOFF_SEALED', filesIncludingSeal: seal.files + 1, finalSealSha256: digest(readFileSync(sealPath)), originalAggregate: 'FAIL', newProductOrHarnessRuns: 0 }));
