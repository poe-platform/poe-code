import assert from 'node:assert/strict';
const mode = process.argv[2];
assert.ok(mode === 'ordinary' || mode === 'late-pass-nonzero');
process.stdout.write(mode === 'ordinary' ? 'stdout-only\n' : 'ALL_PASS\n');
process.stderr.write('stderr-only\n');
process.exitCode = mode === 'ordinary' ? 0 : 7;
