import { expect, it } from 'vitest';
import type { AdmissionRecord, AdmissionStore } from './admissions.js';
import { createJobStateJournal } from './job-state.js';
import { UploadError } from './upload-protocol.js';

const identity = {
  operationId: 'recovery-binding', epoch: 'epoch', tenantId: 'tenant',
  principalId: 'principal', sessionId: 'session', kind: 'job',
  requestDigest: 'a'.repeat(64), buildDigest: 'b'.repeat(64),
};

it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid retention clocks (%s) before durable inspection or recovery', async now => {
    const records = new Map<string, AdmissionRecord>();
    let reads = 0;
    const store: AdmissionStore = {
      async record(value) { records.set(value.operationId, structuredClone(value)); },
      async inspect(id) { reads++; return structuredClone(records.get(id) ?? null); },
    };
    const owner = createJobStateJournal(store, identity);
    await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
    reads = 0;
    const reconnect = createJobStateJournal(store, identity);
    await expect(reconnect.inspect(now)).rejects.toThrow('Invalid retention time');
    await expect(reconnect.recover(now, 'sandbox-lost')).rejects.toThrow('Invalid retention time');
    expect(reads).toBe(0);
    expect(records.size).toBe(1);
    // Rejected caller clocks neither renew retention nor retire valid evidence.
    expect(await reconnect.inspect(0)).toMatchObject({ stage: 'accepted', sequence: '1' });
    await expect(reconnect.recover(100, 'sandbox-lost')).rejects.toMatchObject({ status: 410 });
    expect(records.size).toBe(1);
  },
);

it.each(['inspection', 'recovery'] as const)('owns durable read evidence while later provider reads yield during %s', async operation => {
  const records = new Map<string, AdmissionRecord>();
  let returned: AdmissionRecord | undefined;
  let mutate = false;
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) {
      // A provider may reuse its response carrier on its next asynchronous read.
      // This changes no durable record and grants no new effect authority.
      if (mutate && returned) returned.jobState!.effectBarrier = '9';
      const value = structuredClone(records.get(id) ?? null);
      returned = value?.jobState?.stage === 'running' ? value : undefined;
      return value;
    },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  mutate = true;
  const reconnect = createJobStateJournal(store, identity);
  const event = operation === 'inspection'
    ? await reconnect.inspect(1)
    : (await reconnect.recover(1, 'unknown-outcome')).event;
  expect(event).toMatchObject({ effectBarrier: '0', stage: operation === 'inspection' ? 'running' : 'unknown-outcome' });
  expect([...records.values()].every(value => value.jobState!.effectBarrier === '0')).toBe(true);
});

it('classifies an uncopyable durable provider response as unavailable transport evidence', async () => {
  let writes = 0;
  const reconnect = createJobStateJournal({
    async record() { writes++; },
    async inspect() { return { ...identity, providerHandle() {} }; },
  }, identity);
  for (const action of [() => reconnect.inspect(1), () => reconnect.recover(1, 'sandbox-lost')]) {
    await expect(action()).rejects.toMatchObject({ status: 503, cause: { name: 'DataCloneError' } });
  }
  expect(writes).toBe(0);
});

it.each(['accepted', 'running'] as const)('refuses output completion before durable native exit in %s', async stage => {
  const records = new Map<string, AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  if (stage === 'running') await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await expect(journal.append({ stage, retainedUntil: 100, effectBarrier: '0',
    outputComplete: true, cleanup: 'complete' }))
    .rejects.toThrow('Output completion cannot precede process exit');
  expect(records.size).toBe(stage === 'accepted' ? 0 : 1);
});

it.each(['accepted', 'running'] as const)('refuses recovery from a prematurely completed %s prefix even with a settled tail', async stage => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '0',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  await owner.append({ stage: 'io-settled', retainedUntil: 100, effectBarrier: '0',
    outputComplete: true, cleanup: 'complete' });
  // The later settled tail cannot authorize an impossible earlier observation.
  // Keep the rest of the history monotonic to isolate pre-exit admission.
  let corrupt = false;
  for (const record of records.values()) {
    if (record.jobState!.stage === stage) corrupt = true;
    if (corrupt) { record.jobState!.outputComplete = true; record.jobState!.cleanup = 'complete'; }
  }
  const reader = createJobStateJournal(store, identity);
  await expect(reader.inspect(1)).rejects.toMatchObject({ status: 410 });
  await expect(reader.recover(1, 'unknown-outcome')).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(4);
});

