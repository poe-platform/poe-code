import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const replay = 'benchmarks/reports/current-integration/comparison-replay-20260827';
const read = filename => JSON.parse(fs.readFileSync(filename));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const profiles = read(`${replay}/profiles.json`);
const sealed = read(`${replay}/frozen-files.json`);
const freeze = '/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product';
const checks = [];
for (const [name, profile] of Object.entries(profiles)) {
  const filename = `${profile.harness}/engine.mjs`;
  const bytes = fs.readFileSync(filename), text = bytes.toString('utf8');
  const canonical = execFileSync('git', ['show', `${profile.revision}:benchmarks/expanded/engine.mjs`]);
  assert.equal(hash(bytes), hash(canonical));
  assert.equal(hash(bytes), sealed[`profiles/${name}/benchmarks/expanded/engine.mjs`].sha256);
  const baselineStart = text.indexOf('shell = new library.Bash('), baselineEnd = text.indexOf('dispose = async () => {};', baselineStart);
  assert.ok(baselineStart > 0 && baselineEnd > baselineStart);
  const baselineSetup = text.slice(baselineStart, baselineEnd + 'dispose = async () => {};'.length);
  assert.ok(!/customCommands|defineCommand|registerCommand/.test(baselineSetup));
  assert.ok(baselineSetup.includes('return definition.execute(...args);'));
  assert.ok(text.includes('library = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href);'));
  assert.ok(text.indexOf('process.send?.({ ready: true })') > text.indexOf('library = await import'));
  checks.push({ profile: name, revision: profile.revision, path: filename, engineSha256: hash(bytes), identicalToGitAndSeal: true, entry: 'baselineRoot/dist/bundle/index.js', constructorAndInvocationExcerpt: baselineSetup, customCommandDefinitionsSupplied: false, registryInstrumentation: 'For each real shell.commands entry, replace with shallow spread plus execute wrapper recording name/argv and immediately returning original definition.execute(...args). No alternate command body or extra command name is injected.', readyInterpretation: 'ready:true is emitted only after awaited entry import resolves. Historical parent readiness is control-flow-inferred from outcomes, not a retained ready/PID/request trace; a future approved subset can log this directly.', optionalNetwork: 'Explicit baseline Bash network configuration only on specimen.network; no default ambient network enablement.' });
}
const helperNames = ['audit/phase.mjs', 'audit/preload.mjs', 'audit/loader.mjs'];
const helperHashes = helperNames.map(filename => {
  const bytes = fs.readFileSync(path.join(freeze, filename));
  assert.equal(hash(bytes), sealed[filename].sha256);
  return { path: filename, sha256: hash(bytes), identicalToSeal: true };
});
const loaderText = fs.readFileSync(path.join(freeze, 'audit/loader.mjs'), 'utf8');
assert.ok(loaderText.indexOf('appendFileSync') < loaderText.indexOf('return nextLoad(url, context)'));
write('setup-review.json', { checkedAt: new Date().toISOString(), method: 'Static exact frozen setup review only, no package imported/executed by this script.', profiles: checks, orchestrationHelpers: helperHashes, priorTraceSemantics: 'module-load is written before nextLoad and means a hash/path load attempt. It cannot prove successful evaluation of every module. IPC response ids lack historical PID/recipe request association. CAPTURE-LIMITS.md remains authoritative; no retrospective event ledger invented.', noStubClaim: 'All955 published package paths/bytes equal frozen installed baseline, so no locally modified/replaced package file relative to fetched official artifact. Exact measured engine setup supplies no custom commands; its known forwarding-only observation wrappers remain disclosed. This does not deny diagnostic stubs that the upstream published package itself intentionally contains.', externalDependencyLimit: 'Transitive package code could affect behavior; this task verifies their retained tree/locks, not all publisher archives or absence of upstream bugs.' });
const ids = ['command/echo/multiple', 'composition/archive-hash/archive-hash', 'command/cat/binary-stdin', 'network/curl/get', 'network/curl/output', 'kernel/type/type', 'command/patch/dry-run'];
const selections = ids.map(id => ({ profile: 'original', id })).concat([{ profile: 'scratch-aligned', id: 'command/patch/dry-run' }]);
const rows = selections.map(({ profile, id }, index) => {
  const corpus = read(`${replay}/${profile}/case-inputs.json`);
  const functional = read(`${replay}/${profile}/functional.json`);
  const recipe = corpus.find(row => row.id === id), previous = functional.find(row => row.id === id);
  assert.ok(recipe && previous);
  assert.equal(hash(JSON.stringify(recipe)), previous.expected.recipeHash);
  return { sequence: index + 1, profile, id, recipeSha256: hash(JSON.stringify(recipe)), recipe, expectedNative: previous.expected, oldBaselineStatus: previous['just-bash'].status, oldBaselineFourFields: Object.fromEntries(['stdout', 'stderr', 'exitCode', 'entries'].map(field => [field, previous['just-bash'].observation[field]])), oldFailedFields: previous['just-bash'].comparison.assertions.filter(row => !row.pass).map(row => row.field) };
});
const planBytes = fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt');
write('representative-plan.json', { preparedAt: new Date().toISOString(), approvalStatus: 'NOT APPROVED; explicit root authorization still required before any product process/import', textPlanSha256: hash(planBytes), budget: { distinctIds: 7, resultBearingBashExecCalls: 8, freshEngineChildren: 8, coordinatorProcesses: 1, maxConcurrentOsProcesses: 2, warmups: 0, neutralityCalls: 0, transportControls: 0, inventoryConstructions: 0, oursInitializationCalls: 0, retries: 0, totalMs: 150000, startupMs: 15000, requestMs: 10000, guestMs: 5000 }, sourceIdentity: { acceptedCommit: '245799e7498c849098ca971fe00270112aa5e06e', priorSourceTreeSha256: read(`${replay}/seal.json`).sourceTreeSha256, dirtyFreezeNotHeadOnly: true }, rows });
console.log(JSON.stringify({ setupProfilesReviewed: checks.length, helperHashesChecked: helperHashes.length, representativeCallsPrepared: rows.length, productCallsExecuted: 0 }));
