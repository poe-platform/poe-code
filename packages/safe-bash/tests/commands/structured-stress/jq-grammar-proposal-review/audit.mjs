import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const base = 'tests/commands/structured-stress';
const author = `${base}/jq-grammar-author-20260827`;
const read = path => readFileSync(resolve(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const digest = value => createHash('sha256').update(value).digest('hex');
const proposal = json(`${author}/planned-test-only-changes-v2.json`);
const inventory = json(`${base}/jq-grammar-independent/canonical-red-inventory.json`);
const baseline = json(`${base}/jq-42-independent-final/r2-legacy.json`).results.filter(row => row.route === 'direct' && row.transport === 'whole');
const native = json(`${base}/jq-grammar-proposal-review/native-review.json`);
const raw = json(`${base}/raw-input-native.json`).cases;
const originalVectors = ['native-vectors.json', 'supplement-vectors.json'].flatMap(name => json(`${base}/independent-increment/${name}`).cases);
const literal = source => JSON.parse(JSON.stringify(runInNewContext(`(${source})`)));
const hex = value => Buffer.from(value).toString('hex');
const safety = read(`${base}/safety.test.ts`);
const malformed = literal(safety.match(/const malformed = (\[[\s\S]*?\n\]);/u)[1]);
const inputVector = (argv, input, extra = {}) => ({ argv, inputHex: hex(input), files: {}, ...extra });
const signature = vector => JSON.stringify([vector.argv, vector.inputHex, vector.files ?? {}]);
const classified = [];
const mutants = [];
for (const [index, row] of [...proposal.proposal, ...proposal.supplemental].entries()) {
  const proofs = Array.isArray(row.nativeProof) ? row.nativeProof : [row.nativeProof];
  let actual;
  let transports;
  let newName = row.oldTestName;
  if (row.oldTestName.startsWith('strict UTF-8')) {
    const id = row.oldTestName.split(': ')[1];
    const vector = originalVectors.find(vector => vector.id === id);
    actual = [{ argv: vector.argv, inputHex: vector.inputHex, files: {} }];
    transports = { baseline: 1, inclusiveCuts: [0, vector.inputHex.length / 2], emptyMiddleChunk: true, executions: vector.inputHex.length / 2 + 2 };
    newName = `native UTF-8 replacement remains chunk invariant: ${id}`;
  } else if (row.oldTestName.startsWith('raw native:')) {
    const fixture = raw.find(fixture => fixture.id === row.oldTestName.slice(12));
    actual = [{ argv: fixture.argv, inputHex: fixture.inputHex, files: Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex])) }];
    transports = { sizes: [1, 2, 7, 16384], executions: 4, freshMemoryFsEachSize: true, fileArrangement: actual[0].files, preserveAllUnselectedRawFixtures: true };
  } else if (row.oldTestName.startsWith('strict malformed JSON')) {
    const position = Number(row.oldTestName.match(/JSON (\d+)/u)[1]);
    actual = [inputVector(['-c', '.'], malformed[position])];
    transports = { sizes: [1, 2, 5, 64], timeoutMs: 3000, executions: 4, preserveAll23LoopInputs: true };
    newName = `native JSON acceptance ${position} across chunk boundaries`;
  } else if (row.oldTestName === 'invalid UTF-8 never becomes replacement text') {
    const invalid = literal(row.oldAssertion.match(/for \(const invalid of (\[.*\])\)/u)[1]);
    actual = invalid.map(bytes => inputVector(['-c', '.'], Buffer.concat([Buffer.from('{}\n'), Buffer.from(bytes)])));
    transports = { sizes: [1, 2, 64], executions: 15, completedPrefixHex: hex('{}\n') };
    newName = 'invalid UTF-8 JSON tokens preserve prefix and native diagnostics';
  } else if (row.oldTestName.startsWith('malformed UTF-8 preserves')) {
    const suffixes = literal(row.oldAssertion.match(/for \(const suffix of (\[.*\])\)/u)[1]);
    const prefixes = literal(row.oldAssertion.match(/for \(const prefix of (\[.*\])\)/u)[1]);
    actual = suffixes.flatMap(suffix => prefixes.flatMap(prefix => ['-c', '-sc'].map(flag => inputVector([flag, '.'], Buffer.concat([Buffer.from(prefix), Buffer.from(suffix)])))));
    const lengths = actual.filter(vector => vector.argv[0] === '-c').map(vector => vector.inputHex.length / 2);
    transports = { everyInclusiveCutFor18Inputs: lengths.map(length => [0, length]), bytewiseFor18Inputs: true, wholeSlurpFor18Inputs: true, executions: lengths.reduce((total, length) => total + length + 3, 0), exactStderrAlsoRequiredForSingleAndSlurp: true };
  } else {
    const inputArrays = [...row.oldAssertion.matchAll(/for \(const input of (\[.*\])\)/gu)].map(match => literal(match[1]));
    const invalid = literal(row.oldAssertion.match(/for \(const bytes of (\[.*\])\)/u)[1]);
    const division = literal(row.oldAssertion.match(/for \(const filter of (\[.*\])\)/u)[1]);
    const tuples = literal(row.oldAssertion.match(/for \(const \[filter, expected\] of (\[.*\])\)/u)[1]);
    const surrogate = literal(row.oldAssertion.match(/await run\(\["-c", "\."\], ('[^']*')\)/u)[1]);
    actual = [
      ...inputArrays.flatMap(inputs => inputs.map(input => inputVector(['-c', '.'], input))),
      ...invalid.map(bytes => inputVector(['-c', '.'], Buffer.from(bytes))),
      ...[...division, ...tuples.map(tuple => tuple[0])].map(filter => inputVector(['-nc', filter], 'null', { implicitDefaultInput: true })),
      inputVector(['-c', '.'], surrogate),
    ];
    transports = { executions: 29, jsonInputs: 15, invalidByteInputs: 4, divisionFilters: 3, largeDecimalInputs: 3, arithmeticAndConversionFilters: 3, surrogatePair: 1, customQuotaAssertionsInThisTest: 0, retainAdjacentQuotaAndCancellationTestsUnchanged: true };
  }
  assert.equal(actual.length, proofs.length, row.oldTestName);
  const unmatchedProofs = [...proofs];
  const constituents = actual.map(vector => {
    const index = unmatchedProofs.findIndex(proof => signature(proof) === signature(vector) || (vector.implicitDefaultInput && signature(proof) === signature({ ...vector, inputHex: '' })));
    assert.notEqual(index, -1, `Uncovered actual constituent: ${row.oldTestName} ${signature(vector)}`);
    const proof = unmatchedProofs.splice(index, 1)[0];
    const captured = native.results.find(result => result.id === proof.id && result.row === row.oldTestName);
    assert.ok(captured, proof.id);
    assert.equal(captured.matchesFrozen, true, proof.id);
    const mutationPossible = !row.oldTestName.startsWith('strict UTF-8') && proof.expected.stdoutHex.includes('efbfbd');
    if (mutationPossible) {
      const mutated = proof.expected.stdoutHex.replace('efbfbd', '80');
      assert.notEqual(mutated, proof.expected.stdoutHex);
      assert.equal(Buffer.from(mutated, 'hex').toString(), Buffer.from(proof.expected.stdoutHex, 'hex').toString());
      mutants.push({ row: row.oldTestName, id: proof.id, expectedHex: proof.expected.stdoutHex, mutantHex: mutated, proposedDecodedStringAssertionPasses: true, actualByteEqualityPasses: false });
    }
    return { id: proof.id, actualInput: vector, proofInputHex: proof.inputHex, exactLookupMatches: vector.inputHex === proof.inputHex, frozenProofHash: proof.vectorSha256, expected: proof.expected, nativeRoute: captured.route, nativeMatchesFrozen: true, schedules: transports };
  });
  const prior = baseline.filter(result => proofs.some(proof => proof.id === result.id));
  const counts = { probes: prior.length, exact: prior.filter(result => result.pass).length, diagnosticOnly: prior.filter(result => !result.pass && result.differingFields.length === 1 && result.differingFields[0] === 'stderrHex').length, statusOrStdout: prior.filter(result => result.differingFields.some(field => field !== 'stderrHex')).length };
  if (index < 22) {
    assert.deepEqual(counts, row.baseline);
    const independent = inventory.entries.find(entry => entry.name === row.oldTestName);
    assert.deepEqual(proofs.map(proof => proof.id).sort(), [...independent.nativeProbeIds].sort());
  }
  const classification = index >= 22 ? 'newly-exposed-stale-assertion' : actual.length === 29 ? 'resource-mixed-composite' : counts.diagnosticOnly ? 'diagnostic-mixed' : 'stale-policy';
  classified.push({ number: index + 1, oldTestName: row.oldTestName, proposedReviewedName: newName, path: row.oldTestPath, classification, baseline: index < 22 ? counts : 'not part of historical22; do not inflate baseline', oldAssertionSha256: digest(row.oldAssertion), oldAssertionLines: row.oldAssertion.split('\n').length - 1, constituents, retainedSchedules: transports, proposedDeltaStatus: 'REJECT v2 application mechanics; native expectation tuples agree' });
}
const report = { recordedAt: new Date().toISOString(), verdict: 'REJECT v2 as an exact application plan; native expectation values agree', productImported: false, classifications: Object.fromEntries(['stale-policy', 'diagnostic-mixed', 'resource-mixed-composite', 'newly-exposed-stale-assertion'].map(kind => [kind, classified.filter(row => row.classification === kind).length])), rows: classified, byteMutationDemonstrations: mutants, exactLookupMismatches: classified.flatMap(row => row.constituents.filter(vector => !vector.exactLookupMatches).map(vector => ({ row: row.number, id: vector.id, actualInputHex: vector.actualInput.inputHex, proofInputHex: vector.proofInputHex }))), limits: 'Static canonical literal extraction plus native-only evidence. No source acceptance or canonical edits. Native source chunks are not controlled by OS pipe writes.' };
assert.deepEqual(Object.values(report.classifications), [19, 2, 1, 4]);
const target = 'tests/commands/structured-stress/jq-grammar-proposal-review/audit.json';
assert.ok(!existsSync(resolve(root, target)));
const patch = `*** Begin Patch\n*** Add File: ${target}\n${JSON.stringify(report, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
console.log(JSON.stringify({ rows: classified.length, classifications: report.classifications, originalScheduledExecutions: classified.reduce((total, row) => total + row.retainedSchedules.executions, 0), byteBlindMutants: mutants.length, lookupMismatches: report.exactLookupMismatches.length }));