it.each(['missing-prefix', 'missing-tail', 'changed-receipt'] as const)(
  'permanently retires an attached writer after inspection detects %s, even if storage is restored', async loss => {
    const records = new Map<string, AdmissionRecord>();
    const store: AdmissionStore = {
      async record(value) { records.set(value.operationId, structuredClone(value)); },
      async inspect(id) { return structuredClone(records.get(id) ?? null); },
    };
    const owner = createJobStateJournal(store, identity);
    await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
    await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
    const retained = structuredClone(records);
    for (const [key, value] of records) {
      if (loss === 'missing-prefix' && value.jobState!.sequence === '1'
        || loss === 'missing-tail' && value.jobState!.sequence === '2') records.delete(key);
      if (loss === 'changed-receipt' && value.jobState!.sequence === '2') value.jobState!.effectBarrier = '1';
    }
    await expect(owner.inspect(1)).rejects.toMatchObject({ status: 410 });
    // Restoring metadata cannot prove that the original process attachment or
    // its resources survived. Inspection must not reopen execution authority.
    records.clear();
    for (const [key, value] of retained) records.set(key, value);
    expect(await owner.inspect(2)).toMatchObject({ sequence: '2', stage: 'running' });
    await expect(owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '0',
      processOutcome: { kind: 'exited', exitCode: 0 } })).rejects.toMatchObject({ status: 410 });
    await expect(owner.recover(2, 'unknown-outcome')).rejects.toMatchObject({ status: 410 });
    expect(records.size).toBe(2);
    const recovered = await createJobStateJournal(store, identity).recover(2, 'unknown-outcome');
    expect(recovered.event).toMatchObject({ stage: 'unknown-outcome', sequence: '3' });
    expect(await owner.inspect(3)).toEqual(recovered.event);
  },
);

it.each([
  { stage: 'sandbox-lost', exited: false },
  { stage: 'unknown-outcome', exited: false },
  { stage: 'sandbox-lost', exited: true },
  { stage: 'unknown-outcome', exited: true },
] as const)(
  'retires an attached publisher after isolation recovery: %j', async ({ stage, exited }) => {
    const records = new Map<string, AdmissionRecord>();
    const store: AdmissionStore = {
      async record(value) {
        if (records.has(value.operationId)) throw new UploadError(409, 'Immutable record already published');
        records.set(value.operationId, structuredClone(value));
      },
      async inspect(id) { return structuredClone(records.get(id) ?? null); },
    };
    const attached = createJobStateJournal(store, identity);
    await attached.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
    await attached.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
    if (exited) await attached.append({ stage: 'process-exited', retainedUntil: 100,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 } });
    const recovery = await createJobStateJournal(store, identity).recover(1, stage);
    // A late exit from the detached owner cannot overwrite the loss receipt or
    // restore publication authority, even when its acknowledged prefix survives.
    await expect(attached.append({ stage: exited ? 'io-settled' : 'process-exited', retainedUntil: 100,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 },
      ...(exited ? { outputComplete: true, cleanup: 'complete' as const } : {}) }))
      .rejects.toMatchObject({ status: 410 });
    expect(await attached.inspect(2)).toEqual(recovery.event);
    await expect(attached.append({ cancelRequested: true, cancelActed: true }))
      .rejects.toMatchObject({ status: 410 });
    expect(records.size).toBe(exited ? 4 : 3);
    if (exited) expect(recovery.event.processOutcome).toEqual({ kind: 'exited', exitCode: 0 });
    expect(await createJobStateJournal(store, identity).inspect(2)).toEqual(recovery.event);
  },
);

it.each(['missing-tail', 'missing-all', 'changed-receipt'] as const)(
  'preserves an independent reconnect reader\'s acknowledged history after %s', async loss => {
    const records = new Map<string, AdmissionRecord>();
    const store: AdmissionStore = {
      async record(value) { records.set(value.operationId, structuredClone(value)); },
      async inspect(id) { return structuredClone(records.get(id) ?? null); },
    };
    const owner = createJobStateJournal(store, identity);
    await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
    await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
    await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '2',
      processOutcome: { kind: 'exited', exitCode: 0 } });
    const reader = createJobStateJournal(store, identity);
    const receipt = await reader.inspect(1);
    expect(receipt).toMatchObject({ sequence: '3', stage: 'process-exited' });
    // Returned metadata is borrowed by the caller, never our recovery evidence.
    receipt!.sequence = '1';
    for (const [key, value] of records) {
      if (loss === 'missing-all' || loss === 'missing-tail' && value.jobState!.sequence === '3') records.delete(key);
      if (loss === 'changed-receipt' && value.jobState!.sequence === '3') value.jobState!.processOutcome = { kind: 'exited', exitCode: 1 };
    }
    await expect(reader.inspect(2)).rejects.toMatchObject({ status: 410 });
    await expect(reader.recover(2, 'unknown-outcome')).rejects.toMatchObject({ status: 410 });
    await expect(reader.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' }))
      .rejects.toMatchObject({ status: 410 });
  },
);

