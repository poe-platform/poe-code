const [mode, encoded] = process.argv.slice(2);
const expected = JSON.parse(encoded);
if (mode === 'timeout') await new Promise(() => { setInterval(() => {}, 1000); });
const cases = expected.requiredIds.map(id => ({ stage: 'CASE', id, status: mode.endsWith('-fail') ? 'FAIL' : 'PASS', closed: true, intact: true }));
if (mode === 'missing-required') cases.pop();
if (mode === 'duplicate') cases.push(cases[0]);
const final = { stage: 'FINALIZATION', ...expected, requiredCount: expected.requiredIds.length,
  completedCount: cases.length, failures: cases.filter(item => item.status !== 'PASS').length,
  complete: true, closed: true, intact: true };
if (mode === 'stale') final.nonce = 'stale';
if (mode === 'wrong-job') final.job = 'wrong';
if (mode === 'wrong-manifest') final.manifest = 'wrong';
if (mode === 'wrong-phase') final.phase = 'wrong';
if (mode === 'wrong-count') final.requiredCount++;
if (mode === 'incomplete') final.complete = false;
if (mode === 'cleanup-false') final.closed = false;
if (mode === 'intact-false') final.intact = false;
for (const record of [...cases, final]) process.stdout.write(`${JSON.stringify(record)}\n`);
if (mode === 'final-position') process.stdout.write('{}\n');
process.exitCode = mode.startsWith('nonzero-') ? 7 : 0;
