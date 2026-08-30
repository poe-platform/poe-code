import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditRows, runInstrumented } from './run-audit.mjs';
import { replaceOne } from './instrument.mjs';
import { directory, git, json } from './harness.mjs';

const candidate = JSON.parse(readFileSync(join(directory, 'candidate-preparation/prepared.json')));
const original = git(candidate.commit, 'src/commands/text.ts').toString();
const select = names => auditRows.filter(row => names.includes(row.id));
const mutants = [
  { name: 'wrong-key', rows: ['inherited-numeric', 'exact-integers-above-double'], mutate: source => replaceOne(source, 'const bytes = keyBytes(record, numericKey, separator, false);', 'const bytes = record;') },
  { name: 'modifier-direction', rows: ['local-numeric-replaces-global-reverse', 'local-reverse-end-flags'], mutate: source => replaceOne(source, 'return numericKeyFlags.has("r") ? -result : result;', 'return parsed.flags.has("r") ? -result : result;') },
  { name: 'modifier-merge', rows: ['local-replaces-global-numeric', 'local-numeric-replaces-global-reverse'], mutate: source => replaceOne(source, 'const numericKeyFlags = numericKey?.flags.size ? numericKey.flags : parsed.flags;', 'const numericKeyFlags = new Set([...parsed.flags, ...(numericKey?.flags ?? [])]);') },
  { name: 'double-precision', rows: ['exact-integers-above-double', 'exact-fractions-and-prefix-grammar'], mutate: source => replaceOne(source, 'function compareNumericValues(first: NumericValue, second: NumericValue): number {', 'function compareNumericValues(first: NumericValue, second: NumericValue): number { return Number((first.negative ? "-" : "") + first.whole + "." + first.fraction) - Number((second.negative ? "-" : "") + second.whole + "." + second.fraction);') },
  { name: 'guard-multiple', rows: ['guard-multiple-keys'], mutate: source => replaceOne(source, 'keys.length === 1 ? keys[0] : undefined', 'keys.length >= 1 ? keys[0] : undefined') },
  { name: 'guard-nonnumeric', rows: ['guard-nonnumeric-local', 'local-replaces-global-numeric'], mutate: source => replaceOne(source, 'numericKey && numericKeyFlags.has("n") &&', 'numericKey &&') },
  { name: 'guard-transforms', rows: ['whitespace-blanks-transform', 'guard-numeric-fold-transform'], mutate: source => replaceOne(source, ' && !["b", "f"].some(flag => numericKeyFlags.has(flag))', '') },
  { name: 'guard-check', rows: ['guard-check-disorder'], mutate: source => replaceOne(source, ' && !parsed.flags.has("c")) {\n        keyAuditCount("keyedConstructions")', ') {\n        keyAuditCount("keyedConstructions")') },
  { name: 'entry-cap', rows: ['entry-above', 'empty-keys-entry-cap'], mutate: source => replaceOne(source, 'if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes)', 'if (charge > 1_048_576 - retainedKeyBytes)') },
  { name: 'retained-cap', rows: ['retained-above', 'oversized-extracted-small-prefix'], mutate: source => replaceOne(source, 'if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes)', 'if (keyedNumericValues.size >= 16_384)') },
  { name: 'normalized-prefix-charge', rows: ['retained-at', 'oversized-extracted-small-prefix'], mutate: source => replaceOne(source, 'const bytes = keyBytes(record, numericKey, separator, false);\n          const charge = 6 * bytes.length + 2;', 'const bytes = keyBytes(record, numericKey, separator, false);\n          const charge = 6 * Math.min(bytes.length, 1) + 2;') },
  { name: 'fallback-value', rows: ['entry-above', 'oversized-extracted-small-prefix'], mutate: source => replaceOne(source, 'keyAuditCount("byteFallback"); return parseNumeric(bytes);', 'keyAuditCount("byteFallback"); return { whole: "0", fraction: "", negative: false };') },
  { name: 'borrowed-complete-view', rows: ['borrowed-offset-finalizer-nul'], mutate: source => replaceOne(source, 'else accept(new Uint8Array(part));', 'else accept(part);') },
  { name: 'borrowed-pending-view', rows: ['borrowed-offset-finalizer-newline'], mutate: source => replaceOne(source, 'pending.push(new Uint8Array(chunk.subarray(start)));', 'pending.push(chunk.subarray(start));') },
];
const results = [];
for (const mutant of mutants) {
  const result = await runInstrumented(candidate, 'mutant-' + mutant.name, original, mutant.mutate, select(mutant.rows));
  const killed = result.metadata.child.failed > 0 || result.metadata.counterFailures.length > 0;
  const row = { name: mutant.name, cases: mutant.rows, killed, semanticFailures: result.metadata.child.failed, counterFailures: result.metadata.counterFailures, childClosed: result.metadata.child.exactChildClosed, timedOut: result.metadata.child.killed !== null };
  results.push(row);
  console.log(JSON.stringify(row));
}
json(join(directory, 'mutation-summary.json'), results);
assert.ok(results.every(row => row.killed && !row.timedOut));
