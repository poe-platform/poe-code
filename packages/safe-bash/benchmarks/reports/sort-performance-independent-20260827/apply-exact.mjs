import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(dirname(import.meta.filename), '../../..'), target = join(repo, 'src/commands/text.ts');
const output = process.argv[2]; assert.ok(output?.startsWith('/tmp/'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proposal = JSON.parse(await readFile(join(repo, 'benchmarks/reports/sort-performance-20260827/prototypes/proposal.json')));
const before = await readFile(target), patch = await readFile(join(repo, 'benchmarks/reports/sort-performance-20260827/prototypes/candidate.patch'), 'utf8');
assert.equal(hash(before), proposal.beforeSha256); assert.equal(hash(patch), proposal.patchSha256);
assert.equal(execFileSync('git', ['diff', '--', 'src/commands/text.ts'], { cwd: repo }).length, 0);
assert.equal(execFileSync('git', ['diff', '--cached', '--', 'src/commands/text.ts'], { cwd: repo }).length, 0);
const report = { capturedAt: new Date().toISOString(), parentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(), beforeSha256: hash(before), patchSha256: hash(patch),
  priorIndex: execFileSync('git', ['diff', '--cached', '--name-status'], { cwd: repo }).toString(), exactCandidateOnly: true, rootConditionalAuthorization: true };
const scratch = await mkdtemp('/tmp/sort-exact-application-');
try {
  const hunks = patch.slice(patch.indexOf('@@')).trimEnd().split('\n').map(line => line.startsWith('@@') ? '@@' : line).join('\n');
  const file = join(scratch, 'candidate.patch'); await writeFile(file, `*** Begin Patch\n*** Update File: ${target}\n${hunks}\n*** End Patch\n`);
  const handle = await open(file, 'r');
  try { const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [handle.fd, 'pipe', 'pipe'] }); assert.equal(result.status, 0, result.stderr?.toString()); }
  finally { await handle.close(); }
  report.afterSha256 = hash(await readFile(target)); assert.equal(report.afterSha256, proposal.candidateSha256);
  report.diff = execFileSync('git', ['diff', '--', 'src/commands/text.ts'], { cwd: repo }).toString();
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log('Applied exact accepted candidate', report.afterSha256);
} finally { await rm(scratch, { recursive: true, force: true }); }