it('pins the inspected prefix while later settlement events extend it', async () => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  const reader = createJobStateJournal(store, identity);
  expect(await reader.inspect(1)).toMatchObject({ sequence: '2' });
  await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '2',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  await owner.append({ stage: 'io-settled', retainedUntil: 100, effectBarrier: '2',
    outputComplete: true, cleanup: 'complete' });
  expect(await reader.inspect(2)).toMatchObject({ sequence: '4', stage: 'io-settled' });
  // This remains a valid monotonic history in isolation, but rewrites a receipt
  // already delivered to the reconnect owner. A later tail cannot legitimize it.
  const running = [...records.values()].find(record => record.jobState!.sequence === '2')!;
  running.jobState!.effectBarrier = '1';
  await expect(reader.inspect(3)).rejects.toMatchObject({ status: 410 });
  await expect(reader.recover(3, 'sandbox-lost')).rejects.toMatchObject({ status: 410 });
});

it.each([0, 1, 2])('refuses inspection and further publication after durable history truncates to %i events', async remaining => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '2',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  for (const [id, record] of records) if (Number(record.jobState!.sequence) > remaining) records.delete(id);
  // A surviving owner knows acceptance/exit were published. Missing durable
  // evidence cannot become permission to publish settlement or restart work.
  await expect(owner.inspect(1)).rejects.toMatchObject({ status: 410 });
  await expect(owner.append({ stage: 'io-settled', retainedUntil: 100, effectBarrier: '2',
    outputComplete: true, cleanup: 'complete' })).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(remaining);
});

it.each([1, 2, 3])('does not publish I/O settlement when acknowledged event %i disappears', async missing => {
  const records = new Map<string, AdmissionRecord>();
  const owner = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '2',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  const [key] = [...records].find(([, record]) => record.jobState!.sequence === String(missing))!;
  const lost = records.get(key)!;
  records.delete(key);
  await expect(owner.append({ stage: 'io-settled', retainedUntil: 100, effectBarrier: '2',
    outputComplete: true, cleanup: 'complete' })).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(2);
  // Restoring bytes cannot reopen a writer after its durability guarantee failed.
  records.set(key, lost);
  await expect(owner.append({ stage: 'io-settled', retainedUntil: 100, effectBarrier: '2',
    outputComplete: true, cleanup: 'complete' })).rejects.toMatchObject({ status: 410 });
  expect(await owner.inspect(1)).toMatchObject({ stage: 'process-exited', sequence: '3' });
});

it.each([false, true])('retains exit and settlement capacity across repeated cancellation receipts (exit first: %s)', async exitFirst => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  const exit = { stage: 'process-exited' as const, retainedUntil: 100, effectBarrier: '2',
    processOutcome: { kind: 'exited' as const, exitCode: 0 } };
  if (exitFirst) await owner.append(exit);
  const cancellation = { cancelRequested: true, cancelActed: !exitFirst };
  const receipt = await owner.append(cancellation);
  // Concurrent lost-reply retries have one durable observation, never renewed
  // action authority or a journal slot per transport attempt.
  const retries = await Promise.all(Array.from({ length: 32 }, () => owner.append(cancellation)));
  expect(retries).toEqual(Array.from({ length: 32 }, () => receipt));
  expect(records.size).toBe(exitFirst ? 4 : 3);
  if (!exitFirst) await owner.append(exit);
  const settled = await owner.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '2', outputComplete: true, cleanup: 'complete' });
  expect(settled).toMatchObject({ sequence: '5', cancelRequested: true, cancelActed: !exitFirst });
  expect(await createJobStateJournal(store, identity).inspect(99)).toEqual(settled);
  await expect(createJobStateJournal(store, identity).inspect(100)).rejects.toMatchObject({ status: 410 });
});

it('selects the persisted exit receipt when cancellation retries queue behind exit publication', async () => {
  const records = new Map<string, AdmissionRecord>();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const owner = createJobStateJournal({
    async record(value) {
      if (value.jobState?.stage === 'process-exited') { enter(); await barrier; }
      records.set(value.operationId, structuredClone(value));
    },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ cancelRequested: true, cancelActed: true });
  const exit = owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '2',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  await entered;
  const retry = owner.append({ cancelRequested: true, cancelActed: true });
  release();
  const receipt = await exit;
  expect(await retry).toEqual(receipt);
  expect(records.size).toBe(4);
  // Receipts are caller-owned snapshots, never mutable ledger authority.
  receipt.effectBarrier = '99';
  expect(await owner.inspect(99)).toMatchObject({ sequence: '4', effectBarrier: '2' });
});

