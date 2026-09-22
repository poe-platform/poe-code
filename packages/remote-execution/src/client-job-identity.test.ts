import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import type { DependencyJobRequest, Job, JobRequest } from './wire.generated.js';

let session = { sessionId: 'session', epoch: 'epoch' };
beforeEach(() => { session = { sessionId: 'session', epoch: 'epoch' }; });
const request: JobRequest = {
  buildDigest: 'a'.repeat(64), toolId: 'tool', args: [[]], namespaceId: 'work',
  materializationRevision: null, cwd: '/', env: {}, stdin: { kind: 'stream', seekable: false },
  descriptors: [], grants: [], freshness: 'live',
  limits: { maxJobs: 1, maxHandles: 4, maxArgvBytes: 64, maxManifestEntries: 8,
    maxFrameBytes: 64, maxInflightBytes: 256, maxBlobBytes: 256, maxReplayBytes: 256,
    maxCallbacks: 4, maxNativeMemoryBytes: 8192, maxNativeProcesses: 4, maxJobDurationMs: 10000 },
};
const accepted: Job = {
  ...session, jobId: 'job', invocationId: 'invocation', buildDigest: request.buildDigest,
  state: 'accepted', cancelRequested: false, effectBarrier: '0', outputComplete: false,
  retainedUntil: new Date(100000).toISOString(),
};
it.each(['unknown-outcome', 'sandbox-lost'] as const)('rejects provider uncertainty in the native evidence slot after %s', async stage => {
  const receipt: Job = {...accepted,state:'terminal',cleanup:'unknown',
    outcome:{kind:'unknown',reason:'Provider unavailable'},
    jobState:{version:1,sequence:'3',stage,retainedUntil:100000,effectBarrier:'0',cleanup:'unknown',
      processOutcome:{kind:'executionError',error:{category:'transport',code:'unavailable',message:'Provider unavailable',phase:'unknown'}}}};
  const client = createClient({baseUrl:'https://media.test',token:async()=> 'token',
    fetch:async()=>Response.json(receipt,{headers:{'Execution-Epoch':session.epoch}})});
  await expect(client.inspectJob(session,'job')).rejects.toMatchObject({category:'transport',phase:'unknown',status:502,
    recovery:{...session,jobId:'job'}});
});
it.each([
  { outputComplete: false, cleanup: 'complete' as const },
  { outputComplete: undefined, cleanup: 'complete' as const },
  { outputComplete: true, cleanup: 'pending' as const },
  { outputComplete: true, cleanup: 'unknown' as const },
  { outputComplete: true, cleanup: undefined },
])('rejects an impossible durable I/O settlement before retaining reconnect evidence: %j', async barriers => {
  const valid: Job = { ...accepted, state: 'draining', cleanup: 'pending',
    processOutcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 } } };
  const invalid = structuredClone(valid);
  invalid.jobState = { ...valid.jobState!, sequence: '4', stage: 'io-settled', ...barriers };
  // Keep live progress consistent with whichever barriers the provider claims.
  // Neither an exit nor a stage label can substitute for the missing barriers.
  invalid.outputComplete = barriers.outputComplete === true;
  invalid.cleanup = barriers.cleanup;
  const replies = [valid, invalid, valid];
  const options = { baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(replies.shift(), { headers: { 'Execution-Epoch': session.epoch } }) };
  await expect(createClient(options).inspectJob(session, 'job')).resolves.toEqual(valid);
  await expect(createClient(options).inspectJob(session, 'job')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job' },
  });
  await expect(createClient(options).inspectJob(session, 'job')).resolves.toEqual(valid);
});
it.each(['exit', 'sequence', 'invocation', 'settlement'] as const)(
  'retains %s evidence when renewed credentials use a replacement client', async regression => {
    const first: Job = { ...accepted, state: 'terminal', cleanup: 'complete', outputComplete: true,
      outcome: { kind: 'exited', exitCode: 0 }, processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
        effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: true, cleanup: 'complete' } };
    const next = structuredClone(first);
    if (regression === 'exit') next.outcome = next.processOutcome = next.jobState!.processOutcome = { kind: 'exited', exitCode: 1 };
    if (regression === 'sequence') next.jobState!.sequence = '3';
    if (regression === 'invocation') next.invocationId = 'replacement';
    if (regression === 'settlement') {
      next.state = 'draining'; next.outputComplete = false; next.cleanup = 'pending'; delete next.outcome;
      next.jobState!.stage = 'process-exited'; next.jobState!.sequence = '3';
      next.jobState!.outputComplete = false; next.jobState!.cleanup = 'pending';
    }
    const client = (receipt: Job, origin = 'https://media.test') => createClient({ baseUrl: origin,
      token: async () => 'renewed-token', fetch: async () => Response.json(receipt,
        { headers: { 'Execution-Epoch': session.epoch } }) });
    await expect(client(first).inspectJob(session, 'job')).resolves.toEqual(first);
    await expect(client(next).inspectJob(session, 'job')).rejects.toMatchObject({
      category: 'transport', code: 'unrecoverable', recovery: { ...session, jobId: 'job' },
    });
    await expect(client(first).inspectJob(session, 'job')).resolves.toEqual(first);
    // Identical opaque IDs at a different authenticated origin are independent.
    await expect(client(next, 'https://other.test').inspectJob(session, 'job')).resolves.toEqual(next);
  },
);
it.each(['native-exit', 'effect-barrier', 'cancel-request', 'cleanup'] as const)(
  'retains live %s evidence across reconnect while durable publication is pending', async regression => {
    const first: Job = { ...accepted, state: 'draining', cleanup: 'complete',
      cancelRequested: true, effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '2', stage: 'running', retainedUntil: 100000,
        effectBarrier: '0' } };
    const next = structuredClone(first);
    if (regression === 'native-exit') delete next.processOutcome;
    if (regression === 'effect-barrier') next.effectBarrier = '1';
    if (regression === 'cancel-request') next.cancelRequested = false;
    if (regression === 'cleanup') next.cleanup = 'pending';
    const replies = [first, next, first];
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'renewed-token',
      fetch: async () => Response.json(replies.shift(), { headers: { 'Execution-Epoch': session.epoch } }) });
    await expect(client.inspectJob(session, 'job')).resolves.toEqual(first);
    await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({
      category: 'transport', code: 'unrecoverable', recovery: { ...session, jobId: 'job' },
    });
    await expect(client.inspectJob(session, 'job')).resolves.toEqual(first);
  },
);
it.each(['sequence', 'same-sequence', 'effect', 'exit', 'invocation', 'build', 'missing-journal'] as const)(
  'refuses reconnect retracting an earlier %s receipt', async conflict => {
    const first: Job = { ...accepted, state: 'draining', effectBarrier: '2',
      processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
        effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 } } };
    const next = structuredClone(first);
    if (conflict === 'sequence') next.jobState!.sequence = '2';
    if (conflict === 'same-sequence') next.jobState!.cleanup = 'pending';
    if (conflict === 'effect') { next.jobState!.sequence = '4'; next.effectBarrier = next.jobState!.effectBarrier = '1'; }
    if (conflict === 'exit') { next.jobState!.sequence = '4'; next.processOutcome = next.jobState!.processOutcome = { kind: 'exited', exitCode: 1 }; }
    if (conflict === 'invocation') next.invocationId = 'replacement';
    if (conflict === 'build') next.buildDigest = 'b'.repeat(64);
    if (conflict === 'missing-journal') delete next.jobState;
    const receipts = [first, next];
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
      fetch: async () => Response.json(receipts.shift(), { headers: { 'Execution-Epoch': session.epoch } }) });
    const receipt = await client.inspectJob(session, 'job');
    receipt.jobState!.effectBarrier = '0';
    await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({ category: 'transport',
      code: 'unrecoverable', recovery: { ...session, jobId: 'job' } });
  },
);

