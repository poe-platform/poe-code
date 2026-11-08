export const flags = Object.freeze(['--unhandled-rejections=strict', '--max-old-space-size=64', '--max-semi-space-size=1', '--stack-size=512']);
export const limits = Object.freeze({ startupMs: 1000, executionMs: 200, cleanupMs: 1000, timerMs: 5, streamBytes: 1024, ipcBytes: 128, ipcCount: 5, riskyTotal: 8 });
const declarations = [
  ['grep-linear-match', 'grep', 'control', '^a+$', 'aaaa', 0, 'aaaa\n'],
  ['grep-linear-nonmatch', 'grep', 'control', '^a+$', 'aaaa!', 1, ''],
  ['rg-linear-match', 'rg', 'control', '^a+$', 'aaaa', 0, 'aaaa\n'],
  ['rg-linear-nonmatch', 'rg', 'control', '^a+$', 'aaaa!', 1, ''],
  ['grep-nested-16', 'grep', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaa!', 1, ''],
  ['grep-nested-20', 'grep', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaa!', 1, ''],
  ['grep-nested-24', 'grep', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaa!', 1, ''],
  ['grep-nested-28', 'grep', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!', 1, ''],
  ['rg-nested-16', 'rg', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaa!', 1, ''],
  ['rg-nested-20', 'rg', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaa!', 1, ''],
  ['rg-nested-24', 'rg', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaa!', 1, ''],
  ['rg-nested-28', 'rg', 'nested', '^(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!', 1, ''],
];
export const cases = Object.freeze(declarations.map(([id, tool, kind, pattern, subject, exitCode, stdout]) => Object.freeze({
  id, tool, kind, pattern, subject, subjectBytes: subject.length,
  repeatedA: kind === 'nested' ? subject.length - 1 : null,
  source: tool === 'grep' ? pattern : `(?:${pattern})`,
  flags: tool === 'grep' ? 'g' : 'gu',
  args: Object.freeze(tool === 'grep' ? ['-E', pattern] : [pattern, '-']),
  expected: Object.freeze({ exitCode, stdout, stderr: '', nativeResult: exitCode === 0 ? 'match' : 'null', calls: 1 }),
})));
export const productFiles = Object.freeze([
  'src/commands/grep.ts', 'src/commands/internal.ts',
  'src/contracts/index.ts', 'src/contracts/command.ts', 'src/contracts/errors.ts',
  'src/contracts/filesystem.ts', 'src/contracts/io.ts', 'src/contracts/path.ts', 'src/contracts/plugin.ts',
  'src/commands/search/rg.ts', 'src/commands/search/matcher.ts', 'src/commands/search/options.ts',
  'src/commands/search/output.ts', 'src/commands/search/shared.ts', 'src/commands/search/walk.ts', 'src/commands/search/glob.ts',
]);
export const sourceFiles = Object.freeze([
  ...productFiles, 'src/commands/README.md', 'src/commands/search/README.md',
  'src/contracts/command.md', 'src/shell/types.ts', 'src/shell/runtime.ts',
  'src/commands/text-programs/regex.ts', 'src/commands/text-programs/shared.ts', 'src/commands/text-programs/README.md',
  'tests/stress/regex-execution/REPORT.md', 'tests/stress/regex-execution/RESEARCH.md', 'tests/stress/regex-execution/SOURCE_MAP.json',
  'tests/stress/regex-execution/staged-controls/supervisor.mjs',
  'tests/stress/regex-execution/staged-controls/README.md', 'tests/stress/regex-execution/staged-controls/REPORT.md',
  'tests/stress/regex-execution/single-grep/fixed-case.mjs', 'tests/stress/regex-execution/single-grep/child.mjs',
  'tests/stress/regex-execution/single-grep/run.mjs', 'tests/stress/regex-execution/single-grep/README.md', 'tests/stress/regex-execution/single-grep/REPORT.md',
  ...['cases.mjs', 'child.mjs', 'run.mjs', 'snapshot.mjs', 'README.md', 'commands.txt'].map(name => `tests/stress/regex-execution/bounded-matrix/${name}`),
]);
