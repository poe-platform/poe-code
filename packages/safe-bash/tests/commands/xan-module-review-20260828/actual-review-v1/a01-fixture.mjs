import { once } from 'node:events';
const [variant, encoded] = process.argv.slice(2);
const expected = JSON.parse(encoded);
const cases = expected.requiredIds.map(id => ({ stage: 'CASE', id, status: 'PASS', closed: true, intact: true }));
const final = { stage: 'FINALIZATION', job: expected.job, phase: expected.phase, manifest: expected.manifest,
  nonce: expected.nonce, requiredIds: expected.requiredIds, requiredCount: cases.length, completedCount: cases.length,
  failures: 0, complete: true, closed: true, intact: true };
if (variant === 'timeout') await new Promise(() => {});
if (variant === 'missing-phase') delete final.phase;
if (variant === 'wrong-phase') final.phase = 'WRONG';
if (variant === 'incomplete') final.complete = false;
if (variant === 'closed-false') final.closed = false;
if (variant === 'wrong-job') final.job = 'different-job';
if (variant === 'wrong-manifest') final.manifest = 'different-manifest';
if (variant === 'stale-nonce') final.nonce = 'stale';
if (variant === 'wrong-count') final.requiredCount++;
if (variant === 'missing-id') cases.pop();
if (variant === 'duplicate-id') cases[1].id = cases[0].id;
if (variant === 'failed-required-case' || variant === 'failed-required-control') { cases[0].status = 'FAIL'; final.failures = 1; process.exitCode = 1; }
if (variant === 'failed-case-exit-zero') { cases[0].status = 'FAIL'; final.failures = 1; }
if (variant === 'nonzero-child') process.exitCode = 7;
if (variant === 'false-failure-count') { cases[0].status = 'FAIL'; }
if (variant === 'integrity-false') final.intact = false;
if (variant === 'case-unclosed') cases[0].closed = false;
if (variant === 'exit-zero-without-proof') process.exit(0);
const records = [...cases, ...(variant === 'no-final' ? [] : [final]), ...(variant === 'duplicate-final' ? [final] : [])];
for (const record of records) if (!process.stdout.write(`${JSON.stringify(record)}\n`)) await once(process.stdout, 'drain');
