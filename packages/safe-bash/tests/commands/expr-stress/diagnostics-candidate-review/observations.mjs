import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addEvidence, boundedNative, compare, owned, sha256 } from './replay/review.mjs';
import { containedJob } from './replay/watchdog.mjs';

const stage = JSON.parse(readFileSync(`${owned}/candidate-diagnostics/stage.json`));
const frozenPath = `${owned}/../freeze/independent-native.json`;
const frozen = JSON.parse(readFileSync(frozenPath));
assert.equal(sha256(readFileSync(frozen.identity.actualPath)), frozen.identity.sha256);
const scratch = mkdtempSync(join(tmpdir(), 'expr-diagnostics-execution-native-'));
const native = [], binding = [];
let precedence;
async function virtual(argv) {
  const outer = await containedJob(pathToFileURL(resolve(owned, 'runtime-driver.mjs')).href, { installed: stage.installed, mode: 'native', argv, environment: frozen.environment });
  return { outer, actual: outer.value?.value?.result };
}
try {
  for (const input of frozen.rows) {
    const actual = await boundedNative(frozen.identity.actualPath, input.argv, scratch, frozen.environment, 'expr');
    native.push({ id: input.id, argv: input.argv, expected: input.expected, actual, comparison: compare(input.expected, actual) });
  }
  for (const argv of [[], ['--']]) {
    const literal = await boundedNative(frozen.identity.actualPath, argv, scratch, frozen.environment, 'expr');
    const absolute = await boundedNative(frozen.identity.actualPath, argv, scratch, frozen.environment, frozen.identity.actualPath);
    const candidate = await virtual(argv);
    binding.push({ argv, literalArgv0: 'expr', absoluteArgv0: frozen.identity.actualPath, literal, absolute, ...candidate, literalComparison: compare(literal, candidate.actual), absoluteComparison: compare(absolute, candidate.actual) });
  }
  const argv = ['1', '/', '0', 'x'];
  const expected = await boundedNative(frozen.identity.actualPath, argv, scratch, frozen.environment, 'expr');
  const candidate = await virtual(argv);
  precedence = { argv, expected, ...candidate, comparison: compare(expected, candidate.actual), classification: 'Separate AST-first error-precedence counterexample; not one of requested nine; retained failure, no source fix.' };
  assert.deepEqual(readdirSync(scratch), []);
} finally {
  rmSync(scratch, { recursive: true });
}
addEvidence(`${owned}/additional-observations.json`, { candidate: stage.commit, frozenSha256: sha256(readFileSync(frozenPath)), identity: frozen.identity, environment: frozen.environment, native, binding, precedence, summary: { independentNativeReplayStrict: native.filter(row => row.comparison.strict).length, independentNativeReplayTotal: native.length, bindingLiteralMatches: binding.filter(row => row.literalComparison.strict).length, bindingAbsoluteMatches: binding.filter(row => row.absoluteComparison.strict).length, precedenceStrict: precedence.comparison.strict }, cleanup: { scratch, removed: !existsSync(scratch), nativeCallsAwaited: true, outerTerminationAwaited: [...binding, precedence].every(row => row.outer.terminationAwaited), activeWorkersBeforeSafety: [...binding, precedence].map(row => row.outer.value?.value?.activeBeforeSafetyCleanup) } });
console.log(JSON.stringify({ native: native.length, strict: native.filter(row => row.comparison.strict).length, precedence: { argv: precedence.argv, expected: precedence.expected, actual: precedence.actual, comparison: precedence.comparison } }));
