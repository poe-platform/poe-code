export const fixedCase = Object.freeze({
  pattern: '^(a+)+$',
  subject: 'aaaaaaaaaaaa!',
  flags: 'g',
  expectedNativeResult: null,
  expectedExitCode: 1,
  expectedStdout: '',
  expectedStderr: '',
  childDeadlineMs: 5,
});

export const productFiles = Object.freeze([
  'commands/grep.ts',
  'commands/internal.ts',
  'contracts/index.ts',
  'contracts/command.ts',
  'contracts/errors.ts',
  'contracts/filesystem.ts',
  'contracts/io.ts',
  'contracts/path.ts',
  'contracts/plugin.ts',
]);
