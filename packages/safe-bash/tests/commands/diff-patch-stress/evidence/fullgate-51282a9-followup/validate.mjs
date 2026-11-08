import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { command, directory, hash, save, sourceState } from './capture.mjs';

const canonical = [
  'tests/commands/diff-patch-stress/fuzz/edits.test.ts',
  'tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts',
  'tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts',
];
const matcher = [
  'tests/commands/diff-patch/patch-gnu-coordinates.test.ts',
  'tests/commands/diff-patch/patch-hunk-diagnostics-followup.test.ts',
  'tests/commands/diff-patch/hunk-regressions.test.ts',
  'tests/commands/diff-patch/patch-gnu-publication.test.ts',
  'tests/commands/diff-patch-stress/fuzz/properties.test.ts',
  'tests/commands/diff-patch-stress/gnu-target/edit-correctness.test.ts',
];
const paths = [...canonical, ...matcher, 'tests/commands/diff-patch-stress/emptyfile-delta/helpers.ts'];
const baseline = 'ee4eed6081d12d522aeca959c07cbee1597b658c';
const unchanged = Object.fromEntries(paths.map(path => {
  const original = command('git', ['show', `${baseline}:${path}`]);
  assert.equal(original.status, 0);
  const sha256 = hash(readFileSync(path));
  assert.equal(sha256, hash(Buffer.from(original.stdoutHex, 'hex')), path);
  return [path, sha256];
}));
const before = sourceState();
const flags = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap'];
const results = {};
for (const [name, args] of Object.entries({
  regressions: [...flags, 'tests/commands/diff-patch-stress/fuzz/repeated-match.test.ts'],
  canonical: [...flags, ...canonical],
  matcher: [...flags, ...matcher],
  types: ['node_modules/typescript/bin/tsc', '--noEmit', '-p', `${directory}/tsconfig.json`],
  build: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', `${directory}/.build`],
})) {
  results[name] = command(process.execPath, args);
  console.log(name, results[name].status, results[name].stdout.match(/^# (tests|pass|fail|skipped|cancelled|todo) .*$/gm)?.join('; ') ?? results[name].stdout.slice(-1000));
  save(`${directory}/validation-${name}.json`, { before, unchanged, result: results[name], after: sourceState() });
}
for (const [path, sha256] of Object.entries(unchanged)) assert.equal(hash(readFileSync(path)), sha256, path);
if (Object.values(results).some(result => result.status !== 0)) process.exitCode = 1;
