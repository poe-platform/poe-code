import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = fileURLToPath(new URL('.', import.meta.url));
const freeze = resolve(owned, '../measurement-freeze');
const readJson = filename => JSON.parse(readFileSync(filename, 'utf8'));
const receipt = readJson(`${owned}run-receipt.json`);
const completion = readJson(`${owned}driver-completion.json`);
const root = receipt.output;
const binding = readJson(`${freeze}/execution-binding.json`);
const planned = readJson(`${root}/exact-inputs.json`);
const names = readdirSync(root).sort();
const digestFile = async filename => {
  assert.ok(lstatSync(filename).isFile(), `non-regular evidence: ${filename}`);
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; digest.update(chunk); }
  return { bytes, sha256: digest.digest('hex') };
};
const publish = (name, value) => writeFile(`${owned}${name}`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const rawFiles = [];
for (const name of names) rawFiles.push({ path: name, ...await digestFile(`${root}/${name}`) });
await publish('RAW_MANIFEST.json', { root, rawUnmodified: true, files: rawFiles });
const counts = {};
const failureGroups = {};
const exceptions = [];
const integrityErrors = [];
const processes = [];
const publicResolutions = new Map();
const loads = new Map();
const recorded = new Set();
let scoredAdmissions = 0;
let initializationAdmissions = 0;
let rawChannelObservations = 0;
let signals = 0;
const probeGone = pid => {
  if (!Number.isInteger(pid) || Math.abs(pid) <= 1) return null;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH' ? true : null; }
};
for (const name of names.filter(name => /^attempt-\d+\.json$/u.test(name))) {
  const item = readJson(`${root}/${name}`);
  const index = Number(name.slice(8, 12)) - 1;
  const expected = planned[index];
  recorded.add(index);
  if (!expected || expected.id !== item.caseId || expected.profile !== item.profile || expected.engine !== item.engine || expected.recipeHash !== item.recipeHash) integrityErrors.push({ name, error: 'planned record identity mismatch' });
  const cohort = item.profile === 'breadth' ? expected?.specimen.cohort : 'original224';
  const key = `${item.profile}/${item.engine}/${cohort}`;
  counts[key] = (counts[key] ?? 0) + 1;
  const attempt = item.attempt;
  scoredAdmissions += attempt.execAdmissions?.scoredCase ?? 0;
  initializationAdmissions += attempt.execAdmissions?.emptyInitialization ?? 0;
  signals += attempt.signals.length;
  if (attempt.result?.observation?.raw || attempt.result?.report?.result) rawChannelObservations++;
  processes.push({ evidence: name, id: item.caseId, profile: item.profile, engine: item.engine, lifecycleClean: attempt.clean, coordinatorPid: attempt.coordinatorPid, enginePid: attempt.enginePid, recordedGroupGone: attempt.groupGone, groupGoneNow: probeGone(-attempt.coordinatorPid), engineGoneNow: probeGone(attempt.enginePid), engineExit: attempt.engineExit, engineClose: attempt.engineClose, sessionExit: attempt.sessionExit, sessionClose: attempt.sessionClose, signals: attempt.signals });
  for (const event of attempt.events) {
    if (event.kind === 'public-resolution') {
      const identity = JSON.stringify({ engine: item.engine, specifier: event.specifier, parent: event.parent, resolved: event.resolved });
      publicResolutions.set(identity, (publicResolutions.get(identity) ?? 0) + 1);
    }
    if (event.kind === 'module' && event.event?.type === 'load-returned') {
      const identity = JSON.stringify(event.event);
      loads.set(identity, (loads.get(identity) ?? 0) + 1);
    }
  }
  const failedFields = item.assessment.comparison?.assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field) ?? [];
  const historicalFailures = item.assessment.historical?.failures ?? [];
  const exception = item.assessment.status !== 'pass' && item.assessment.status !== 'functional-positive';
  if (exception || failedFields.length || historicalFailures.length || attempt.failures.length) {
    const group = `${key}/${item.assessment.status}`;
    failureGroups[group] = (failureGroups[group] ?? 0) + 1;
    exceptions.push({ evidence: name, id: item.caseId, profile: item.profile, engine: item.engine, cohort, status: item.assessment.status, lifecycleClean: attempt.clean, lifecycleFailures: attempt.failures, signals: attempt.signals, failedFields, historicalFailures, resultError: attempt.result?.error ?? null, captureErrors: attempt.result?.report?.captureErrors ?? [], cleanupError: attempt.result?.report?.cleanup?.error ?? null });
  }
}
const remainingNotRecorded = planned.flatMap((item, index) => recorded.has(index) ? [] : [{ attempt: index + 1, profile: item.profile, engine: item.engine, id: item.id }]);
const post = names.includes('post-membership.json') ? readJson(`${root}/post-membership.json`) : null;
const closureProof = {};
for (const [name, expected, actual] of [['runner', binding.runner, post?.runner], ...Object.entries(binding.engines).map(([name, engine]) => [name, engine.closure, post?.engines[name]])]) {
  const expectedFiles = Object.fromEntries(expected.files.map(file => [resolve(expected.root, file.path), { bytes: file.bytes, sha256: file.sha256 }]));
  const matching = actual && Object.keys(actual.files).length === Object.keys(expectedFiles).length && Object.entries(expectedFiles).every(([filename, record]) => actual.files[filename]?.sha256 === record.sha256 && actual.files[filename]?.bytes === record.bytes);
  closureProof[name] = { boundFiles: expected.files.length, postFiles: actual ? Object.keys(actual.files).length : null, exactHashesMatchBinding: Boolean(matching), proof: 'Frozen driver post-membership verification; not a second package scan' };
}
const sourceProof = [];
for (const record of [binding.candidate.source, binding.candidate.pack, binding.candidate.sourceInventory, binding.baselineTar, ...binding.cohortClosure.files.map(record => ({ ...record, root: binding.cohortClosure.root }))]) {
  const filename = resolve(record.root, record.path);
  const actual = await digestFile(filename);
  sourceProof.push({ path: filename, ...actual, expectedSha256: record.sha256, unchanged: actual.sha256 === record.sha256 && actual.bytes === record.bytes });
}
await publish('SOURCE_AFTER.json', { candidate: binding.candidate.commit, sourceProof, closureProof, pinnedDriverInputsAfter: completion.after, postHashError: completion.postHashError });
await publish('IMPORT_IDENTITIES.json', { publicResolutions: [...publicResolutions].map(([identity, observations]) => ({ ...JSON.parse(identity), observations })), loads: [...loads].map(([identity, observations]) => ({ ...JSON.parse(identity), observations })), qualification: 'Observed loader returns, not proof that every returned module was evaluated' });
await publish('CLEANUP.json', { checkedAt: new Date().toISOString(), driverPid: receipt.commandProcessPid, driverGoneNow: probeGone(receipt.commandProcessPid), driverGroupGoneNow: probeGone(-receipt.commandProcessGroup), wrapperPid: receipt.wrapperPid, wrapperGoneNow: probeGone(receipt.wrapperPid), executorSignalsSent: [], reviewedBridgeSignals: signals, processes });
await publish('EXECUTOR_SUMMARY.json', {
  status: names.includes('summary.json') ? readJson(`${root}/summary.json`).status : 'DRIVER_STOPPED_WITHOUT_SUMMARY',
  reviewRequired: true, score: null, unionScore: null, scope: 'COMMITTED_FROZEN_COMPARISON_ONLY',
  completedRecords: recorded.size, plannedRecords: planned.length, counts, remainingNotRecorded,
  scoredAdmissions, initializationAdmissions, rawChannelObservations, failureGroups, exceptions, integrityErrors,
  lifecycleFailureRecords: processes.filter(item => !item.lifecycleClean).length,
  cleanupUnresolved: processes.filter(item => item.groupGoneNow !== true || item.engineGoneNow !== true),
  driverExit: completion.exit, driverClose: completion.close, closureProof,
  qualification: 'Unreviewed historical predicate diagnostics, not product fault attribution or accepted comparative scores. env-S partial; shebang unsupported; independent fixture validity unresolved.',
});
console.log(JSON.stringify({ records: recorded.size, counts, remaining: remainingNotRecorded.length, integrityErrors, failureGroups, rawManifest: await digestFile(`${owned}RAW_MANIFEST.json`) }, null, 2));