it.each([false, true])('reports failed state publication as transport uncertainty (published: %s)', async published => {
  const records = new Map<string, AdmissionRecord>();
  const cause = new TypeError('Provider ledger unavailable');
  let fail = false;
  let writes = 0;
  const store: AdmissionStore = {
    async record(value) {
      writes++;
      if (!fail || published) records.set(value.operationId, structuredClone(value));
      if (fail) throw cause;
    },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  fail = true;
  await expect(owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' }))
    .rejects.toMatchObject({ status: 503, cause });
  fail = false;
  // Inspect surviving evidence without reopening this owner's launch authority.
  expect(await owner.inspect(1)).toMatchObject({ stage: published ? 'running' : 'accepted' });
  await expect(owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' }))
    .rejects.toMatchObject({ status: 503, cause });
  expect(writes).toBe(2);
  const recovery = await createJobStateJournal(store, identity).recover(1, 'unknown-outcome');
  expect(recovery.event.stage).toBe('unknown-outcome');
  expect(recovery.actions).toContain('start-new-invocation');
});

it.each(['operationId', 'kind'] as const)('refuses durable recovery from a substituted %s record', async field => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  const running = [...records.values()].find(value => value.jobState?.stage === 'running')!;
  running[field] = field === 'kind' ? 'effect-receipt' : 'another-invocation';
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(1)).rejects.toMatchObject({ status: 410 });
  await expect(reconnect.recover(1, 'unknown-outcome')).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(2);
});

it.each([new TypeError('Ledger unreadable'), new Error('Provider unavailable')])('keeps unavailable durable recovery distinct from request rejection: %s', async cause => {
  let writes = 0;
  const reconnect = createJobStateJournal({
    async record() { writes++; },
    async inspect() { throw cause; },
  }, identity);
  await expect(reconnect.inspect(1)).rejects.toMatchObject({ status: 503, cause });
  await expect(reconnect.recover(1, 'sandbox-lost')).rejects.toMatchObject({ status: 503, cause });
  await expect(reconnect.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' })).rejects.toMatchObject({ status: 503, cause });
  expect(writes).toBe(0);
});

it('keeps launch failure separate from a durable native exit', async () => {
  const records = new Map<string, AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await expect(journal.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '0',
    processOutcome: { kind: 'spawnError', code: 'ENOENT', stage: 'spawn', message: 'Executable unavailable' } }))
    .rejects.toThrow('Confirmed native outcome is required');
  expect(await journal.inspect(1)).toMatchObject({ stage: 'running', sequence: '2' });
});

it('refuses retained launch failure presented as native completion on reconnect', async () => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'process-exited', retainedUntil: 100, effectBarrier: '0',
    processOutcome: { kind: 'exited', exitCode: 0 } });
  const exit = [...records.values()].find(record => record.jobState?.sequence === '3')!;
  exit.jobState!.processOutcome = { kind: 'spawnError', code: 'ENOENT', stage: 'spawn', message: 'Executable unavailable' };
  const reconnect = createJobStateJournal(store, identity);
  await expect(reconnect.inspect(1)).rejects.toMatchObject({ status: 410 });
  await expect(reconnect.recover(1, 'unknown-outcome')).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(3);
});

it.each(['sandbox-lost', 'unknown-outcome'] as const)('does not grant cancellation action authority after %s', async stage => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  const recovery = createJobStateJournal(store, identity);
  await recovery.recover(1, stage);
  const request = await recovery.append({ cancelRequested: true, cancelActed: false });
  expect(request).toMatchObject({ stage, sequence: '4', cancelRequested: true, cancelActed: false });
  await expect(recovery.append({ cancelRequested: true, cancelActed: true }))
    .rejects.toThrow('Cancellation action requires native attachment');
  expect(await recovery.inspect(1)).toEqual(request);
  // A contradictory retained observation must fail admission too.
  const last = [...records.values()].find(record => record.jobState?.sequence === '4')!;
  last.jobState!.cancelActed = true;
  await expect(createJobStateJournal(store, identity).inspect(1)).rejects.toMatchObject({ status: 410 });
});

it.each(['unknown-outcome', 'sandbox-lost'] as const)('rejects a fabricated native exit added after retained %s', async stage => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(value) { records.set(value.operationId, structuredClone(value)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const owner = createJobStateJournal(store, identity);
  await owner.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await owner.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await owner.recover(1, stage);
  await owner.append({ cancelRequested: true });
  // A syntactically valid later receipt cannot manufacture attachment evidence
  // after the isolation owner has explicitly recorded its loss.
  const receipt = [...records.values()].find(value => value.jobState?.sequence === '4')!;
  receipt.jobState!.processOutcome = { kind: 'exited', exitCode: 0 };
  await expect(createJobStateJournal(store, identity).inspect(2)).rejects.toMatchObject({ status: 410 });
});
