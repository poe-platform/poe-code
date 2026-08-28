export function createAdapter({ capacity = 8192, identities = 1024, streamLimit = 32 } = {}) {
  const events = new Array(capacity);
  const first = new Array(capacity);
  const second = new Array(capacity);
  const third = new Array(capacity);
  const references = new Array(identities);
  const resources = [];
  const shellRoutes = [];
  let activeShell;
  let count = 0, referenceCount = 0, invalid = false, overflow = false;
  const identity = value => {
    for (let index = 0; index < referenceCount; index++) if (Object.is(references[index], value)) return index;
    if (referenceCount === identities) { invalid = true; overflow = true; return -1; }
    references[referenceCount] = value;
    return referenceCount++;
  };
  const record = (event, subject, value, detail) => {
    if (count === capacity) { invalid = true; overflow = true; return; }
    events[count] = event;
    first[count] = identity(subject);
    second[count] = identity(value);
    third[count] = identity(detail);
    count++;
  };
  const resourceFor = stream => resources.find(resource => resource.stream === stream);
  const attach = (context, stream) => {
    if (resources.length === streamLimit || resourceFor(stream)) { invalid = true; return; }
    const destroyDescriptor = Object.getOwnPropertyDescriptor(stream, 'destroy');
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator);
    const originalDestroy = stream.destroy;
    const originalFactory = stream[Symbol.asyncIterator];
    const resource = { context, stream, destroyDescriptor, iteratorDescriptor, originalDestroy, originalFactory,
      token: null, iterator: null, pendingNext: false, yielded: false, causes: [], errors: [], closed: false, restored: false };
    resources.push(resource);
    if (typeof originalDestroy !== 'function' || typeof originalFactory !== 'function' ||
        destroyDescriptor && (!('value' in destroyDescriptor) || !destroyDescriptor.configurable) ||
        iteratorDescriptor && (!('value' in iteratorDescriptor) || !iteratorDescriptor.configurable)) { invalid = true; return; }
    resource.destroy = function (...args) {
      if (this !== stream) { invalid = true; return Reflect.apply(originalDestroy, this, args); }
      const token = resource.token;
      const reason = args[0];
      if (token && token.calls++ === 0 && !resource.pendingNext && !stream.destroyed &&
          reason !== null && (typeof reason === 'object' || typeof reason === 'function')) {
        if (resource.causes.length === 8) invalid = true;
        else resource.causes.push(reason);
        record('cause-before-forward', stream, reason, token.iterator);
      }
      record('destroy-call', stream, reason, token?.iterator);
      return Reflect.apply(originalDestroy, stream, args);
    };
    resource.factory = function (...args) {
      if (this !== stream || resource.iterator) { invalid = true; return Reflect.apply(originalFactory, this, args); }
      const iterator = Reflect.apply(originalFactory, stream, args);
      resource.iterator = iterator;
      record('iterator-created', stream, iterator);
      return {
        [Symbol.asyncIterator]() { return this; },
        next(...values) {
          if (resource.pendingNext || resource.token) invalid = true;
          resource.pendingNext = true;
          record('next-called', stream, iterator);
          return Reflect.apply(iterator.next, iterator, values);
        },
        return(...values) {
          if (!resource.yielded || resource.pendingNext || resource.token) invalid = true;
          else resource.token = { iterator, calls: 0 };
          record('return-intent-before-forward', stream, iterator);
          return Reflect.apply(iterator.return, iterator, values);
        },
      };
    };
    resource.onError = reason => {
      const owned = resource.causes.some(cause => cause === reason);
      if (resource.errors.length === 32) invalid = true;
      else resource.errors.push({ reason, owned, sequence: count });
      record(owned ? 'owned-error' : 'unowned-error', stream, reason);
    };
    resource.onClose = () => { resource.closed = true; record('close-delivered', stream); };
    stream.on('error', resource.onError);
    stream.on('close', resource.onClose);
    Object.defineProperty(stream, 'destroy', { configurable: true, writable: destroyDescriptor?.writable ?? true, enumerable: destroyDescriptor?.enumerable ?? false, value: resource.destroy });
    Object.defineProperty(stream, Symbol.asyncIterator, { configurable: true, writable: iteratorDescriptor?.writable ?? true, enumerable: iteratorDescriptor?.enumerable ?? false, value: resource.factory });
    record('stream-attached', context, stream);
  };
  const probe = (event, subject, value, detail) => {
    try {
      record(event, subject, value, detail);
      if (event === 'shell-exec-start') {
        if (activeShell !== undefined) invalid = true;
        activeShell = subject;
      }
      if (event === 'shell-route') {
        if (activeShell === undefined || shellRoutes.length === 32) invalid = true;
        else shellRoutes.push({ context: subject, shell: activeShell });
      }
      if (event === 'shell-dispose-joined') {
        if (subject !== activeShell) invalid = true;
        for (const route of shellRoutes.filter(route => route.shell === subject)) record('host-boundary', route.context);
        activeShell = undefined;
      }
      if (event === 'stream-created') attach(subject, value);
      const resource = resourceFor(subject);
      if (resource && (event === 'reader-yield' || event === 'reader-done')) {
        resource.pendingNext = false; resource.yielded = event === 'reader-yield';
      }
      if (resource && event === 'codec-finalizer-enter') {
        record('source-linked-iterator-await-ended', subject, resource.token?.iterator);
        resource.token = null; resource.pendingNext = false;
      }
      if (event === 'execute-joined' || event === 'host-boundary') {
        for (const owned of resources.filter(item => item.context === subject)) record('resource-at-' + event, owned.stream,
          (owned.stream.closed === true ? 1 : 0) | (owned.stream.destroyed === true ? 2 : 0) | (owned.closed ? 4 : 0));
      }
    } catch { invalid = true; }
  };
  const rows = () => Array.from({ length: count }, (_, index) => ({ sequence: index, event: events[index],
    subject: first[index], value: second[index], detail: third[index] }));
  const verify = () => {
    for (const resource of resources) {
      if (resource.restored) continue;
      const destroy = Object.getOwnPropertyDescriptor(resource.stream, 'destroy');
      const factory = Object.getOwnPropertyDescriptor(resource.stream, Symbol.asyncIterator);
      if (destroy?.value !== resource.destroy || factory?.value !== resource.factory ||
          destroy.configurable !== true || factory.configurable !== true ||
          destroy.writable !== (resource.destroyDescriptor?.writable ?? true) ||
          factory.writable !== (resource.iteratorDescriptor?.writable ?? true) ||
          destroy.enumerable !== (resource.destroyDescriptor?.enumerable ?? false) ||
          factory.enumerable !== (resource.iteratorDescriptor?.enumerable ?? false)) invalid = true;
    }
    return !invalid;
  };
  const inspect = context => {
    verify();
    const captured = rows();
    const subjectRows = subject => captured.filter(row => row.subject === identity(subject));
    const has = (subject, event) => subjectRows(subject).some(row => row.event === event);
    const holds = [];
    if (invalid) holds.push(overflow ? 'trace-overflow' : 'integrity');
    if (!has(context, 'execute-joined')) holds.push('execute-not-joined');
    if (!has(context, 'host-boundary')) holds.push('host-boundary-missing');
    for (const row of subjectRows(context).filter(row => row.event === 'output-open')) {
      const callback = references[row.value];
      if (!has(callback, 'output-close-joined') || !has(context, 'internal-cleanup-fulfilled')) holds.push('output-cleanup-pending');
    }
    if (has(context, 'internal-cleanup-rejected')) holds.push('internal-cleanup-rejected');
    const routes = subjectRows(context).filter(row => row.event === 'shell-route');
    for (const route of shellRoutes.filter(route => route.context === context)) {
      if (!has(route.shell, 'shell-exec-joined') || !has(route.shell, 'shell-dispose-joined')) holds.push('shell-boundary-pending');
    }
    const registrations = captured.filter(row => row.event === 'host-registered' && row.subject === identity(context) ||
      row.event === 'scope-registered' && routes.some(route => route.value === row.subject));
    for (const row of registrations) {
      const callback = references[row.value];
      if (!has(callback, 'cleanup-fulfilled')) holds.push('registered-cleanup-pending');
      if (has(callback, 'cleanup-rejected')) holds.push('cleanup-rejected');
    }
    for (const row of subjectRows(context).filter(row => row.event === 'hook-present')) {
      if (!registrations.some(registration => registration.value === row.value)) holds.push('hook-not-forwarded');
    }
    for (const resource of resources.filter(resource => resource.context === context)) {
      if (resource.stream.closed !== true || resource.stream.destroyed !== true) holds.push('resource-not-closed');
      if (!resource.closed) holds.push('notification-pending');
      const started = subjectRows(resource.stream).find(row => row.event === 'writer-start');
      if (started && !subjectRows(resource.stream).some(row => row.event === 'writer-joined' && row.value === started.value)) holds.push('private-writer-not-joined');
      if (has(resource.stream, 'codec-acquired') && !has(resource.stream, 'codec-finalizer-joined')) holds.push('codec-finalizer-pending');
      const mapping = subjectRows(resource.stream).find(row => row.event === 'codec-primary-mapped');
      const boundary = subjectRows(context).find(row => row.event === 'execute-joined');
      if (resource.errors.some(error => !error.owned && !(mapping && boundary && mapping.sequence < boundary.sequence &&
          error.sequence < mapping.sequence && error.reason === references[mapping.value]))) holds.push('unowned-error');
    }
    return { verdict: holds.length ? 'HOLD' : 'PASS', holds, events: captured, identityCount: referenceCount, streams: resources.length };
  };
  const restore = () => {
    verify();
    for (const resource of resources) {
      try {
        if (resource.destroyDescriptor) Object.defineProperty(resource.stream, 'destroy', resource.destroyDescriptor);
        else delete resource.stream.destroy;
        if (resource.iteratorDescriptor) Object.defineProperty(resource.stream, Symbol.asyncIterator, resource.iteratorDescriptor);
        else delete resource.stream[Symbol.asyncIterator];
        resource.stream.removeListener('error', resource.onError);
        resource.stream.removeListener('close', resource.onClose);
        resource.restored = true;
      } catch { invalid = true; }
    }
    return { valid: !invalid, restored: resources.every(resource => resource.restored), overflow, count };
  };
  return Object.freeze({ probe, inspect, verify, restore, rows });
}

export function bindProbe(adapter, target = globalThis) {
  const key = '__gitAdapterV9';
  const original = Object.getOwnPropertyDescriptor(target, key);
  if (original) throw new Error('probe binding already exists');
  Object.defineProperty(target, key, { value: adapter.probe, configurable: true, writable: false, enumerable: false });
  return Object.freeze({
    verify() {
      const actual = Object.getOwnPropertyDescriptor(target, key);
      return actual?.value === adapter.probe && actual.configurable === true && actual.writable === false && actual.enumerable === false;
    },
    restore() { delete target[key]; },
  });
}
