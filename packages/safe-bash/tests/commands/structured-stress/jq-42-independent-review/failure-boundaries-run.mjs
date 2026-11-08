import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { addArtifact, root, sourceSnapshot } from './common.mjs';

const before = sourceSnapshot();
assert.equal(before.structuredSha256, '66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c');
const phases = [];
for (let repetition = 1; repetition <= 3; repetition++) {
  const args = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', 'tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts'];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, shell: false });
  const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  phases.push({ repetition, command: process.execPath, args, status: result.status, signal: result.signal, error: result.error?.message, counts, stdout: result.stdout, stderr: result.stderr });
  console.log(repetition, result.status, counts);
}
for (const [name, command, args] of [
  ['scoped-typecheck', 'node_modules/.bin/tsc', ['--noEmit', '-p', 'tests/commands/structured-stress/jq-42-independent-review/tsconfig.json']],
  ['global-typecheck', 'npm', ['run', 'typecheck']],
]) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, shell: false });
  phases.push({ name, command, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  console.log(name, result.status);
}
const after = sourceSnapshot();
addArtifact('failure-boundaries-results.json', { recordedAt: new Date().toISOString(), before, after, stableStructured: before.structuredSha256 === after.structuredSha256, stableProduct: before.productSha256 === after.productSha256, phases });
process.exitCode = phases.some(phase => phase.status !== 0) ? 1 : 0;
