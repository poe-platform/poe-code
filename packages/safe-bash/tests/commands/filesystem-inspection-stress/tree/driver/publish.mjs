import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const owned = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const evidence = join(owned, 'evidence/initial');
const drivers = join(owned, 'driver');
await mkdir(evidence, { recursive: true });
await mkdir(drivers, { recursive: true });
await cp('/tmp/safe-bash-tree-hidden-prep-vyzfHc', join(owned, 'sealed'), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
for (const name of ['freeze.json', 'candidate-files.json', 'source-files.json', 'dependency-files.json', 'full-input-files.json', 'profile.json', 'provenance-check.json', 'native-build-original-excerpt.txt', 'author-detail.original.txt', 'initial-results.json', 'analysis.json', 'scoped-typecheck.stdout', 'scoped-typecheck.stderr']) await copyFile(join(directory, name), join(evidence, name));
for (const name of ['bridge.mjs', 'execute.mjs', 'analyze.mjs', 'freeze.py', 'provenance-check.py', 'publish.mjs']) await copyFile(join(directory, name), join(drivers, name));
await copyFile('/tmp/safe-bash-tree-holdout-prep-detail.txt', join(evidence, 'original-prep-detail.txt'));
await copyFile('/tmp/safe-bash-tree-holdout-failures.txt', join(evidence, 'root-failure-route.txt'));
const coverage = [];
for (const caseName of await readdir(join(directory, 'raw'))) {
  const source = join(directory, 'raw', caseName);
  const target = join(evidence, 'raw', caseName);
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile()) await copyFile(join(source, entry.name), join(target, entry.name));
  }
  for (const name of await readdir(join(source, 'coverage'))) {
    const bytes = await readFile(join(source, 'coverage', name));
    coverage.push({ case: caseName, filename: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retainedPath: join(source, 'coverage', name) });
  }
}
await writeFile(join(evidence, 'coverage-file-index.json'), `${JSON.stringify(coverage, null, 2)}\n`);
console.log(JSON.stringify({ publishedScope: owned, copiedSealedCorpus: true, copiedRawCaseDirectories: 38, retainedCoverageFiles: coverage.length, copiedFullCandidateIntoRepository: false }));
