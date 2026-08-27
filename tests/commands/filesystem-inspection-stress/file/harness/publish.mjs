import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readlink, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const target = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const original = '/tmp/safe-bash-file-holdout.KyVGrl0A';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalogBytes = await readFile(join(original, 'seal-catalog.json'));
const catalog = JSON.parse(catalogBytes);
await mkdir(join(target, 'sealed/artifacts'), { recursive: true });
await writeFile(join(target, 'sealed/catalog.json'), catalogBytes, { flag: 'wx' });
for (const entry of catalog.artifacts) {
  const location = join(original, entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(location)) : await readFile(location);
  assert.equal(hash(bytes), entry.sha256);
  await writeFile(join(target, 'sealed/artifacts', entry.id), bytes, { flag: 'wx' });
}
await mkdir(join(target, 'harness'), { recursive: true });
for (const name of ['freeze.mjs', 'build.mjs', 'prepare-run.mjs', 'audit-loader.mjs', 'child.mjs', 'run-initial.mjs', 'summarize.mjs', 'publish.mjs']) await copyFile(join(root, name), join(target, 'harness', name));
await copyFile(join(root, 'holdout/isolated-runner.mjs'), join(target, 'harness/isolated-runner.mjs'));
await mkdir(join(target, 'evidence'), { recursive: true });
for (const name of ['freeze.json', 'build.json', 'build.stdout.txt', 'build.stderr.txt', 'binding.json', 'initial-run.json', 'initial-run.progress.json', 'summary.json', 'native-differences.json', 'adjudication.json']) await copyFile(join(root, name), join(target, 'evidence', name));
for (const directory of ['results', 'primary']) {
  await mkdir(join(target, 'evidence', directory));
  for (const name of await readdir(join(root, directory))) {
    assert((await lstat(join(root, directory, name))).isFile());
    await copyFile(join(root, directory, name), join(target, 'evidence', directory, name));
  }
}
await copyFile('/tmp/safe-bash-file-holdout-failures.txt', join(target, 'evidence/failures.txt'));
await copyFile('/tmp/safe-bash-file-author-detail.txt', join(target, 'evidence/author-handoff.txt'));
console.log(JSON.stringify({ publishedOriginalArtifacts: catalog.artifacts.length, candidateExecutions: 0, dependenciesVendored: 0, target }));
