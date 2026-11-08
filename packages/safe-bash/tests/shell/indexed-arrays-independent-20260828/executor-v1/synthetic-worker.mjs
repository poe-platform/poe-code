const mode = process.argv[2];
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (mode === 'timeout') setInterval(() => {}, 1000);
else if (mode === 'overflow') process.stdout.write('x'.repeat(32768));
else if (mode === 'empty') process.exitCode = 0;
else {
  const pass = mode !== 'failure';
  const row = { observation: { id: 'synthetic-only', category: 'harness-synthetic', pass, settled: true, disposed: true } };
  emit(row); if (mode === 'duplicate') emit(row);
  emit({ summary: { cases: 1, pass: mode === 'bad-summary' ? 19 : Number(pass), failed: pass ? [] : ['synthetic-only'] } });
  process.exitCode = mode === 'late-nonzero' ? 7 : pass ? 0 : 1;
}