it('refuses attaching a retried invocation to a different accepted job', async () => {
  const receipts = [accepted, { ...accepted, jobId: 'replacement' }];
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipts.shift(), { headers: { 'Execution-Epoch': session.epoch } }) });
  await client.submitJob(session, request, 'invocation');
  await expect(client.submitJob(session, request, 'invocation')).rejects.toMatchObject({ category: 'transport', code: 'unrecoverable' });
});

it.each([false, true])('rejects an older inspection reply arriving after final publication (replacement client: %s)', async replacement => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const settled: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
    outcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: true, cleanup: 'complete' } };
  // Freeze the earlier receipt before another request advances the server.
  const older: Job = { ...accepted, jobState: { version: 1, sequence: '1', stage: 'accepted', retainedUntil: 100000, effectBarrier: '0' } };
  let requests = 0;
  const options = { baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => {
      const initial = requests++ === 0;
      if (initial) { entered(); await gate; }
      return Response.json(initial ? older : settled, { headers: { 'Execution-Epoch': session.epoch } });
    } };
  const racingClient = createClient(options);
  const delayed = racingClient.inspectJob(session, 'job');
  await ready;
  const reconnected = replacement ? createClient(options) : racingClient;
  await expect(reconnected.waitJob(session, 'job')).resolves.toEqual(settled);
  release();
  await expect(delayed).rejects.toMatchObject({ category: 'transport', code: 'unrecoverable' });
  await expect(racingClient.inspectJob(session, 'job')).resolves.toEqual(settled);
});
it('rejects delayed live inspection evidence after a newer receipt arrives before journal publication', async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const running: Job = { ...accepted, state: 'running', cleanup: 'pending',
    jobState: { version: 1, sequence: '2', stage: 'running', retainedUntil: 100000, effectBarrier: '0' } };
  const exited: Job = { ...running, state: 'draining', effectBarrier: '1',
    processOutcome: { kind: 'exited', exitCode: 0 } };
  let requests = 0;
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => {
      if (requests++ === 0) { enter(); await gate; return Response.json(running, { headers: { 'Execution-Epoch': session.epoch } }); }
      return Response.json(exited, { headers: { 'Execution-Epoch': session.epoch } });
    } });
  const older = client.inspectJob(session, 'job');
  await entered;
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(exited);
  release();
  await expect(older).rejects.toMatchObject({ category: 'transport', code: 'unrecoverable' });
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(exited);
});
it.each(['effect-barrier', 'cancel-request', 'output-complete', 'cleanup'] as const)(
  'refuses reconnect metadata retracting durable %s progress', async regression => {
    const receipt: Job = { ...accepted, state: 'draining', cleanup: 'complete',
      effectBarrier: '2', cancelRequested: true, outputComplete: false,
      processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
        effectBarrier: '2', cancelRequested: true, processOutcome: { kind: 'exited', exitCode: 0 },
        outputComplete: false, cleanup: 'complete' } };
    if (regression === 'effect-barrier') receipt.effectBarrier = '1';
    if (regression === 'cancel-request') receipt.cancelRequested = false;
    if (regression === 'output-complete') receipt.jobState!.outputComplete = true;
    if (regression === 'cleanup') receipt.cleanup = 'unknown';
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
      fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
    await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({ category: 'transport', phase: 'unknown',
      status: 502, recovery: { ...session, jobId: 'job' } });
  },
);
it.each(['retention', 'native-observation', 'premature-exit', 'unconfirmed-exit'] as const)(
  'rejects incomplete reconnect metadata contradicting durable %s evidence', async conflict => {
    const receipt: Job = { ...accepted, state: 'draining', cleanup: 'pending',
      processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
        effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: false, cleanup: 'pending' } };
    if (conflict === 'retention') receipt.retainedUntil = new Date(200000).toISOString();
    if (conflict === 'native-observation') receipt.processOutcome = { kind: 'exited', exitCode: 1 };
    if (conflict === 'premature-exit') receipt.jobState!.stage = 'running';
    if (conflict === 'unconfirmed-exit') {
      receipt.processOutcome = receipt.jobState!.processOutcome = { kind: 'unknown', reason: 'Provider unavailable' };
    }
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
      fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
    await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({ category: 'transport', phase: 'unknown',
      status: 502, recovery: { ...session, jobId: 'job' } });
  },
);
it.each(['pending', 'unknown', 'unsettled-journal'] as const)('refuses successful output metadata with %s settlement', async settlement => {
  const receipt: Job = { ...accepted, state: 'terminal', outputComplete: true,
    outcome: { kind: 'exited', exitCode: 0 }, cleanup: settlement === 'unsettled-journal' ? 'complete' : settlement,
    jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: false, cleanup: 'pending' } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.waitJob(session, 'job')).rejects.toMatchObject({ category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job' } });
});
it('accepts native success after the durable output and cleanup barriers settle', async () => {
  const receipt: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
    outcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: true, cleanup: 'complete' } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.waitJob(session, 'job')).resolves.toEqual(receipt);
});

