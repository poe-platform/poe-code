import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const label = process.argv[2];
const source = process.argv[3];
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(source ?? '', /^[0-9a-f]{40}$/);
const evidence = join(own, 'evidence', label);
await mkdir(evidence);
const workspace = await mkdtemp('/tmp/safe-bash-webdav-scope-author-');
const output = join(workspace, 'capture');
await mkdir(join(workspace, 'home'));
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin`, HOME: join(workspace, 'home'), TMPDIR: workspace,
  LANG: 'C.UTF-8', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = spawnSync('git', args, { cwd: repo, env, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr)); return result.stdout;
};
const independent = 'tests/fs/webdav/real-service-independent';
const inputs = {};
try {
  for (const name of ['run.mjs', 'independent.mts', 'public-guard.mjs', 'README.md', 'REPORT.md']) {
    const bytes = await readFile(join(repo, independent, name));
    const frozen = git(['show', `6e0ff0b:${independent}/${name}`]);
    assert.equal(hash(bytes), hash(frozen), `unchanged independent ${name}`);
    inputs[name] = hash(bytes);
  }
  await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ source, sourceSha256: hash(git(['show', `${source}:src/fs/webdav/webdav.ts`])),
    independentCommit: git(['rev-parse', '6e0ff0b']).toString().trim(), inputs, status: git(['status', '--short']).toString(),
    originalSourceSha256: hash(git(['show', 'e8acecc3a843642ca83127d43d8c65ea46c2c0e4:src/fs/webdav/webdav.ts'])), startedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  const result = spawnSync(process.execPath, [join(repo, independent, 'run.mjs'), output, source], { cwd: repo, env, timeout: 780000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(evidence, 'stdout.log'), result.stdout ?? '', { flag: 'wx' });
  await writeFile(join(evidence, 'stderr.log'), result.stderr ?? '', { flag: 'wx' });
  await writeFile(join(evidence, 'command.json'), JSON.stringify({ command: process.execPath, args: [join(independent, 'run.mjs'), output, source], status: result.status, signal: result.signal, error: result.error?.message }, null, 2), { flag: 'wx' });
  await cp(output, join(evidence, 'capture'), { recursive: true, errorOnExist: true, force: false });
  assert.equal(result.status, 0, 'independent capture completion, not behavioral acceptance');
  const report = JSON.parse(await readFile(join(output, 'run.json')));
  assert.equal(report.cleanup, true); assert.equal(report.validationPassed, true);
  await assert.rejects(access(report.temporary), { code: 'ENOENT' });
  for (const [name, digest] of Object.entries(inputs)) assert.equal(hash(await readFile(join(repo, independent, name))), digest);
  console.log(result.stdout);
} finally {
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ workspace, output, removed: true, endedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
}
