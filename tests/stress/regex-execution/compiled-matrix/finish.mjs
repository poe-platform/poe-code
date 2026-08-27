import { existsSync, readdirSync } from 'node:fs';
import { cases } from '../bounded-matrix/cases.mjs';
import { base, json, evidence, verify, expected, save, digest } from './guard.mjs';

if (process.argv.length !== 2) throw new Error('Fixed audit only');
const rows = cases.map(selected => ({ selected, record: json(evidence(selected.id)) }));
let controls = 0;
let completedRisky = 0;
let watchdogKilled = 0;
let familySkipped = 0;
let nativeCalls = 0;
let parentAttempts = 0;
const stopped = new Set();
for (const { selected, record } of rows) {
  if (record.id !== selected.id || record.tool !== selected.tool || record.kind !== selected.kind
    || record.activechildren !== 0 || record.executionStable !== true) throw new Error('Identity/cleanup failure');
  if (record.outcome === 'skipped') {
    if (!stopped.has(selected.tool) || record.reason !== 'family-execution-watchdog' || record.pid !== null
      || existsSync(new URL(`claims/${selected.id}.json`, base))) throw new Error('Invalid skip');
    familySkipped++;
    continue;
  }
  if (selected.kind === 'nested' && (controls !== 4 || stopped.has(selected.tool))) throw new Error('Schedule violation');
  parentAttempts++;
  if (!record.cleanup.every(Boolean) || record.cleanup.length !== 5 || record.cleanupWarning) throw new Error('Closure failure');
  const enter = record.messages.filter(message => message[0] === 'enter');
  if (enter.length !== 1 || enter[0][1] !== 1) throw new Error('Selected entry count');
  nativeCalls++;
  if (record.outcome === 'completed') {
    if (!expected(record, selected)) throw new Error('Expected bytes/status failure');
    if (selected.kind === 'control') controls++; else completedRisky++;
    const before = json(new URL(`evidence/${selected.id}.loaded-before.json`, base));
    const after = json(new URL(`evidence/${selected.id}.loaded-after.json`, base));
    if (JSON.stringify(before.hashes) !== JSON.stringify(after.hashes)) throw new Error('Runtime hash drift');
  } else if (record.outcome === 'parent-terminated-with-entry-marker' && selected.kind === 'nested'
    && record.reason === 'execution-deadline' && record.killAccepted && record.exit[1] === 'SIGKILL'
    && record.close[1] === 'SIGKILL' && !record.messages.some(message => message[0] === 'leave')) {
    watchdogKilled++;
    stopped.add(selected.tool);
  } else throw new Error('Substantive unfinished row');
}
if (controls !== 4 || completedRisky + watchdogKilled + familySkipped !== 8
  || completedRisky + watchdogKilled > 8) throw new Error('Fixed cohort counts');
const finalProof = verify();
const frozen = json(new URL('frozen.json', base));
const drift = (before, after) => Object.keys(before).filter(name => before[name] !== after[name]);
save(new URL('evidence/final-proof.json', base), finalProof);
save(new URL('evidence/ledger.json', base), { utc: new Date().toISOString(),
  compiled: { declaredRows: 12, controls, completedRisky, watchdogKilled, familySkipped,
    parentAttempts, nativeCalls, parentNativeCalls: 0, activechildren: 0 },
  historical: { originalMatrixControlsCompleted: 2, controlsDeclared: 4, riskyExecuted: 0, riskySkipped: 8,
    rgImportFailures: 1, staticProbes: 0, initialHarnessControls: '1/2', correctedHarnessControls: '2/2', separate13ByteGrep: 1,
    originalFreeze: '9653d91', originalEvidence: 'b0ff710', review: '3d8f96e',
    continuationFreeze: '8f5f185', continuationEvidence: '6bd5594', documentationStop: '29351b3' },
  liveSourceDrift: drift(frozen.liveSourceHashes, finalProof.liveSourceHashes),
  observationDrift: drift(frozen.observationHashes, finalProof.observationHashes),
  rows: rows.map(({ selected, record }) => {
    const observation = record.stdout ? JSON.parse(record.stdout) : null;
    const entry = record.messages?.find(message => message[0] === 'enter');
    const start = record.events?.find(event => event[0] === 'start')?.[1];
    return { id: selected.id, repeatedA: selected.repeatedA, subjectBytes: selected.subjectBytes,
      outcome: record.outcome, nativeBracketMs: observation ? Number((observation.leave - observation.enter).toFixed(3)) : null,
      watchdogAfterStartMs: record.deadlineActual === null || start === undefined ? null : Number((record.deadlineActual - start).toFixed(3)),
      childTimerDue: observation?.timerDue ?? entry?.[4] ?? null, childTimerActual: observation?.timerActual ?? null,
      signalEntry: observation?.signalEntry ?? entry?.[5] ?? null, signalLeave: observation?.signalLeave ?? null,
      signalEnd: observation?.signalEnd ?? null, signalDelivered: observation?.signalDelivered ?? null,
      commandEnd: observation?.commandEnd ?? null, facadeWinner: observation?.facadeWinner ?? null, facadeEnd: observation?.facadeEnd ?? null };
  }),
  rawHashes: Object.fromEntries(readdirSync(new URL('evidence/', base)).sort().map(name => [name, digest(new URL(`evidence/${name}`, base))])),
});
console.log(JSON.stringify({ controls, completedRisky, watchdogKilled, familySkipped, parentAttempts, nativeCalls, activechildren: 0 }));