it.each(['cleanup', 'journal', 'terminal-state'] as const)('requires explicit %s evidence before admitting final success', async missing => {
  const receipt: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
    outcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: true, cleanup: 'complete' } };
  if (missing === 'cleanup') delete receipt.cleanup;
  if (missing === 'journal') delete receipt.jobState;
  if (missing === 'terminal-state') receipt.state = 'draining';
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.waitJob(session, 'job')).rejects.toMatchObject({ category: 'transport', phase: 'unknown',
    status: 502, recovery: { ...session, jobId: 'job' } });
});

it.each(['outcome', 'effect-barrier', 'retention', 'cancel-request', 'native-observation'] as const)(
  'refuses final publication contradicting durable %s evidence', async conflict => {
    const receipt: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
      outcome: { kind: 'exited', exitCode: 0 }, processOutcome: { kind: 'exited', exitCode: 0 },
      jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
        effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 },
        outputComplete: true, cleanup: 'complete', cancelRequested: false } };
    if (conflict === 'outcome') receipt.outcome = { kind: 'exited', exitCode: 1 };
    if (conflict === 'effect-barrier') receipt.effectBarrier = '1';
    if (conflict === 'retention') receipt.retainedUntil = new Date(200000).toISOString();
    if (conflict === 'cancel-request') receipt.cancelRequested = true;
    if (conflict === 'native-observation') receipt.processOutcome = { kind: 'exited', exitCode: 1 };
    const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
      fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
    await expect(client.waitJob(session, 'job')).rejects.toMatchObject({ category: 'transport', phase: 'unknown',
      status: 502, recovery: { ...session, jobId: 'job' } });
  },
);

