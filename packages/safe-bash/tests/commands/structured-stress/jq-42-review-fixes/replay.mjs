import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { bytesResult, sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { loadEvidence, transports } from '../jq-42-independent-review/evidence.mjs';
import { loadPublicHarness, chunks, collector, quote } from '../jq-42-independent-review/harness.ts';

const [name, cohort] = process.argv.slice(2);
assert.ok(name);
const evidence = loadEvidence();
const vectors = cohort === 'legacy' ? JSON.parse(readFileSync(new URL('../jq-42-independent-review/legacy-native-proof.json', import.meta.url))).probes
  : cohort === 'nearby-built' ? JSON.parse(readFileSync(new URL('./native-frozen.json', import.meta.url))).cases : evidence.vectors;
const before = sourceSnapshot();
let execute = await loadPublicHarness();
if (cohort === 'nearby-built' || cohort === 'legacy') {
  const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = await import(cohort === 'nearby-built' ? '../../../../dist/index.js' : '../../../../src/index.ts');
  execute = async (vector, route, transport) => {
    const fs = new MemoryFileSystem();
    for (const [path, hex] of Object.entries(vector.files ?? {})) await fs.writeFile(`/${path}`, Buffer.from(hex, 'hex'));
    const stdout = collector();
    const stderr = collector();
    const stdin = chunks(Buffer.from(vector.inputHex, 'hex'), transport);
    const signal = AbortSignal.timeout(1500);
    const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
    const result = route === 'shell'
      ? await new Shell({ fs, cwd: '/', env: {}, limits: { maxOutputBytes: 65536 } }).use(structuredCommands(options)).exec(['jq', ...vector.argv.map(quote)].join(' '), { stdin, stdout: stdout.sink, stderr: stderr.sink, signal })
      : await createStructuredCommands(options).find(command => command.name === 'jq').execute({ command: 'jq', args: vector.argv, fs, cwd: '/', env: {}, stdin, stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal });
    return { actual: { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() } };
  };
}
const results = [];
for (const vector of vectors) for (const route of cohort === 'nearby-built' ? ['built-direct'] : ['direct', 'shell']) {
  for (const transport of cohort === 'legacy' ? ['whole', 'bytewise'] : transports(vector)) {
    const { actual, stages } = await execute(vector, route, transport);
    const differingFields = ['status', 'stdoutHex', 'stderrHex'].filter(field => actual[field] !== vector.expected[field]);
    const stageDifferences = stages?.flatMap((stage, index) => JSON.stringify(stage) === JSON.stringify(bytesResult(vector.stages[index].expected)) ? [] : [index]) ?? [];
    results.push({ id: vector.id, cohort: vector.cohort ?? vector.group, argv: vector.argv, inputHex: vector.inputHex, original42: evidence.original.has(`${vector.cohort}:${vector.id}`), route, transport, expected: bytesResult(vector.expected), actual, ...(stages ? { stages } : {}), differingFields, stageDifferences, pass: differingFields.length === 0 && stageDifferences.length === 0 });
  }
}
const summarize = rows => ({ vectors: new Set(rows.map(row => row.id)).size, vectorsPass: new Set(rows.map(row => row.id)).size - new Set(rows.filter(row => !row.pass).map(row => row.id)).size, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length });
const after = sourceSnapshot();
const summary = { total: summarize(results), original42: summarize(results.filter(row => row.original42)), cohorts: Object.fromEntries([...new Set(results.map(row => row.cohort))].map(cohort => [cohort, summarize(results.filter(row => row.cohort === cohort))])) };
artifact(`${name}.json`, { role: 'fix author, not independent verification', recordedAt: new Date().toISOString(), before, after, structuredStable: before.structuredSha256 === after.structuredSha256, productStable: before.productSha256 === after.productSha256, summary, results });
console.log(JSON.stringify(summary, null, 2));
process.exitCode = results.some(row => !row.pass) ? 1 : 0;
