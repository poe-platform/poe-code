import { command, directory, save, sourceState, tests } from './capture.mjs';

const phase = process.argv[2];
if (!['source-fixed', 'corrected'].includes(phase)) throw new Error('Expected source-fixed or corrected');
const before = sourceState();
const testFlags = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap'];
const results = {
  targeted: command(process.execPath, [...testFlags, ...tests]),
  matcher: command(process.execPath, [...testFlags,
    'tests/commands/diff-patch/patch-gnu-coordinates.test.ts',
    'tests/commands/diff-patch/patch-hunk-diagnostics-followup.test.ts',
    'tests/commands/diff-patch/hunk-regressions.test.ts',
    'tests/commands/diff-patch/patch-gnu-publication.test.ts',
    'tests/commands/diff-patch-stress/fuzz/properties.test.ts',
    'tests/commands/diff-patch-stress/gnu-target/edit-correctness.test.ts',
  ]),
  types: command(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', `${directory}/tsconfig.json`]),
  build: command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', `${directory}/.build`]),
  whitespace: command('git', ['diff', '--check', '--', 'src/commands/diff-patch', ...tests,
    'tests/commands/diff-patch-stress/emptyfile-delta/helpers.ts', directory]),
};
save(`${directory}/validation-${phase}.json`, { capturedAt: new Date().toISOString(), before, results, after: sourceState() });
for (const [name, result] of Object.entries(results)) console.log(name, result.status,
  result.stdout.split('\n').filter(line => /^# (tests|pass|fail|skipped|cancelled|todo) /u.test(line)).join('; '), result.stderr);
