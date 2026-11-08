const mode = process.argv[2];
const row = { observation: { id: 'F1', pass: mode !== 'ordinary-failure', settled: true, disposed: true, result: { stdout: '雪😀' } } };
const summary = { summary: { cases: 1, pass: row.observation.pass ? 1 : 0, failed: row.observation.pass ? [] : ['F1'] } };
if (mode === 'wrong-summary') summary.summary.failed = null;
if (mode === 'missing') summary.summary.cases = 2;
if (mode === 'cap') process.stdout.write('x'.repeat(8192));
else if (mode === 'split-utf8') {
  const bytes = Buffer.from(JSON.stringify(row) + '\n' + JSON.stringify(summary) + '\n');
  const split = bytes.indexOf(Buffer.from('雪')) + 1;
  process.stdout.write(bytes.subarray(0, split)); setTimeout(() => process.stdout.write(bytes.subarray(split)), 5);
} else {
  process.stdout.write(JSON.stringify(row) + '\n');
  if (mode === 'duplicate') process.stdout.write(JSON.stringify(row) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
}
if (mode === 'ordinary-failure') process.exitCode = 1;
if (mode === 'late-exit') process.exitCode = 7;
if (mode === 'late-throw') queueMicrotask(() => { throw new Error('after all PASS receipts'); });
if (mode === 'hang') setInterval(() => {}, 1000);
