import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bytesResult, digest, sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { loadEvidence, manifestSha256, transports } from '../jq-42-independent-review/evidence.mjs';
import { chunks, collector, loadPublicHarness, quote } from '../jq-42-independent-review/harness.ts';
import { artifact } from './artifacts.mjs';

const [mode, output] = process.argv.slice(2);
assert.ok(['main', 'legacy'].includes(mode));
assert.ok(output);
const before = sourceSnapshot();
assert.equal(before.structuredSha256, '30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f');
const evidence = loadEvidence();
const legacyBytes = readFileSync(new URL('../jq-42-independent-review/legacy-native-proof.json', import.meta.url));
const legacy = JSON.parse(legacyBytes);
const vectors = mode === 'main' ? evidence.vectors : legacy.probes.map(probe => ({ ...probe, cohort: 'legacy' }));
const publicExecute = await loadPublicHarness();
const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = mode === 'legacy' ? await import('../../../../src/index.ts') : {};
async function legacyExecute(probe, route, transport) {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(probe.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(hex, 'hex'));
  const stdout = collector();
  const stderr = collector();
  const stdin = chunks(Buffer.from(probe.inputHex, 'hex'), transport);
  const signal = AbortSignal.timeout(1500);
  const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
  const result = route === 'direct'
    ? await createStructuredCommands(options).find(command => command.name === 'jq').execute({ command: 'jq', args: probe.argv, fs, cwd: '/', env: {}, stdin, stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal })
    : await new Shell({ fs, cwd: '/', env: {}, limits: { maxOutputBytes: 65536 } }).use(structuredCommands(options)).exec(['jq', ...probe.argv.map(quote)].join(' '), { stdin, stdout: stdout.sink, stderr: stderr.sink, signal });
  return { actual: { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() } };
}
const execute = mode === 'main' ? publicExecute : legacyExecute;
const results = [];
for (const vector of vectors) for (const route of ['direct', 'shell']) {
  for (const transport of mode === 'main' ? transports(vector) : ['whole', 'bytewise']) {
    const row = { id: vector.id, cohort: vector.cohort, route, transport,
      original42: evidence.original.has(`${vector.cohort}:${vector.id}`),
      argv: vector.argv, inputHex: vector.inputHex, files: vector.files,
      assertion: vector.assertion, group: vector.group, expected: bytesResult(vector.expected) };
    try {
      const { actual, stages } = await execute(vector, route, transport);
      const differingFields = ['status', 'stdoutHex', 'stderrHex'].filter(field => actual[field] !== row.expected[field]);
      const expectedStages = vector.stages?.map(stage => bytesResult(stage.expected));
      const stageDifferences = stages?.flatMap((stage, index) => JSON.stringify(stage) === JSON.stringify(expectedStages[index]) ? [] : [index]) ?? [];
      const stageCountMatches = !expectedStages || route === 'shell' || stages?.length === expectedStages.length;
      results.push({ ...row, actual, actualStages: stages, expectedStages, differingFields, stageDifferences, stageCountMatches,
        pass: differingFields.length === 0 && stageDifferences.length === 0 && stageCountMatches });
    } catch (error) {
      results.push({ ...row, pass: false, error: error?.stack ?? String(error) });
    }
  }
}
const summarize = rows => {
  const unique = new Set(rows.map(row => `${row.cohort}:${row.id}`));
  const failing = new Set(rows.filter(row => !row.pass).map(row => `${row.cohort}:${row.id}`));
  return { vectors: unique.size, vectorsPassingAll: unique.size - failing.size, executions: rows.length,
    pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length };
};
const summary = { total: summarize(results), original42: summarize(results.filter(row => row.original42)),
  historical155: summarize(results.filter(row => row.cohort === 'independent')),
  historical81: summarize(results.filter(row => row.cohort === 'additive')),
  reviewer20: summarize(results.filter(row => row.cohort === 'reviewer')),
  reviewerChunkSubset: summarize(results.filter(row => row.cohort === 'reviewer' && evidence.independent.find(vector => vector.id === row.id).allBoundaries)),
  routes: Object.fromEntries(['direct', 'shell'].map(route => [route, summarize(results.filter(row => row.route === route))])),
  stages: { executions: results.reduce((sum, row) => sum + (row.actualStages?.length ?? 0), 0),
    failures: results.reduce((sum, row) => sum + (row.stageDifferences?.length ?? 0), 0) } };
if (mode === 'legacy') {
  const representative = results.filter(row => row.route === 'direct' && row.transport === 'whole');
  summary.legacy = { exact: representative.filter(row => row.pass).length,
    diagnosticOnly: representative.filter(row => !row.pass && row.differingFields?.length === 1 && row.differingFields[0] === 'stderrHex').length,
    statusOrStdout: representative.filter(row => row.differingFields?.some(field => field !== 'stderrHex')).length };
  summary.legacy.routeTransportAgreement = representative.every(row => results.filter(peer => peer.id === row.id).every(peer => JSON.stringify(peer.actual) === JSON.stringify(row.actual)));
}
const after = sourceSnapshot();
const stable = before.productSha256 === after.productSha256 && JSON.stringify(before.tooling) === JSON.stringify(after.tooling);
artifact(output, { role: 'fresh independent final verifier; frozen expectations only', mode, recordedAt: new Date().toISOString(),
  manifestSha256, legacyNativeSha256: digest(legacyBytes), before, after, stable, summary, results,
  limits: 'No native recapture or expected changes. Original42/chunk/stage counts are subsets, not extra cases. Direct pipelines assert every stage; public shell asserts final status and exact byte sinks, not cross-process stderr timing. Pre/post hashes cannot exclude transient ABA edits.' });
console.log(JSON.stringify({ mode, stable, summary }, null, 2));
process.exitCode = !stable ? 2 : results.some(row => !row.pass) ? 1 : 0;
