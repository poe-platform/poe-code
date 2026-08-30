import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
assert.equal(process.env.TREE_HOLDOUT_ROOT_RESUMED, 'AUTHOR_FINISHED', 'Explicit root resume is required');
assert.ok(process.argv[2], 'usage: node run-frozen.mjs /absolute/frozen-candidate');
const candidate = await realpath(resolve(process.argv[2]));
const manifest = JSON.parse(await readFile(join(directory, 'evidence/initial/full-input-files.json'), 'utf8'));
for (const entry of manifest) {
  const bytes = await readFile(join(candidate, entry.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Frozen input differs: ${entry.path}`);
}
const output = await mkdtemp(join(tmpdir(), 'safe-bash-tree-replay-'));
for (const name of ['bridge.mjs', 'execute.mjs']) await copyFile(join(directory, 'driver', name), join(output, name));
await copyFile(join(directory, 'evidence/initial/profile.json'), join(output, 'profile.json'));
console.log(`New cohort output: ${output}`);
const child = spawn(process.execPath, [join(output, 'execute.mjs')], {
  cwd: output, stdio: 'inherit', env: { ...process.env, TREE_CANDIDATE_DIR: candidate, TREE_SEALED_DIR: join(directory, 'sealed') },
});
const result = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); });
assert.equal(result.signal, null);
process.exitCode = result.code ?? 1;
const report = JSON.parse(await readFile(join(output, 'initial-results.json'), 'utf8'));
if (report.cohort.some((entry) => !['pass', 'unsupported-not-pass', 'characterized-not-pass'].includes(entry.status))) process.exitCode = 1;
