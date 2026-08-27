import assert from 'node:assert/strict';

export function bindDeclaredOperation(factory, context, destination) {
  assert.equal(typeof factory, 'function');
  const operation = factory(context, destination);
  assert.ok(operation.signal instanceof AbortSignal);
  assert.equal(typeof operation.output?.write, 'function');
  assert.equal(typeof operation.registerCleanup, 'function');
  assert.equal(typeof operation.acquire, 'function');
  assert.equal(typeof operation.close, 'function');
  return operation;
}

export async function runLocalSeparationProbe(factory, context, state) {
  const operation = bindDeclaredOperation(factory, context, context.stdout);
  state.operation = operation;
  state.trace.record('operation.enrolled');
  let releasePromise;
  let rejectRead;
  const onAbort = () => {
    state.stageAbortedAtClose = context.signal.aborted;
    state.callerAbortedAtClose = state.callerSignal.aborted;
    state.trace.record('operation.aborted');
    rejectRead?.(operation.signal.reason);
  };
  const release = () => {
    releasePromise ??= Promise.resolve().then(() => {
      state.returned += 1;
      state.active = 0;
      operation.signal.removeEventListener('abort', onAbort);
      state.trace.record('source.returned');
    });
    return releasePromise;
  };
  try {
    const source = await operation.acquire(() => ({
      next() {
        operation.signal.throwIfAborted();
        state.started += 1;
        state.active += 1;
        state.trace.record('source.started');
        const pending = new Promise((resolve, reject) => {
          rejectRead = reject;
          operation.signal.addEventListener('abort', onAbort, { once: true });
        });
        state.startedBarrier.resolve();
        return pending;
      },
    }), release);
    await source.next();
    assert.fail('Pending first read must terminate via owned cancellation');
  } catch (error) {
    assert.equal(error, operation.signal.reason);
    assert.equal(error?.code, 'EPIPE');
    assert.equal(context.signal.aborted, false);
    assert.equal(state.callerSignal.aborted, false);
    await state.afterCancel(context);
    state.stageEffectAfterCancel = true;
    state.trace.record('independent.effect');
    return { exitCode: 0 };
  } finally {
    await operation.close();
    state.trace.record('cleanup.completed');
  }
}
