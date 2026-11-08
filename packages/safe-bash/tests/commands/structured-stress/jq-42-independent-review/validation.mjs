import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { addArtifact, auditCommit, digest, directory, git, root, sourceSnapshot } from './common.mjs';

const before = sourceSnapshot();
assert.equal(before.structuredSha256, '66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c');
const owned = relative(root, directory);
const author = 'tests/commands/structured-stress/jq-42-author-20260827';
const originalFailures = [...readFileSync(`${author}/final-owned.tap`, 'utf8').matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]);
assert.equal(originalFailures.length, 22);
const originalFiles = [
  'tests/commands/structured-stress/independent-increment/safety.test.ts',
  'tests/commands/structured-stress/raw-input.test.ts',
  'tests/commands/structured-stress/safety.test.ts',
  'tests/commands/structured/cli.test.ts',
  'tests/commands/structured/resources.test.ts',
];
const phases = [];
const run = (name, command, args) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' }, encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const failures = [...stdout.matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]);
  phases.push({ name, command, args, startedAt, endedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, counts, failures, stdout, stderr });
  console.log(name, result.status, counts);
};
const prefix = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap'];
const pattern = `^(?:${originalFailures.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})$`;
run('original-22-unchanged', process.execPath, [...prefix, `--test-name-pattern=${pattern}`, ...originalFiles]);
assert.deepEqual([...phases[0].failures].sort(), [...originalFailures].sort());
for (let repetition = 1; repetition <= 3; repetition++) run(`author-safety-${repetition}`, process.execPath, [...prefix, `${author}/safety.test.ts`]);
run('review-evidence-controls', process.execPath, [...prefix, `${owned}/evidence.test.ts`]);
run('scoped-typecheck', 'node_modules/.bin/tsc', ['--noEmit', '-p', `${owned}/tsconfig.json`]);
run('global-typecheck', 'npm', ['run', 'typecheck']);
const historicalPaths = git(['ls-tree', '-r', '--name-only', auditCommit, 'tests/commands/structured', 'tests/commands/structured-stress', 'benchmarks/reports/current-integration']).toString().trim().split('\n');
const prepPaths = git(['ls-tree', '-r', '--name-only', 'a2a567c', owned]).toString().trim().split('\n').filter(path => path !== `${owned}/README.md`);
const unchanged = (paths, commit) => paths.map(path => {
  const frozenSha256 = digest(git(['show', `${commit}:${path}`]));
  const currentSha256 = digest(readFileSync(path));
  return { path, frozenSha256, currentSha256, unchanged: frozenSha256 === currentSha256 };
});
const historical = unchanged(historicalPaths, auditCommit);
const prep = unchanged(prepPaths, 'a2a567c');
const structured = before.files;
const authorSourceMatches = Object.entries(structured).filter(([path]) => path.startsWith('src/commands/structured/')).map(([path, currentSha256]) => ({ path, currentSha256, handoffSha256: digest(git(['show', `d1f78d4:${path}`])) }));
const structuredStatus = git(['status', '--short', '--', 'src/commands/structured']).toString();
const after = sourceSnapshot();
const report = { recordedAt: new Date().toISOString(), before, after, stableStructured: before.structuredSha256 === after.structuredSha256, stableProduct: before.productSha256 === after.productSha256, originalFailures, phases, historical, prep, structuredStatus, authorSourceMatches };
addArtifact('bounded-validation.json', report);
console.log(JSON.stringify({ stableStructured: report.stableStructured, stableProduct: report.stableProduct, historicalFiles: historical.length, changedHistorical: historical.filter(row => !row.unchanged), prepFiles: prep.length, changedPrep: prep.filter(row => !row.unchanged), sourceMatchesHandoff: authorSourceMatches.every(row => row.currentSha256 === row.handoffSha256), structuredStatus }, null, 2));
process.exitCode = phases.some(phase => phase.status !== 0) ? 1 : 0;
