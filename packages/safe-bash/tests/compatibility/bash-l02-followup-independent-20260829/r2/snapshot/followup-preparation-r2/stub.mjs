if(process.argv[2]==='normal')process.stdout.write('owned\n');else if(process.argv[2]==='failure'){process.stderr.write('owned-failure\n');process.exitCode=7;}else throw Error('fixture mode');
