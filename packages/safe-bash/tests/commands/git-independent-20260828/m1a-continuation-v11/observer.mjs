export function createObserver(plan) {
  const contexts = [], resources = [], sessions = [], identities = [];
  const trace = new Uint32Array(plan.eventCap * 4);
  let active, events = 0, invalid = false, overflow = false;
  const id = value => {
    let index = identities.findIndex(item => Object.is(item, value));
    if (index >= 0) return index;
    if (identities.length >= plan.identityCap) { invalid = true; overflow = true; return 0; }
    index = identities.length; identities.push(value); return index;
  };
  const record = (kind, subject, value = undefined, detail = undefined) => {
    if (events >= plan.eventCap) { invalid = true; overflow = true; return; }
    const offset = events++ * 4;
    trace[offset] = kind; trace[offset + 1] = id(subject); trace[offset + 2] = id(value); trace[offset + 3] = id(detail);
  };
  const safe = callback => { try { return callback(); } catch { invalid = true; } };
  const contextFor = context => contexts.find(row => row.context === context);
  const begin = (context, route) => safe(() => {
    if (active || contexts.length >= plan.contextCap) { invalid = true; return; }
    const row = { id: contexts.length, context, route, registrations: [], executeJoined: false, hostJoined: false, hasFailure: false,
      reason: undefined, result: undefined, stderr: '', stdout: '', resources: [] };
    contexts.push(row); active = row; record(1, context, route);
  });
  const registered = (context, callback, wrapped = callback) => safe(() => {
    const row = contextFor(context);
    if (!row || row.registrations.length >= 64) { invalid = true; return; }
    row.registrations.push({ callback, wrapped, called: 0, settled: false, rejected: false, reason: undefined, raw: undefined });
    record(2, context, callback, wrapped);
  });
  const cleanupCall = (context, callback) => safe(() => {
    const registration = contextFor(context)?.registrations.find(row => row.callback === callback);
    if (!registration) { invalid = true; return; }
    registration.called++; record(3, context, callback);
  });
  const executeJoined = (context, result, hasFailure, reason) => safe(() => {
    const row = contextFor(context);
    if (!row) { invalid = true; return; }
    row.executeJoined = true; row.result = result; row.hasFailure = hasFailure; row.reason = reason;
    row.executeSequence = events;
    for (const resource of row.resources) resource.returnIntent = false;
    record(4, context, hasFailure, reason);
  });
  const hostJoined = (context, callbacks, results, stdout, stderr) => safe(() => {
    const row = contextFor(context);
    if (!row) { invalid = true; return; }
    callbacks.forEach((callback, index) => {
      const registration = row.registrations.find(item => item.callback === callback), result = results[index];
      if (!registration || !result || registration.called !== 1) { invalid = true; return; }
      registration.settled = true; registration.rejected = result.status === 'rejected'; registration.reason = result.reason;
      record(registration.rejected ? 6 : 5, context, callback, result.reason);
    });
    row.hostJoined = true; row.stdout = stdout; row.stderr = stderr;
    record(7, context);
    if (active === row) active = undefined; else invalid = true;
  });
  const attach = stream => safe(() => {
    if (!active || resources.length >= plan.streamCap) { invalid = true; return; }
    const resource = { id: resources.length, owner: active, stream, hooks: [], errors: [], causes: [], returnIntent: false,
      nextCalls: 0, returnCalls: 0, writes: 0, callbacks: 0, endRequests: 0, destroys: 0, closeDelivered: false, restored: false };
    resource.closePromise = new Promise(resolve => { resource.resolveClose = resolve; });
    resources.push(resource); active.resources.push(resource); record(10, stream, active.context);
    const wrap = (key, factory) => {
      const descriptor = Object.getOwnPropertyDescriptor(stream, key), original = stream[key];
      if (descriptor && (!('value' in descriptor) || !descriptor.configurable)) { invalid = true; return; }
      const wrapped = factory(original);
      Object.defineProperty(stream, key, { configurable: true, writable: descriptor?.writable ?? true, enumerable: descriptor?.enumerable ?? false, value: wrapped });
      resource.hooks.push({ key, descriptor, original, wrapped });
    };
    const onError = reason => safe(() => {
      if (resource.errors.length >= 8) { invalid = true; overflow = true; return; }
      const owned = resource.causes.some(cause => cause === reason);
      resource.errors.push({ reason, owned, sequence: events, afterExecute: resource.owner.executeJoined });
      record(owned ? 15 : 16, stream, reason);
    });
    const onClose = () => safe(() => { resource.closeDelivered = true; record(17, stream); resource.resolveClose(); });
    resource.onError = onError; resource.onClose = onClose;
    stream.on('error', onError); stream.on('close', onClose);
    wrap('destroy', original => function (...args) {
      safe(() => {
        if (this !== stream || ++resource.destroys > 16) { invalid = true; overflow = true; return; }
        const reason = args[0];
        if (resource.returnIntent && resource.returnDestroys++ === 0 && !stream.destroyed && reason !== null && typeof reason === 'object') {
          resource.causes.push(reason); record(13, stream, reason, resource.iterator);
        }
        record(14, stream, reason);
      });
      return Reflect.apply(original, this, args);
    });
    wrap('write', original => function (...args) {
      safe(() => { if (this !== stream || ++resource.writes > 1048576) invalid = true; });
      const callback = args.at(-1);
      if (typeof callback === 'function') args[args.length - 1] = function (...values) {
        safe(() => { resource.callbacks++; if (resource.callbacks > resource.writes) invalid = true; });
        return Reflect.apply(callback, this, values);
      };
      return Reflect.apply(original, this, args);
    });
    wrap('end', original => function (...args) {
      safe(() => { if (this !== stream || ++resource.endRequests > 4) invalid = true; });
      return Reflect.apply(original, this, args);
    });
    wrap(Symbol.asyncIterator, original => function (...args) {
      if (this !== stream || resource.iterator) invalid = true;
      const iterator = Reflect.apply(original, this, args); resource.iterator = iterator;
      return {
        [Symbol.asyncIterator]() { return this; },
        next(...values) {
          safe(() => { if (++resource.nextCalls > 134217729) invalid = true; });
          return Reflect.apply(iterator.next, iterator, values);
        },
        return(...values) {
          safe(() => {
            if (++resource.returnCalls !== 1 || resource.nextCalls === 0 || resource.owner.executeJoined) invalid = true;
            resource.returnIntent = true; resource.returnDestroys = 0; record(12, stream, iterator);
          });
          const result = Reflect.apply(iterator.return, iterator, values);
          resource.returnPromise = result;
          return result;
        },
      };
    });
  });
  const plugin = original => ({ ...original, setup(host) {
    const commands = new Proxy(host.commands, { get(target, key) {
      if (key === 'register') return function (definition, ...args) {
        if (definition.name !== 'git') return Reflect.apply(target.register, target, [definition, ...args]);
        const wrapped = { ...definition, execute(context) {
          begin(context, 'actual-Shell-definition');
          const row = contextFor(context), descriptor = Object.getOwnPropertyDescriptor(context, 'registerCleanup');
          const originalRegister = context.registerCleanup;
          if (row) row.contextDescriptor = descriptor;
          if (typeof originalRegister === 'function') context.registerCleanup = function (callback) {
            const wrappedCleanup = function (...values) {
              cleanupCall(context, callback);
              const result = Reflect.apply(callback, this, values);
              safe(() => { const registration = row.registrations.find(item => item.callback === callback); registration.raw = result; });
              return result;
            };
            registered(context, callback, wrappedCleanup);
            return Reflect.apply(originalRegister, this, [wrappedCleanup]);
          };
          return Reflect.apply(definition.execute, definition, [context]);
        } };
        return Reflect.apply(target.register, target, [wrapped, ...args]);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return Reflect.apply(original.setup, original, [{ ...host, commands }]);
  } });
  const shellJoined = result => safe(() => {
    for (const row of contexts.filter(item => item.route === 'actual-Shell-definition')) {
      executeJoined(row.context, result, false, undefined);
      for (const registration of row.registrations) {
        if (registration.called !== 1) invalid = true;
        registration.settled = registration.called === 1;
        registration.proof = 'SOURCE_QUALIFIED_SCOPE_AWAIT_THROUGH_SHELL_EXEC';
      }
      row.hostJoined = true; row.stdout = result.stdout; row.stderr = result.stderr; row.shellJoined = true;
      if (row.contextDescriptor) Object.defineProperty(row.context, 'registerCleanup', row.contextDescriptor);
      record(8, row.context); active = undefined;
    }
  });
  const sessionClose = session => {
    safe(() => { if (!sessions.some(row => row.session === session)) invalid = true; record(20, session); });
    return session.operation.close();
  };
  const admitSession = session => {
    safe(() => { if (sessions.length >= 10) invalid = true; else sessions.push({ session, joined: false }); record(19, session); });
    return session;
  };
  const sessionJoined = session => safe(() => {
    const row = sessions.find(item => item.session === session); if (!row) invalid = true; else row.joined = true; record(21, session);
  });
  const verify = () => {
    for (const resource of resources) if (!resource.restored) {
      for (const hook of resource.hooks) {
        const descriptor = Object.getOwnPropertyDescriptor(resource.stream, hook.key);
        if (descriptor?.value !== hook.wrapped || !descriptor.configurable || descriptor.writable !== (hook.descriptor?.writable ?? true) || descriptor.enumerable !== (hook.descriptor?.enumerable ?? false)) invalid = true;
      }
      if (!resource.stream.listeners('error').includes(resource.onError)) invalid = true;
    }
    return !invalid;
  };
  const snapshot = (allowPartial = false) => {
    verify();
    const holds = [];
    if (invalid) holds.push(overflow ? 'observer-capacity-overflow' : 'observer-integrity');
    if (contexts.length > plan.contexts || sessions.length > plan.sessions || !allowPartial && (contexts.length !== plan.contexts || sessions.length !== plan.sessions)) holds.push('route-membership');
    if (sessions.some(row => !row.joined)) holds.push('direct-Session-cleanup-pending');
    for (const row of contexts) {
      if (!row.executeJoined || !row.hostJoined) holds.push('invocation-cleanup-unknown');
      if (row.registrations.some(item => !item.settled || item.rejected)) holds.push('registered-cleanup-not-fulfilled');
      const sourcePrimary = row.result?.exitCode === 128 && row.stderr === 'git: invalid Git zlib object\n' &&
        row.resources.filter(resource => resource.errors.some(error => !error.owned)).length === 1;
      for (const resource of row.resources) {
        if (resource.stream.closed !== true || resource.stream.destroyed !== true) holds.push('resource-state-not-closed');
        if (!resource.closeDelivered) holds.push('notification-pending');
        for (const error of resource.errors) {
          error.sourceQualified = !error.owned && sourcePrimary && resource.errors.length === 1 && !error.afterExecute &&
            error.reason !== null && typeof error.reason === 'object' && row.executeJoined && row.hostJoined;
          if (!error.owned && !error.sourceQualified) holds.push('unowned-error');
        }
      }
    }
    return { verdict: holds.length ? 'HOLD' : 'PASS', holds: [...new Set(holds)], events, overflow, valid: !invalid,
      contexts: contexts.map(row => ({ id: row.id, route: row.route, executeJoined: row.executeJoined, hostJoined: row.hostJoined,
        hasFailure: row.hasFailure, reasonId: id(row.reason), registrations: row.registrations.map(item => ({ callbackId: id(item.callback), wrappedId: id(item.wrapped),
          calls: item.called, settled: item.settled, rejected: item.rejected, reasonId: id(item.reason), proof: item.proof ?? 'DIRECT_EXISTING_ALLSETTLED' })),
        privateWriter: row.resources.length ? 'SOURCE_LINKED_CONDITIONAL_JOIN: codec finally -> repository/query -> execute -> registered cleanup' : 'NOT_ADMITTED_NO_INFLATER',
        resources: row.resources.map(resource => resource.id) })),
      directSessions: sessions.map(row => ({ joined: row.joined })),
      resources: resources.map(resource => ({ id: resource.id, owner: resource.owner.id, closed: resource.stream.closed, destroyed: resource.stream.destroyed,
        closeDelivered: resource.closeDelivered, destroys: resource.destroys, writes: resource.writes, callbacks: resource.callbacks,
        rawCallbacksPendingDiagnostic: resource.writes - resource.callbacks, nextCalls: resource.nextCalls, returnCalls: resource.returnCalls,
        causes: resource.causes.map(id), errors: resource.errors.map(error => ({ reasonId: id(error.reason), owned: error.owned, sourceQualified: error.sourceQualified ?? false,
          afterExecute: error.afterExecute, sequence: error.sequence })) })) };
  };
  const restore = () => {
    verify();
    for (const resource of resources) {
      for (const hook of resource.hooks) {
        if (hook.descriptor) Object.defineProperty(resource.stream, hook.key, hook.descriptor); else delete resource.stream[hook.key];
      }
      resource.stream.removeListener('error', resource.onError); resource.stream.removeListener('close', resource.onClose); resource.restored = true;
    }
    return { restored: resources.length, valid: !invalid };
  };
  return Object.freeze({ begin, registered, cleanupCall, executeJoined, hostJoined, attach, plugin, shellJoined, admitSession, sessionClose, sessionJoined,
    snapshot, verify, restore, barrier: () => Promise.all(resources.map(resource => resource.closePromise)),
    emergency: () => { for (const resource of resources) if (!resource.stream.destroyed) resource.stream.destroy(); },
    trace: () => ({ format: 'Uint32LE-kind-subject-value-detail', count: events, base64: Buffer.from(trace.buffer, 0, events * 16).toString('base64'), identityCount: identities.length }) });
}
