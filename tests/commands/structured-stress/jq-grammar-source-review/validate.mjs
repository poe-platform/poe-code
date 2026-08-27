import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { artifact, root, snapshot } from './common.mjs';

const before = snapshot();
const jobs = [];
const testCommand = paths => [process.execPath, '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', ...paths];
for (let repetition = 1; repetition <= 3; repetition++) {
  jobs.push([`seven-boundaries-${repetition}`, testCommand(['tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts']), 10000]);
  jobs.push([`safety-${repetition}`, testCommand([
    'tests/commands/structured-stress/jq-42-author-20260827/safety.test.ts',
    'tests/commands/structured-stress/jq-42-review-fixes/boundaries.test.ts',
    'tests/commands/structured-stress/jq-grammar-author-20260827/limits.test.ts',
  ]), 30000]);
}
for (const name of ['author114', 'historical238', 'author-nearby117']) {
  const prior = JSON.parse(readFileSync(`tests/commands/structured-stress/jq-42-independent-final/r2-${name}.json`));
  jobs.push([name, [process.execPath, '--unhandled-rejections=strict', ...prior.command.slice(1)], 120000]);
}
const allTests = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!['jq-grammar-author-20260827', 'jq-grammar-source-review'].includes(entry.name)) walk(child);
    } else if (entry.name.endsWith('.test.ts')) allTests.push(child);
  }
}
walk('tests/commands/structured');
walk('tests/commands/structured-stress');
jobs.push(['broad-unchanged', testCommand(allTests.sort()), 180000]);
jobs.push(['author-new', testCommand(['grammar', 'legacy', 'scan-boundaries', 'limits'].map(name => `tests/commands/structured-stress/jq-grammar-author-20260827/${name}.test.ts`)), 180000]);
jobs.push(['scoped-types', [process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tests/commands/structured-stress/jq-42-independent-review/tsconfig.json', '--pretty', 'false'], 120000]);
jobs.push(['global-types', ['npm', 'run', 'typecheck'], 120000]);
const results = [];
for (const [name, command, timeout] of jobs) {
  const phaseBefore = snapshot();
  const startedAt = new Date().toISOString();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --unhandled-rejections=strict` }, timeout, maxBuffer: 16 * 1024 * 1024 });
  const after = snapshot();
  const stdout = result.stdout?.toString() ?? '';
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const row = { name, command, watchdogMs: timeout, startedAt, endedAt: new Date().toISOString(), before: phaseBefore, after,
    stableProduct: phaseBefore.productSha256 === after.productSha256, status: result.status, signal: result.signal, error: result.error?.message,
    counts, stdout, stderr: result.stderr?.toString(), stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex') };
  artifact(`${name}.json`, row);
  results.push({ name, status: row.status, counts, stableProduct: row.stableProduct });
  console.log(name, row.status, counts, row.stableProduct);
}
artifact('validation-summary.json', { before, after: snapshot(), results });
