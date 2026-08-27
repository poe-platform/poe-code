import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = await readFile(join(directory, 'original-run.mjs'), 'utf8');
const derived = await readFile(join(directory, 'derived/run.mjs'), 'utf8');
const oldLine = "    if (entry.id === 'N18') assert.match(text, /level|depth|invalid|positive|greater/iu);";
const newLine = "    if (entry.id === 'N18') assertPositiveDepthFailure({ exitCode: outcome.result.exitCode, stdout: run.stdout.bytes(), stderr: run.stderr.bytes() });";
const importLine = "import { assertPositiveDepthFailure } from '../n18-predicate.mjs';";
assert.equal(derived.replace(`${importLine}\n`, '').replace(newLine, oldLine), original);
const lines = original.split('\n');
const target = lines.indexOf(oldLine);
assert.ok(target > 2);
const difference = [
  '--- original/run.mjs', '+++ derived/run.mjs', '@@ -1,3 +1,4 @@',
  ` ${lines[0]}`, `+${importLine}`, ` ${lines[1]}`, ` ${lines[2]}`,
  `@@ -${target - 1},5 +${target},5 @@`,
  ...lines.slice(target - 2, target + 3).flatMap((line) => line === oldLine ? [`-${oldLine}`, `+${newLine}`] : [` ${line}`]), '',
].join('\n');
await writeFile(join(directory, 'runner.diff'), difference, { flag: 'wx' });
const files = {};
for (const name of ['original-run.mjs', 'derived/run.mjs', 'derived/corpus.mjs', 'derived/fixture-fs.mjs', 'derived/native.json', 'n18-predicate.mjs', 'predicate.test.mjs', 'selfchecks.tap', 'bridge.mjs', 'profile.json', 'runner.diff']) {
  files[name] = hash(await readFile(join(directory, name)));
}
const declaration = {
  declaredBeforeInvocationAt: new Date().toISOString(), candidate: 'e2d1b9230f4304650651572395523ca9d1644e74',
  frozenSourceManifestSha256: '81eddab7060fcc67dfcf5adc325218b886a4fb50d7e40a1056ad9fe379e83a9a',
  originalPresealPayload: 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937', files,
  authorization: 'Root authorizes only additive N18 semantic-predicate correction plus EXACTLY ONE corrected N18 invocation and bounded nonproduct checks; no other 37 cases/native calls/source fixes.',
  contract: 'Require a valid nonzero command status, empty normal stdout and bounded meaningful stderr. Identify case-sensitive -L or case-insensitive level/depth and a positive constraint: must/shall be positive; greater than a nonnegative integer; at least a positive integer; ordered inclusive bounds whose endpoints are positive; or an explicit valid/allowed/expected/required positive range. Reject zero-inclusive, reversed, fractional, unsafe and contradictory recognized bounds.',
  preservation: 'Original shared nonzero and nonempty diagnostic checks remain byte-identical. The N18 helper explicitly checks empty stdout, retaining the original/native error-output expectation. No other predicate or corpus/native bytes change.',
  justification: 'Candidate README predeclares positive -L depth and status2 usage errors; the original native fixture also specifies a positive bound. The original word-list regex rejects a meaningful range diagnostic. This corrects that harness defect without requiring one complete diagnostic string or accepting any nonempty error.',
  limits: 'Deliberately bounded English diagnostic forms, not a universal parser for every language or wording. No native-exact status/diagnostic normalization. Original status1 versus candidate usage2 remains a native mismatch.',
  originalResultStatus: 'fail, retained byte-exact', expectedFreshInvocations: 1, reusedOtherSelections: 37,
  selfchecks: { total: 31, positiveExamples: 8, rejectionCounterchecks: 22, exactDerivation: 1, passed: 31, failed: 0, productCalls: 0, nativeCalls: 0 },
};
await writeFile(join(directory, 'derivation.json'), `${JSON.stringify(declaration, null, 2)}\n`, { flag: 'wx' });
for (const name of Object.keys(files)) await chmod(join(directory, name), 0o444);
console.log(JSON.stringify({ newPredicateSha256: files['n18-predicate.mjs'], derivedRunnerSha256: files['derived/run.mjs'], exactDiffSha256: files['runner.diff'], productCalls: 0 }));
