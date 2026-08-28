export function installRetirementObserver(observer, resource, stream) {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'destroy');
  const original = stream.destroy;
  if (typeof original !== 'function' || descriptor && !('value' in descriptor)) throw new Error('unsupported destroy descriptor');
  let intent = null;
  let iteratorCount = 0;
  const wrapped = function (...args) {
    resource.destroyRequested++;
    if (this !== stream) {
      const reason = new Error('borrowed foreign destroy receiver');
      resource.hookIntegrity = false; observer.failure(reason, 'foreign-destroy', resource); throw reason;
    }
    const reason = args[0];
    const token = intent;
    const eligible = token && token.state === 'active' && token.calls === 0 && !stream.destroyed &&
      (token.kind === 'direct-owned-destroy' ? reason === token.expectedReason : resource.ownedOperationPending === 1);
    if (token) token.calls++;
    if (eligible && reason !== null && (typeof reason === 'object' || typeof reason === 'function')) {
      resource.causes.push({ id: resource.causes.length + 1, tokenId: token.id, operationId: token.operationId,
        resourceId: resource.id, reason, reasonId: observer.reasonIdentity(reason),
        classification: token.kind === 'direct-owned-destroy' ? 'direct-exact-owned-argument' : 'source-linked-owned-iterator-return-observation',
        enrolledSequence: observer.trace.length, errorDelivered: false, destroyCall: resource.destroyRequested });
      observer.record('destruction-cause-enrolled-BEFORE-forward');
    }
    observer.record(token ? 'destroy-requested-with-intent' : 'destroy-requested-without-intent');
    try { return Reflect.apply(original, stream, args); }
    finally { observer.record('destroy-returned'); }
  };
  Object.defineProperty(stream, 'destroy', descriptor ? { ...descriptor, value: wrapped } : { value: wrapped, configurable: true, writable: true, enumerable: false });
  const verify = () => {
    const actual = Object.getOwnPropertyDescriptor(stream, 'destroy');
    if (actual?.value !== wrapped || actual.configurable !== (descriptor?.configurable ?? true) ||
        actual.writable !== (descriptor?.writable ?? true) || actual.enumerable !== (descriptor?.enumerable ?? false)) {
      if (resource.hookIntegrity) observer.failure(new Error('owned destroy hook changed'), 'hook-tamper', resource);
      resource.hookIntegrity = false; return false;
    }
    return true;
  };
  const begin = (kind, operationId, expectedReason, iteratorId = null) => {
    if (intent || resource.retirements.length >= 8) throw new Error('retirement admission bound');
    verify();
    const token = { id: resource.retirements.length + 1, kind, operationId, expectedReason, iteratorId,
      resourceId: resource.id, state: 'active', calls: 0, startSequence: observer.trace.length, endSequence: null };
    resource.retirements.push(token); intent = token;
    observer.record('retirement-intent-BEFORE-invocation');
    return token;
  };
  const end = (token, state) => {
    token.state = state; token.endSequence = observer.trace.length; intent = null;
    observer.record('retirement-intent-ended');
  };
  resource.hookReceipt.installed = true;
  return {
    verify,
    destroyOwned(reason) {
      const token = begin('direct-owned-destroy', 'direct-destroy-' + (resource.retirements.length + 1), reason);
      try { return stream.destroy(reason); }
      finally { end(token, 'returned'); }
    },
    iterator() {
      if (++iteratorCount !== 1) throw new Error('one owned iterator per stream');
      const originalIterator = stream[Symbol.asyncIterator]();
      let state = 'new';
      return {
        [Symbol.asyncIterator]() { return this; },
        next(...args) {
          return observer.runOperation(resource, 'reader-next', () => Reflect.apply(originalIterator.next, originalIterator, args)).then(value => {
            state = value.done ? 'complete' : 'yielded'; return value;
          }, reason => { state = 'rejected'; throw reason; });
        },
        return(...args) {
          if (state !== 'yielded') throw new Error('retirement requires known yielded iterator');
          const operation = observer.beginOperation(resource, 'iterator-return');
          const token = begin('iterator-return', operation.id, undefined, 'owned-iterator-1');
          let pending;
          try { pending = Reflect.apply(originalIterator.return, originalIterator, args); }
          catch (reason) {
            end(token, 'rejected'); observer.finishOperation(resource, operation, 'rejected', 'iterator-return', reason); throw reason;
          }
          return Promise.resolve(pending).then(value => {
            end(token, 'returned'); state = 'complete';
            observer.finishOperation(resource, operation, 'fulfilled', 'iterator-return', undefined); return value;
          }, reason => {
            end(token, 'rejected'); state = 'rejected';
            observer.finishOperation(resource, operation, 'rejected', 'iterator-return', reason); throw reason;
          });
        },
      };
    },
    restore() {
      verify();
      if (intent) observer.failure(new Error('retirement still pending at restore'), 'retirement-pending', resource);
      if (descriptor) Object.defineProperty(stream, 'destroy', descriptor);
      else delete stream.destroy;
      const restored = Object.getOwnPropertyDescriptor(stream, 'destroy');
      resource.hookReceipt.destroyRestored = descriptor ? restored?.value === descriptor.value && restored.configurable === descriptor.configurable &&
        restored.enumerable === descriptor.enumerable && restored.writable === descriptor.writable : restored === undefined && stream.destroy === original;
      if (!resource.hookReceipt.destroyRestored) observer.failure(new Error('destroy descriptor restoration failed'), 'restore-failure', resource);
      observer.record('destroy-descriptor-restored');
    },
  };
}
