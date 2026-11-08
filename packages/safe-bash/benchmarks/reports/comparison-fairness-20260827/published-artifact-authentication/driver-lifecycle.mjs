export function requestObservation({ child, identity, recipe, recipeSha256, baseUrl, emit, signal, clock = globalThis, startupMs = 15000, requestMs = 10000 }) {
  let state = 'starting', timer, requestAttempted = false, completed = false, resolveResult, rejectResult;
  const promise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const record = entry => emit({ ...identity, ...entry });
  const clear = () => { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; };
  function finish(kind, detail, response) {
    if (completed) return;
    completed = true; clear();
    const previousState = state; state = kind === 'response' ? 'settled' : 'closing';
    signal?.removeEventListener('abort', abort);
    record({ event: requestAttempted ? 'request-settlement' : 'startup-settlement', kind, previousState, detail, observationReceived: Boolean(response?.observation) });
    if (kind === 'response') resolveResult(response);
    else rejectResult(new Error(`${kind}: ${detail}`));
  }
  const abort = () => finish('aborted', String(signal.reason ?? 'coordinator closing'));
  timer = clock.setTimeout(() => finish('startup-timeout', 'ready deadline'), startupMs);
  child.on('error', error => { record({ event: 'child-error', state, error: String(error) }); finish('child-error', String(error)); });
  child.on('exit', (code, childSignal) => { record({ event: 'child-exit', state, code, signal: childSignal }); finish('child-exit', `${code}/${childSignal}`); });
  child.on('message', message => {
    if (completed || state === 'closing' || state === 'closed') { record({ event: 'late-message-ignored', state, id: message?.id ?? null, ready: message?.ready ?? null, message, observation: Boolean(message?.observation) }); return; }
    if (state === 'starting') {
      if (message?.ready !== true) { finish('startup-error', String(message?.error ?? 'unexpected startup message')); return; }
      clear(); record({ event: 'ready-received', entryImportFulfilledByEngineProtocol: true });
      if (completed || signal?.aborted) return;
      record({ event: 'startup-settlement', kind: 'ready', observationReceived: false });
      if (completed || signal?.aborted) return;
      state = 'requested'; requestAttempted = true;
      timer = clock.setTimeout(() => finish('request-timeout', 'observation deadline'), requestMs);
      record({ event: 'request-dispatch-intent', recipeSha256, instrument: true, warmup: 0 });
      if (completed || signal?.aborted) { record({ event: 'request-send-suppressed', reason: 'closing during event publication' }); return; }
      try {
        const accepted = child.send({ id: identity.requestId, specimen: recipe, baseUrl, instrument: true, warmup: 0 }, error => {
          record({ event: 'request-send-callback', state, success: !error, error: error ? String(error) : null });
          if (error) finish('send-error', String(error));
        });
        record({ event: 'request-send-called', recipeSha256, instrument: true, warmup: 0 });
        record({ event: 'request-send-returned', backpressureAccept: accepted });
      } catch (error) { record({ event: 'request-send-called', recipeSha256, instrument: true, warmup: 0 }); record({ event: 'request-send-threw', error: String(error) }); finish('send-error', String(error)); }
    } else if (state === 'requested' && message?.id === identity.requestId) {
      record({ event: 'response-received', observation: Boolean(message.observation), response: message });
      finish('response', message.error ?? null, message);
    } else record({ event: 'unexpected-message', state, id: message?.id ?? null });
  });
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  return {
    promise,
    beginClosing(reason = 'routine post-settlement cleanup') {
      if (!completed) finish('closing', reason);
      state = 'closing'; clear(); record({ event: 'closing-fence', reason });
    },
    markClosed() { state = 'closed'; record({ event: 'closed-fence' }); },
    state: () => state,
  };
}
export async function boundedStep(operation, milliseconds) {
  let timer;
  const pending = Promise.resolve().then(operation);
  try { return await Promise.race([pending, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('bounded step deadline')), milliseconds); })]); }
  finally { clearTimeout(timer); pending.catch(() => {}); }
}
export async function finalizeSteps(steps, emit, milliseconds = 2500) {
  const results = [];
  for (const [name, operation] of steps) {
    emit({ event: 'finalization-attempt', name });
    try { const value = await boundedStep(operation, milliseconds); results.push({ name, success: true, value }); emit({ event: 'finalization-settlement', name, success: true }); }
    catch (error) { results.push({ name, success: false, error: String(error) }); emit({ event: 'finalization-settlement', name, success: false, error: String(error) }); }
  }
  return results;
}
export function accounting(events) {
  const count = (event, predicate = () => true) => events.filter(row => row.event === event && predicate(row)).length;
  return {
    workerLaunchAttempts: count('child-launch-attempt'), launchedChildren: count('child-launched'),
    requestDispatchIntents: count('request-dispatch-intent'), requestSendCalls: count('request-send-called'), requestSendReturns: count('request-send-returned'), requestSendThrows: count('request-send-threw'),
    successfulSendCallbacks: count('request-send-callback', row => row.success),
    failedSendCallbacks: count('request-send-callback', row => !row.success),
    requestSettlements: count('request-settlement'), startupSettlements: count('startup-settlement'),
    responseObservations: count('response-received', row => row.observation),
    lateObservations: count('late-message-ignored', row => row.observation),
    timeoutSettlements: count('request-settlement', row => row.kind.endsWith('timeout')) + count('startup-settlement', row => row.kind.endsWith('timeout')),
    ignoredLateMessages: count('late-message-ignored'), cleanupSignals: count('cleanup-signal'),
    note: 'Local send attempts/returns/flush callbacks are separate from response observations; none alone proves guest execution. Counts come from events, not run-return snapshots.',
  };
}
