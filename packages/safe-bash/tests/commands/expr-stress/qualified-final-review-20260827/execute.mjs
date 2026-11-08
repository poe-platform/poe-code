import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, command, save, hash } from './prepare.mjs';

const provenance = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const { source, installed, candidate } = provenance;
const stress = join(source, 'tests/commands/expr-stress');
const sequencing = join(stress, 'sequencing-design-20260827');
const execution = command('sequencing-unchanged', process.execPath, [join(sequencing, 'driver.mjs'), installed, join(sequencing, 'freeze/cases.json')], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', NODE_OPTIONS: '', NODE_PATH: '' } });
assert.equal(execution.status, 0, execution.stderr);
const sequence = JSON.parse(execution.stdout);
const remaining = sequence.cases.filter(row => !row.passed);
save('sequencing-summary.json', { total: sequence.cases.length, pass: sequence.cases.length - remaining.length, failed: remaining, shell: sequence.shell, oldCap: sequence.oldCap, activeWorkers: sequence.activeWorkers, unchangedDriverSha256: hash(readFileSync(join(sequencing, 'driver.mjs'))) });
const issue = ['/tmp/expr-qualified-final-review-20260827-issue.txt', `Candidate ${candidate}\nActual compiled installed source, no repeat overlay.\nEncounter-order REDs: ${remaining.length}\n${remaining.map(row => JSON.stringify({ id: row.id, input: JSON.parse(readFileSync(join(sequencing, 'freeze/cases.json'))).cases.find(input => input.id === row.id).args, actual: row.observed, expected: row.expected, source: 'src/commands/expr/index.ts:35 parse completes before evaluate; src/commands/expr/syntax.ts' })).join('\n')}\nSeparate frozen syntax-output-one: ${JSON.stringify(sequence.oldCap)}\n`];
writeFileSync(...issue);
console.log(JSON.stringify({ sequencing: sequence.cases.length, passed: sequence.cases.length - remaining.length, remaining: remaining.length, issue: issue[0] }));

const diagnostic = join(stress, 'diagnostics-candidate-review');
const { containedJob } = await import(pathToFileURL(join(diagnostic, 'replay/watchdog.mjs')));
const runtime = JSON.parse(readFileSync(join(diagnostic, 'freeze/runtime-binding.json')));
const controls = [];
for (const input of runtime.cases) {
  const outer = await containedJob(pathToFileURL(join(diagnostic, 'runtime-driver.mjs')).href, { installed, input });
  const actual = outer.value?.value;
  let passed = Boolean(actual && actual.activeBeforeSafetyCleanup === 0 && !actual.events.includes('workerStart'));
  const stdout = actual && Buffer.from(actual.stdoutBase64, 'base64').toString();
  const stderr = actual && Buffer.from(actual.stderrBase64, 'base64').toString();
  if (input.preabort) passed &&= actual.rejected && actual.exactReasonIdentity && stdout === '' && stderr === '';
  else if (input.expectedError) passed &&= actual.rejected && actual.error?.name === 'RangeError' && actual.error?.message === input.expectedError && stdout === '' && stderr === '';
  else if (input.id === 'literal-command-binding') passed &&= actual.status === 2 && stderr === "expr: syntax error: unexpected argument 'x'\n" && stdout === '';
  else { passed &&= actual.status === input.expectedStatus && stderr === input.expectedStderr; passed &&= input.stdoutPrefix ? stdout.startsWith(input.stdoutPrefix) : stdout === ''; }
  controls.push({ id: input.id, input, actual, passed, outer });
}
save('diagnostics-runtime12.json', { candidate, controls, passed: controls.filter(row => row.passed).length, total: controls.length, qualification: 'Unchanged frozen inputs and assertions; no relabeling the output cap RED.' });
const nine = JSON.parse(readFileSync(join(diagnostic, 'freeze/nine-unchanged.json')));
const rows = [];
for (const input of nine) {
  const outer = await containedJob(pathToFileURL(join(diagnostic, 'replay/runtime-driver.mjs')).href, { installed, mode: 'native', argv: input.argv, environment: { LC_ALL: 'C', LANG: 'C', PATH: '/usr/bin:/bin' } });
  const actual = outer.value?.value;
  const passed = actual && ['status', 'stdoutBase64', 'stderrBase64'].every(key => actual.result[key] === input.expected[key]) && actual.activeBeforeSafetyCleanup === 0;
  rows.push({ input, actual, outer, passed });
}
save('diagnostics-nine.json', { candidate, rows, passed: rows.filter(row => row.passed).length, total: rows.length });
console.log(JSON.stringify({ runtime: controls.filter(row => row.passed).length, runtimeTotal: controls.length, nine: rows.filter(row => row.passed).length }));
