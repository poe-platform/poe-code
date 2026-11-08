import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, sha256 } from './primitives.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const output = path.join(own, 'attempt-01');
const outcome = JSON.parse(fs.readFileSync(path.join(output, 'OUTCOME.json')));
const seal = JSON.parse(fs.readFileSync(path.join(own, 'DISCOVERY-PRESEAL.json')));
const membership = JSON.parse(fs.readFileSync(path.join(output, 'RAW-MEMBERSHIP.json')));
const checks = [];
function check(id, operation) {
  try { const detail = operation(); checks.push({ id, status: 'PASS', detail: detail ?? null }); }
  catch (reason) { checks.push({ id, status: 'HOLD', error: { name: reason.name, code: reason.code ?? null, message: reason.message } }); }
}
check('exact-owner-absence-after-terminal-exit', () => {
  assert.throws(() => process.kill(outcome.ownerPid, 0), { code: 'ESRCH' });
  return { pid: outcome.ownerPid, result: 'ESRCH', route: 'Node process.kill(pid,0), no ps child' };
});
check('source-and-tools-postexit', () => {
  assert.equal(describe(path.join(own, 'DISCOVERY-PRESEAL.json')).sha256, outcome.presealSha256);
  assert.deepEqual(fs.readdirSync(own).sort(), Object.keys(seal.files).concat('DISCOVERY-PRESEAL.json', 'attempt-01').sort());
  for (const [name, binding] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), binding);
  for (const [name, binding] of Object.entries(seal.sourceBindings)) assert.deepEqual(describe(path.join(repository, name)), binding);
  for (const tool of Object.values(seal.tools)) assert.deepEqual(describe(tool.path), tool.binding);
  return { ownAppendAware: true, ownSources: Object.keys(seal.files).length, historicalNamedBindings: Object.keys(seal.sourceBindings).length, tools: 2, foreignAppendAware: false };
});
check('exact-raw-membership', () => {
  assert.deepEqual(fs.readdirSync(output).sort(), Object.keys(membership.files).concat('RAW-MEMBERSHIP.json', 'OUTCOME.json').sort());
  for (const [name, binding] of Object.entries(membership.files)) assert.deepEqual(describe(path.join(output, name)), binding);
  assert.equal(outcome.rawBytes, outcome.receipts.reduce((sum, receipt) => sum + receipt.stdout.bytes + receipt.stderr.bytes, 0));
  for (const receipt of outcome.receipts) for (const channel of ['stdout', 'stderr']) {
    const binding = describe(path.join(output, receipt[channel].file));
    assert.equal(binding.sha256, receipt[channel].sha256);
    assert.equal(binding.bytes, receipt[channel].bytes);
  }
  return { members: Object.keys(membership.files).length, rawStreams: outcome.receipts.length * 2, bytes: outcome.rawBytes, exactNames: true };
});
check('lease-order-and-known-reap', () => {
  const events = fs.readFileSync(path.join(output, 'OWNER-EVENTS.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  let active = null;
  let registered = null;
  let spawns = 0;
  for (const event of events) {
    if (event.kind === 'capture-and-lease-registered-before-spawn') { assert.equal(active, null); registered = event.id; }
    if (event.kind === 'spawn') { assert.equal(active, null); assert.equal(registered, event.id); active = event.id; spawns++; }
    if (event.kind === 'retired') { assert.equal(active, event.id); assert.equal(event.closeObserved, true); assert.equal(event.absent, true); active = null; }
  }
  assert.equal(active, null);
  assert.equal(spawns, outcome.actualChildren);
  for (const receipt of outcome.receipts) { assert.equal(receipt.closeObserved, true); assert.equal(receipt.absent, true); }
  return { directChildren: spawns, registeredBeforeEachSpawn: true, allRetiredBeforeNext: true, noOSGlobalCensus: true };
});
check('cumulative-bounds-and-cleanup', () => {
  const bytes = fs.readdirSync(output).reduce((sum, name) => sum + fs.lstatSync(path.join(output, name)).size, 0);
  assert.ok(outcome.elapsedMs < seal.bounds.totalMs);
  assert.ok(outcome.actualChildren <= seal.bounds.maximumChildren);
  assert.ok(outcome.peakAllOwnedProcesses <= 2);
  assert.ok(bytes <= seal.bounds.persistedBytes);
  assert.ok(outcome.scratchWrittenBytes <= seal.bounds.tightenedScratchBytes);
  assert.equal(outcome.cleanup.removed, true);
  assert.equal(fs.existsSync(path.join(output, 'work')), false);
  return { elapsedMs: outcome.elapsedMs, persistedEvidenceBytesBeforePostexit: bytes, scratchWrittenBytes: outcome.scratchWrittenBytes, removed: true };
});
check('fixed-denominators-no-product', () => {
  assert.equal(outcome.productExecutions, 0);
  assert.equal(outcome.candidateImports, 0);
  assert.equal(outcome.remaining43JobsExecuted, 0);
  assert.equal(outcome.productFixtureTailExecuted, 0);
  return { controls: outcome.results.map(record => record.id), data: outcome.dataResults.map(record => record.id), noRescore: true };
});
const envFilename = path.join(output, 'OWNER-ENV-DISCOVERY.json');
const envRecord = fs.existsSync(envFilename) ? JSON.parse(fs.readFileSync(envFilename)) : null;
const complete = outcome.stopped === null && checks.every(result => result.status === 'PASS') && outcome.results.length === 6 && outcome.dataResults.length === 4 && outcome.discoveryQualified && outcome.startupRefusalQualified;
const postexit = { schema: 'remaining-harness-v6-postexit-data-verification', classification: 'One bounded postexit evidence verification; not new controls or product acceptance', checkedAt: new Date().toISOString(), ownerOutcomeSha256: describe(path.join(output, 'OUTCOME.json')).sha256, checks, qualified: complete };
const report = `# Remaining harness v6 — ${complete ? 'bounded controls qualified' : 'HOLD'}\n\n` +
  `Source/preseal commit: \`${outcome.sourceCommit}\`. Discovery preseal SHA256: \`${outcome.presealSha256}\`. Main preseal SHA256: \`${outcome.mainPresealSha256}\`.\n\n` +
  `One epoch, no retries. Six-control result: **${outcome.results.length}/6**; separately ${outcome.dataResults.length}/4 fixture DATA checks; discovery=${outcome.discoveryQualified}; intentional startup refusal=${outcome.startupRefusalQualified}. Stop: ${JSON.stringify(outcome.stopped)}.\n\n` +
  `Actual direct children **${outcome.actualChildren}**, all-owned peak **${outcome.peakAllOwnedProcesses}** (owner + one child), elapsed ${outcome.elapsedMs.toFixed(3)}ms including cleanup; raw ${outcome.rawBytes} bytes; cumulative scratch writes ${outcome.scratchWrittenBytes} bytes. Exact receipts and monotonic register/spawn/close/ESRCH events are in attempt-01. Peak is finite-route qualification, not a global OS census.\n\n` +
  `Environment route: owner Node process.env observation and the separately presealed metadata-child route, not old evidence. Observed record: \`${JSON.stringify(envRecord?.env ?? null)}\`. Discovery admission=${outcome.discoveryQualified}; main seal created=${outcome.mainPresealSha256 !== null}. No variable deletion or retry. The observed Darwin-supplied key is retained; exact OS/library injector was not independently traced.\n\n` +
  (complete ? `START-POSITIVE and START-REFUSAL stdout/stderr/exit are genuine raw pipe files registered by the outer owner before launch. The intentional unequal expected value fails before DATA import with unchanged actual env. This does not retroactively make v4's transcript raw. G01 is isolated native metadata Git only, NOT real-repository commit qualification. P01 proves actual ChildProcess denial, occupied lease refusal and exact child retirement. R01 preserves five installed bodies and creates five distinct moved names; B01 remains helper-only admission proof.\n\n` : `Qualification is HOLD. Only the actual receipts/raw records support completed observations; authored unrun routes are not verified fixes. No further launch, control or source correction is authorized by this evidence.\n\n`) +
  `Postexit checks: ${checks.map(result => `${result.id}=${result.status}`).join('; ')}. Source membership is append-aware within the owned source scope and capture scope; historical checks cover named bindings, not new entries in foreign trees. Capture modes are observed worktree modes; Git records only executable-bit distinctions. Cleanup: ${JSON.stringify(outcome.cleanup)}.\n\n` +
  `No product execution/import, build, compiler, native oracle, private or network work. Candidate \`58be2d6c5706f3e90f01d48e695ecfd9daa52669\` unchanged; S54 remains Poincare/root's separate adjudication. Preserve diagnosis \`915aee082e5aaa53abba7578b5ccbe11e679e4e7\`, v4 evidence \`6585d17a90a9971ca2cc36dad16b41c505c16b9b\` startup HOLD0/6 (transcribed, not raw), and consumed original HOLD27/70, peak>=3, 43 UNRUN, 346/11/18/3. No old fixture or failure was rescored.\n\n` +
  `The four versioned fixtures remain product NOT_RUN: S62 exact38-byte canonical diagnostic is not truncation proof; S64 allows wrapper acquisition and requires no PULL plus intended writes/no extra effects (current user explicitly authorizes wrapper acquisition and correct literal effects); S71 records actual mode argument; S74 accepts only full98/92-byte diagnostics without attributing uncaptured timestamp causes.\n\n` +
  `OLDcandidate mapping ONLY, not an executable successor plan: REMAINING-v6.json contains fresh43 (5 moved types +18 limits +2 adapters +18 mutants), separately 3 tail jobs/12 new rows, and 11 separately named auxiliary jobs: **57 proposed children**, 41 product jobs/56 proposed case receipts. Later caps: 6600000ms incl30000 cleanup reserve, peak2,128MiB capture,512MiB scratch. This historical mapping is NOT GO; no old passes transfer. New candidate753f33d2/preseal450d0631/evidence61e9ce52 was not inspected or executed. Root must supply a new binding after qualification. New worker/launcher/build qualification and S54 remain barriers. The committed-runtime-seal barrier is retained; neither durable-file nor serialized-handoff replacement is implemented.\n`;
const outputs = new Map([
  ['attempt-01/POSTEXIT.json', Buffer.from(JSON.stringify(postexit, null, 2) + '\n')],
  ['REPORT.md', Buffer.from(report)]
]);
const evidenceFiles = Object.fromEntries(fs.readdirSync(output).filter(name => fs.lstatSync(path.join(output, name)).isFile()).sort().map(name => [`attempt-01/${name}`, describe(path.join(output, name))]));
for (const [name, bytes] of outputs) evidenceFiles[name] = { bytes: bytes.length, mode: 0o644, sha256: sha256(bytes) };
outputs.set('EVIDENCE-SEAL.json', Buffer.from(JSON.stringify({ schema: 'remaining-harness-v6-evidence-seal', sourceCommit: outcome.sourceCommit, discoveryPresealSha256: outcome.presealSha256, mainPresealSha256: outcome.mainPresealSha256, files: evidenceFiles, evidenceCommit: 'reported externally; no self-referential commit hash', qualified: complete }, null, 2) + '\n'));
process.stdout.write('*** Begin Patch\n');
for (const [name, bytes] of outputs) {
  assert.equal(fs.existsSync(path.join(own, name)), false, `postexit artifact collision ${name}`);
  process.stdout.write(`*** Add File: ${path.relative(repository, path.join(own, name))}\n${bytes.toString().trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n`);
}
process.stdout.write('*** End Patch\n');
