import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { catalogue } from './catalogue.mjs';
import { callable, denseStrings, describeReason, fields } from './own-data.mjs';
import { makeFixture } from './fixtures.mjs';
import { createCommandHost, createRecorder } from './capture-host.mjs';
import { observeFactory, observeSession } from './private-actors.mjs';

export async function captureActor(input) {
  const began = performance.now();
  const envelope = fields(input, ['schema', 'task', 'namespace', 'limits'], 'actor input');
  if (envelope.schema !== 1) throw new TypeError('actor schema');
  const task = fields(envelope.task, ['id', 'recordId', 'bindingIds', 'fragmentIds', 'environment', 'fixtureReference', 'actorKind'], 'task');
  for (const name of ['id', 'recordId', 'environment', 'actorKind']) if (typeof task[name] !== 'string' || task[name].length > 256 || task[name].length === 0) throw new TypeError(`task ${name}`);
  if (!['source-built-direct', 'installed-moved-direct', 'SYNTHETIC_STUB_ONLY'].includes(task.environment)) throw new TypeError('actor environment');
  const profile = catalogue.profiles.find(row => row.actorKind === task.actorKind && row.recordId === task.recordId);
  if (!profile) throw new TypeError('unbound actor profile');
  const fixtureReference = fields(task.fixtureReference, ['commit', 'path', 'pointer', 'recordSha256'], 'fixture reference');
  for (const key of Object.keys(fixtureReference)) if (fixtureReference[key] !== profile.fixtureReference[key]) throw new TypeError('frozen fixture reference mismatch');
  const bindingIds = denseStrings(task.bindingIds, 8, 'bindingIds');
  const fragmentIds = denseStrings(task.fragmentIds, 8, 'fragmentIds');
  if (bindingIds.some(id => !profile.bindingIds.includes(id)) || fragmentIds.some(id => !profile.fragmentIds.includes(id))) throw new TypeError('unassigned actor binding');
  const limits = fields(envelope.limits, ['wallMs', 'stdoutBytes', 'stderrBytes', 'metadataBytes', 'storageBytes', 'events'], 'limits');
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 0 || value > profile.costs[key]) throw new TypeError(`finite actor limit ${key}`);
  if (limits.wallMs < 1 || limits.events < 4 || limits.metadataBytes < 262144 || limits.storageBytes < 12582912) throw new TypeError('actor limit reservation missing');
  const factory = callable(envelope.namespace, profile.exportName);
  const recorder = createRecorder(limits, began);
  let local;
  let facts;
  let cleanupErrors;
  let effects = { before: [], after: [] };
  let status = null;
  if (profile.mode === 'command') {
    const fixture = makeFixture(profile);
    const host = createCommandHost(fixture, recorder, limits);
    local = host.local;
    facts = host.inputFacts;
    cleanupErrors = host.cleanupErrors;
    try {
      recorder.event('actor-input', { actorKind: profile.actorKind, executionRole: task.environment, ...facts });
      recorder.event('factory-call');
      const command = factory();
      recorder.event('command-execute');
      const result = await command.execute(host.context);
      const descriptor = Object.getOwnPropertyDescriptor(result, 'exitCode');
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 255) throw new TypeError('invalid command exitCode');
      status = descriptor.value;
      try { recorder.event('command-settled', { rejected: false, status }); } catch {}
    } catch (reason) {
      local.selectedReason = reason;
      local.hasSelectedReason = true;
      try { recorder.event('command-settled', { rejected: true }); } catch {}
    } finally { await host.drain(); }
    effects = host.effects();
    facts = { ...facts, sameCallerReason: local.hasSelectedReason && Object.is(local.selectedReason, local.callerReason), sameHostReason: local.hasSelectedReason && Object.is(local.selectedReason, local.hostReason), sameSinkReason: local.hasSelectedReason && Object.is(local.selectedReason, local.sinkReason), ownershipObserved: false };
  } else {
    try {
      recorder.event('actor-input', { actorKind: profile.actorKind, executionRole: task.environment });
      const result = profile.mode === 'session' ? await observeSession(profile, factory, recorder) : await observeFactory(profile, factory, recorder);
      ({ local, facts, cleanupErrors } = result);
    } catch (reason) {
      local = { selectedReason: reason, hasSelectedReason: true, cleanupReasons: [] };
      facts = { actorIncomplete: true };
      cleanupErrors = [];
    }
  }
  const retained = recorder.finish();
  local.harnessFailure = recorder.failure();
  const capture = { stdoutHex: retained.stdoutHex, stderrHex: retained.stderrHex, status, rejected: local.hasSelectedReason, rejection: local.hasSelectedReason ? describeReason(local.selectedReason) : null, effects, events: retained.events, cleanupErrors };
  const observations = [...bindingIds, ...fragmentIds].map(bindingId => ({ bindingId, recordId: task.recordId, role: 'runtime', status: retained.captureComplete && !facts.actorIncomplete && bindingId.endsWith('::missing/0') ? 'OBSERVED' : 'UNOBSERVED', facts: { actorKind: profile.actorKind, executionRole: task.environment, captureComplete: retained.captureComplete, obligationComplete: false, scope: 'partial actor facts; final original obligation classification belongs to core/assertions', ...facts }, evidenceRefs: [`capture:${task.id}`] }));
  const result = { schema: 1, taskId: task.id, capture, observations, local };
  const metadataText = JSON.stringify({ ...result, local: null, capture: { ...capture, stdoutHex: '', stderrHex: '' } });
  const metadataBytes = Buffer.byteLength(metadataText);
  const artifactBytes = Buffer.byteLength(JSON.stringify({ ...result, local: null }));
  if (metadataBytes > limits.metadataBytes || artifactBytes > limits.storageBytes) {
    local.harnessFailure ??= new RangeError('ACTOR_FINAL_CAPTURE_LIMIT');
    capture.stdoutHex = capture.stdoutHex.slice(0, 1024);
    capture.stderrHex = capture.stderrHex.slice(0, 1024);
    capture.effects = { before: [], after: [] };
    capture.cleanupErrors = capture.cleanupErrors.slice(0, 2);
    capture.events = capture.events.slice(0, 2);
    capture.events.push({ index: capture.events.length, kind: 'actor-terminal', captureComplete: false, truncated: true, attemptedMetadataBytes: metadataBytes, attemptedArtifactBytes: artifactBytes, metadataSha256: createHash('sha256').update(metadataText).digest('hex') });
    for (const observation of observations) {
      observation.status = 'UNOBSERVED';
      observation.facts = { actorKind: profile.actorKind, captureComplete: false, truncated: true, obligationComplete: false };
    }
  }
  return result;
}
