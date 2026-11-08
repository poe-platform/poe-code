import { expect, it } from 'vitest';
import type { AdmissionRecord, AdmissionStore } from './admissions.js';
import { createJobStateJournal } from './job-state.js';

const identity = { operationId: 'receipt-owner', epoch: 'epoch', tenantId: 'tenant',
  principalId: 'principal', sessionId: 'session', kind: 'job',
  requestDigest: 'a'.repeat(64), buildDigest: 'b'.repeat(64) };

it.each(['append', 'recover', 'repeated-recover'] as const)('owns durable evidence independently of a returned %s receipt', async operation => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(record) { records.set(record.operationId, structuredClone(record)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const journal = createJobStateJournal(store, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  const exited = await journal.append({ stage: 'process-exited', retainedUntil: 100,
    effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 } });
  if (operation === 'repeated-recover') await journal.recover(1, 'sandbox-lost');
  const receipt = operation === 'append' ? exited : (await journal.recover(1, 'sandbox-lost')).event;
  const expected = structuredClone(receipt);
  receipt.effectBarrier = '99';
  receipt.processOutcome = { kind: 'exited', exitCode: 1 };
  receipt.cancelActed = true;
  expect(await journal.inspect(2)).toEqual(expected);
  if (operation === 'append') {
    expect(await journal.append({ stage: 'io-settled', retainedUntil: 100,
      effectBarrier: '2', outputComplete: true, cleanup: 'complete' }))
      .toMatchObject({ stage: 'io-settled', processOutcome: { kind: 'exited', exitCode: 0 } });
  } else {
    expect(await journal.append({ cancelRequested: true, cancelActed: false }))
      .toMatchObject({ stage: 'sandbox-lost', cancelActed: false });
  }
});

it('detects changed durable receipts even when the storage adapter retains its record carrier', async () => {
  const records = new Map<string, AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(record) { records.set(record.operationId, record); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'process-exited', retainedUntil: 100,
    effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 } });
  const exit = [...records.values()].find(record => record.jobState?.stage === 'process-exited')!;
  exit.jobState!.processOutcome = { kind: 'exited', exitCode: 1 };
  await expect(journal.inspect(2)).rejects.toMatchObject({ status: 410 });
  await expect(journal.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '2', outputComplete: true, cleanup: 'complete' }))
    .rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(3);
});

it.each(['effectBarrier', 'cancelRequested'] as const)('rejects rewritten acknowledged %s in an earlier event before final publication', async field => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(record) { records.set(record.operationId, structuredClone(record)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const journal = createJobStateJournal(store, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '1', cancelRequested: true });
  await journal.append({ stage: 'process-exited', retainedUntil: 100,
    effectBarrier: '2', cancelRequested: true, processOutcome: { kind: 'exited', exitCode: 0 } });
  const running = [...records.values()].find(record => record.jobState?.stage === 'running')!;
  // Both replacements still form a valid monotonic history. They nevertheless
  // contradict a receipt this attached writer has already durably delivered.
  if (field === 'effectBarrier') running.jobState!.effectBarrier = '0';
  else running.jobState!.cancelRequested = false;
  await expect(journal.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '2', outputComplete: true, cleanup: 'complete' }))
    .rejects.toMatchObject({ status: 410 });
  await expect(journal.inspect(2)).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(3);
});

it('freezes the effect barrier after durable I/O settlement while retaining later cancellation requests', async () => {
  const records = new Map<string, AdmissionRecord>();
  const journal = createJobStateJournal({
    async record(record) { records.set(record.operationId, structuredClone(record)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  }, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'process-exited', retainedUntil: 100,
    effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 } });
  await journal.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '2', outputComplete: true, cleanup: 'complete' });
  expect(await journal.append({ cancelRequested: true })).toMatchObject({
    stage: 'io-settled', effectBarrier: '2', cancelRequested: true, sequence: '5',
  });
  await expect(journal.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '3', outputComplete: true, cleanup: 'complete' }))
    .rejects.toThrow('Settled effect barrier cannot change');
  expect(records.size).toBe(5);
});

it.each(['io-settled', 'unknown-outcome', 'sandbox-lost'] as const)('refuses reconnect history adding effects after settlement through %s', async stage => {
  const records = new Map<string, AdmissionRecord>();
  const store: AdmissionStore = {
    async record(record) { records.set(record.operationId, structuredClone(record)); },
    async inspect(id) { return structuredClone(records.get(id) ?? null); },
  };
  const journal = createJobStateJournal(store, identity);
  await journal.append({ stage: 'accepted', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'running', retainedUntil: 100, effectBarrier: '0' });
  await journal.append({ stage: 'process-exited', retainedUntil: 100,
    effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 } });
  await journal.append({ stage: 'io-settled', retainedUntil: 100,
    effectBarrier: '2', outputComplete: true, cleanup: 'complete' });
  if (stage === 'io-settled') await journal.append({ cancelRequested: true });
  else await journal.recover(1, stage);
  const last = [...records.values()].find(record => record.jobState?.sequence === '5')!;
  last.jobState!.effectBarrier = '3';
  const reader = createJobStateJournal(store, identity);
  await expect(reader.inspect(2)).rejects.toMatchObject({ status: 410 });
  await expect(reader.recover(2, 'sandbox-lost')).rejects.toMatchObject({ status: 410 });
  expect(records.size).toBe(5);
});