it('preserves known exit evidence when output recovery remains incomplete', async () => {
  const receipt: Job = { ...accepted, state: 'terminal', cleanup: 'unknown',
    outcome: { kind: 'unknown', reason: 'Output acknowledgment unavailable' },
    processOutcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '4', stage: 'unknown-outcome', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 }, outputComplete: false, cleanup: 'unknown' } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(receipt);
});

it('preserves live observations while their durable publication is pending', async () => {
  const receipt: Job = { ...accepted, state: 'draining', cleanup: 'pending', cancelRequested: true,
    effectBarrier: '1', processOutcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '2', stage: 'running', retainedUntil: 100000,
      effectBarrier: '0', cancelRequested: false, outputComplete: false, cleanup: 'pending' } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(receipt);
});

it('admits matching settled signal evidence independent of JSON field order', async () => {
  const receipt: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
    outcome: { signalNumber: 15, signal: 'SIGTERM', kind: 'signaled' },
    jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'signaled', signal: 'SIGTERM', signalNumber: 15 },
      outputComplete: true, cleanup: 'complete' } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.waitJob(session, 'job')).resolves.toEqual(receipt);
});
const dependencyRequest: DependencyJobRequest = {
  ...request, materializationRevision: 'revision',
  materializationBinding: { operationId: 'preparation', root: '/' },
  dependencyBinding: { bindingId: 'binding', sourceAuthorityId: 'authority', materializationId: 'preparation',
    invocation: { manifestId: 'manifest', manifestRevision: 'manifest-revision', directoryRevision: 'revision', cwd: [47], originalArgv: [[]] } },
};

