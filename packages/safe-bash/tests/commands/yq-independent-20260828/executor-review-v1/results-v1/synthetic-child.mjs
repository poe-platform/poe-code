import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const specification = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (specification.marker) writeFileSync(specification.marker, 'admitted\n', { flag: 'wx', mode: 0o644 });
if (specification.mutate) writeFileSync(specification.mutate, 'synthetic mutation\n');
if (specification.stderr) process.stderr.write(specification.stderr);
if (specification.mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 10000));
if (specification.mode === 'signal') process.kill(process.pid, 'SIGTERM');
if (specification.mode === 'overflow') process.stdout.write('x'.repeat(70000));
if (specification.mode === 'type') {
  const { classifyCompilerOutcome } = await import(pathToFileURL(specification.typeModule).href);
  const fact = classifyCompilerOutcome(specification.job, specification.raw, specification.files);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, jobId: specification.id, outcome: 'PASS', fact }) + '\n');
} else if (specification.raw !== undefined) process.stdout.write(specification.raw);
else if (!['timeout', 'signal', 'overflow', 'missing'].includes(specification.mode)) {
  process.stdout.write(JSON.stringify(specification.receipt ?? { schemaVersion: 1, jobId: specification.id, outcome: specification.mode === 'fail' ? 'FAIL' : 'PASS' }) + '\n');
}
process.exitCode = specification.exitCode ?? 0;
