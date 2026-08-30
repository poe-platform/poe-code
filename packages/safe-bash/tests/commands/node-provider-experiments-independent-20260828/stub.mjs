const mode = process.argv[2];
if (mode === 'normal') process.stdout.write('OK\n');
else if (mode === 'hold') {
  process.stdout.write('READY\n');
  setInterval(() => {}, 1000);
} else if (mode === 'output-bound') process.stdout.write('x'.repeat(96));
else throw new Error('UNLISTED_STUB_MODE');