for (const profile of ['generic', 'dependency'] as const) {
it.each([
  { invocationId: 'other' }, { invocationId: undefined }, { buildDigest: 'b'.repeat(64) },
  { sessionId: 'other' }, { epoch: 'other' },
])(`${profile} refuses an accepted create receipt bound to another invocation: %j`, async mismatch => {
  const fetch = vi.fn(async () => Response.json({ ...accepted, ...mismatch }, { headers: { 'Execution-Epoch': session.epoch, 'Execution-Profile': 'dependency-manifest-v1' } }));
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch });
  const result = profile === 'generic' ? client.submitJob(session, request, 'invocation')
    : client.submitDependencyJob(session, dependencyRequest, 'invocation');
  await expect(result).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, operationKey: 'invocation' },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
}

it.each(['inspect', 'wait', 'cancel'] as const)('refuses a %s receipt for another native job', async action => {
  const fetch = vi.fn(async () => Response.json({ ...accepted, jobId: 'other' }, { headers: { 'Execution-Epoch': session.epoch } }));
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch });
  const result = action === 'inspect' ? client.inspectJob(session, 'job')
    : action === 'wait' ? client.waitJob(session, 'job')
    : client.cancelJob(session, 'job', { reason: 'stop' }, 'cancel');
  await expect(result).rejects.toMatchObject({ category: 'transport', phase: 'unknown', status: 502, recovery: { ...session, jobId: 'job' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('binds acceptance to the submitted build before credentials yield', async () => {
  const input = structuredClone(request);
  const client = createClient({ baseUrl: 'https://media.test', token: async () => {
    input.buildDigest = 'b'.repeat(64); return 'token';
  }, fetch: async () => Response.json(accepted, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.submitJob(session, input, 'invocation')).resolves.toMatchObject(accepted);
});

it('rejects a durable cancellation action without a cancellation request', async () => {
  const receipt: Job = { ...accepted, jobState: { version: 1, sequence: '2',
    stage: 'running', retainedUntil: 100000, effectBarrier: '0',
    cancelRequested: false, cancelActed: true } };
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.inspectJob(session, 'job')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job' },
  });
});

for (const stage of ['process-exited', 'unknown-outcome', 'sandbox-lost'] as const) {
it.each([false, true])(`rejects cancellation action first appearing after durable ${stage} (replacement client: %s)`, async replacement => {
  const first: Job = { ...accepted, state: 'draining', cancelRequested: true,
    ...(stage === 'process-exited' ? { processOutcome: { kind: 'exited' as const, exitCode: 0 } } : {}),
    jobState: { version: 1, sequence: '3', stage, retainedUntil: 100000,
      effectBarrier: '0', cancelRequested: true, cancelActed: false,
      ...(stage === 'process-exited' ? { processOutcome: { kind: 'exited' as const, exitCode: 0 } } : {}) } };
  const next = structuredClone(first);
  next.jobState!.sequence = '4';
  next.jobState!.cancelActed = true;
  const replies = [first, next, first];
  const options = { baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(replies.shift(), { headers: { 'Execution-Epoch': session.epoch } }) };
  const client = createClient(options);
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(first);
  await expect((replacement ? createClient(options) : client).inspectJob(session, 'job'))
    .rejects.toMatchObject({ category: 'transport', code: 'unrecoverable',
      recovery: { ...session, jobId: 'job' } });
  // A contradictory reply must not replace the previously accepted evidence.
  await expect(client.inspectJob(session, 'job')).resolves.toEqual(first);
});
}

it.each([false, true])('preserves the native exit when cancellation %s acted before exit', async acted => {
  const first: Job = { ...accepted, state: 'draining', cancelRequested: acted,
    processOutcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 0 },
      cancelRequested: acted, cancelActed: acted } };
  const next = structuredClone(first);
  next.cancelRequested = next.jobState!.cancelRequested = true;
  next.jobState!.sequence = '4';
  const replies = [first, next];
  const options = { baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(replies.shift(), { headers: { 'Execution-Epoch': session.epoch } }) };
  await expect(createClient(options).inspectJob(session, 'job')).resolves.toEqual(first);
  await expect(createClient(options).inspectJob(session, 'job')).resolves.toEqual(next);
});

it.each([false, true])('rejects effects appearing after final publication (replacement client: %s)', async replacement => {
  const owner = { ...session };
  const first: Job = { ...accepted, state: 'terminal', outputComplete: true, cleanup: 'complete',
    effectBarrier: '2', outcome: { kind: 'exited', exitCode: 0 }, processOutcome: { kind: 'exited', exitCode: 0 },
    jobState: { version: 1, sequence: '4', stage: 'io-settled', retainedUntil: 100000,
      effectBarrier: '2', processOutcome: { kind: 'exited', exitCode: 0 },
      outputComplete: true, cleanup: 'complete' } };
  const next = structuredClone(first);
  next.effectBarrier = next.jobState!.effectBarrier = '3';
  next.jobState!.sequence = '5';
  const replies = [first, next, first];
  const options = { baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(replies.shift(), { headers: { 'Execution-Epoch': owner.epoch } }) };
  const client = createClient(options);
  await expect(client.waitJob(owner, 'job')).resolves.toEqual(first);
  await expect((replacement ? createClient(options) : client).inspectJob(owner, 'job'))
    .rejects.toMatchObject({ category: 'transport', code: 'unrecoverable',
      recovery: { ...owner, jobId: 'job' } });
  await expect(client.inspectJob(owner, 'job')).resolves.toEqual(first);
});

it.each(['unknown-outcome', 'sandbox-lost'] as const)('refuses newly invented native evidence after %s across credential renewal', async stage => {
  const lost: Job = { ...accepted, state: 'terminal', cleanup: 'unknown',
    outcome: { kind: 'unknown', reason: 'Process attachment lost' },
    jobState: { version: 1, sequence: '3', stage, retainedUntil: 100000, effectBarrier: '0', cleanup: 'unknown' } };
  const fabricated = structuredClone(lost);
  fabricated.processOutcome = { kind: 'exited', exitCode: 0 };
  fabricated.jobState!.processOutcome = fabricated.processOutcome;
  fabricated.jobState!.sequence = '4';
  const options = { baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(lost, { headers: { 'Execution-Epoch': session.epoch } }) };
  await expect(createClient(options).inspectJob(session, 'job')).resolves.toEqual(lost);
  await expect(createClient({ ...options, fetch: async () => Response.json(fabricated,
    { headers: { 'Execution-Epoch': session.epoch } }) }).inspectJob(session, 'job'))
    .rejects.toMatchObject({ category: 'transport', code: 'unrecoverable', recovery: { ...session, jobId: 'job' } });
});

it.each(['unknown-outcome', 'sandbox-lost'] as const)('preserves a native exit observed before %s while renewing credentials', async stage => {
  const exited: Job = { ...accepted, state: 'draining', cleanup: 'pending',
    processOutcome: { kind: 'exited', exitCode: 7 },
    jobState: { version: 1, sequence: '3', stage: 'process-exited', retainedUntil: 100000,
      effectBarrier: '0', processOutcome: { kind: 'exited', exitCode: 7 } } };
  const lost: Job = { ...exited, state: 'terminal', cleanup: 'unknown',
    outcome: { kind: 'unknown', reason: 'Output delivery unavailable' },
    jobState: { ...exited.jobState!, sequence: '4', stage, cleanup: 'unknown' } };
  const client = (receipt: Job) => createClient({ baseUrl: 'https://media.test', token: async () => 'renewed-token',
    fetch: async () => Response.json(receipt, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client(exited).inspectJob(session, 'job')).resolves.toEqual(exited);
  await expect(client(lost).inspectJob(session, 'job')).resolves.toEqual(lost);
  expect(lost.outputComplete).toBe(false);
});
