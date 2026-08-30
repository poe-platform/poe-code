process.stdout.write('OUT\n');
process.stderr.write('ERR\n');
process.exitCode = process.argv[2] === 'nonzero' ? 7 : 0;
