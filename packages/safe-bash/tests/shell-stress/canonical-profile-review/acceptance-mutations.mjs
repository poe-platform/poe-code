import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from './support.mjs';

export async function mutations({ archive, run, testArgs, original }) {
  const differential = 'tests/shell-stress/differential.test.ts';
  const closure = 'tests/shell-stress/invocation-closure/holdout.test.ts';
  const discovery = 'tests/shell/invocation-discovery-fixes.test.ts';
  const gaps = 'tests/shell-stress/current-gaps/compatibility.test.ts';
  const helper = 'tests/shell-stress/helpers.ts';
  const migration = 'tests/shell-stress/canonical-profile-migration/';
  const first = 'descriptor-save-and-restore-routes-stderr-through-pipe';
  const fatal = 'fatal-parameter-expansion-prevents-following-file-effect';
  const exact = name => `^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`;
  const args = (file, name) => {
    const values = testArgs([file]);
    values.splice(values.length - 1, 0, `--test-name-pattern=${exact(name)}`);
    return values;
  };
  const selections = { diff: `GNU5.3 declared-profile differential: ${first}`, diagnostic: `GNU5.3 declared-profile differential: ${fatal}`, label: 'closure safeplugin: query-V-verbose', gaps: 'remaining-gap GNU5.3 declared profile: move-output-really-closes-source', discovery: 'GNU-5.3/bash/unknown-z' };
  for (const [label, file, name] of [['diff', differential, selections.diff], ['registry', closure, selections.label]]) {
    const result = await run(`positive-${label}`, args(file, name), { mutation: { kind: 'positive', selectedName: name, laboratoryOnly: true } });
    assert.equal(result.counts.pass, 1);
    assert.equal(result.counts.fail, 0);
  }
  const insertObservation = (text, name, statement) => text.replace('  assert.ok("exitCode" in result);\n  return result;', `  assert.ok("exitCode" in result);\n  if (fixture.name === ${JSON.stringify(name)}) { ${statement} }\n  return result;`);
  const specs = [
    { id: 'status-only-corruption', file: helper, root: differential, name: selections.diff, change: text => insertObservation(text, first, 'result.exitCode += 1;') },
    { id: 'stdout-exact-byte-corruption', file: helper, root: differential, name: selections.diff, change: text => insertObservation(text, first, 'result.stdoutBase64 = "AA==";') },
    { id: 'stderr-discard-same-status', file: helper, root: differential, name: selections.diagnostic, change: text => insertObservation(text, fatal, 'result.stderr = ""; result.stderrBase64 = "";') },
    { id: 'file-byte-corruption', file: helper, root: differential, name: selections.diff, change: text => insertObservation(text, first, 'result.files["out"] = { type: "file", base64: "AA==" };') },
    { id: 'gap-diagnostic-corruption', file: helper, root: gaps, name: selections.gaps, change: text => insertObservation(text, 'move-output-really-closes-source', 'result.stderrBase64 = "AA==";') },
    { id: 'fixture-source-identity', file: 'tests/shell-stress/cases.ts', root: differential, name: selections.diff, change: text => text + '\nvoid 0;\n' },
    { id: 'profile-identity', file: `${migration}primary-fixtures.json`, root: differential, name: selections.diff, change: text => text.replace('GNU5.3-primary', 'Bash3.2-historical') },
    { id: 'invocation-name-identity', file: `${migration}primary-fixtures.json`, root: differential, name: selections.diff, change: text => text.replace('"invocationName": "shell"', '"invocationName": "shell-stress"') },
    { id: 'mass-golden-rewrite', file: `${migration}native.json`, root: differential, name: selections.diff, change: text => { const data = JSON.parse(text); for (const row of data.rows) { row.stderrHex = ''; row.status = 0; } return JSON.stringify(data); } },
    { id: 'registry-native-label-spoof', file: closure, root: closure, name: selections.label, change: text => text.replace('  assert.equal(actual.error, undefined);', '  actual.stdoutHex = Buffer.from(Buffer.from(actual.stdoutHex, "hex").toString().replace("registered command", "shell builtin")).toString("hex");\n  assert.equal(actual.error, undefined);') },
    { id: 'registry-stderr-byte-corruption', file: closure, root: closure, name: selections.label, change: text => text.replace('  assert.equal(actual.error, undefined);', '  actual.stderrHex = "00";\n  assert.equal(actual.error, undefined);') },
    { id: 'discovery-stderr-byte-corruption', file: discovery, root: discovery, name: selections.discovery, change: text => text.replace('  assert.deepEqual({ stdoutHex:', '  row.result.stderrHex = "00";\n  assert.deepEqual({ stdoutHex:') },
  ];
  for (const specimen of specs) {
    const path = resolve(archive, specimen.file);
    const before = await readFile(path);
    assert.equal(sha256(before), original[path]);
    const changed = Buffer.from(specimen.change(before.toString()));
    assert.notDeepEqual(changed, before, specimen.id);
    await writeFile(path, changed);
    try {
      const result = await run(`mutant-${specimen.id}`, args(specimen.root, specimen.name), { expectedStatus: 1, mutation: { kind: 'candidate-assertion-laboratory', selectedName: specimen.name, path: specimen.file, originalSha256: sha256(before), mutatedSha256: sha256(changed), originalText: before.toString(), mutatedText: changed.toString(), laboratoryOnly: true, scope: 'Name-filtered test or import-guard rejection, not a whole-cohort denominator. Original assertion code retained except explicit observation/expected input injection.' } });
      assert.equal(result.counts.fail, 1, specimen.id);
      const stdout = Buffer.from(result.result.stdout, 'base64').toString();
      assert.match(stdout, /AssertionError|ERR_ASSERTION/u, specimen.id);
      assert.doesNotMatch(stdout, /SyntaxError|ERR_MODULE_NOT_FOUND|Independent archive import identity rejected/u, specimen.id);
    } finally { await writeFile(path, before); }
  }
}
