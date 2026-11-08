const [mode] = process.argv.slice(2);
if (mode === 'quick') process.stdout.write('bounded child\n');
else if (mode === 'wait') setTimeout(() => process.stdout.write('settled\n'), 120);
else if (mode === 'output') process.stdout.write('x'.repeat(4096));
else if (mode === 'exit-one') process.exitCode = 1;
else throw new Error('unsealed child mode');
