import { requireThat } from './safety.mjs';

export function instrumentFilesystem(filesystem, events, phase) {
  const wrapped = new Map();
  const observe = new Set(['stat', 'lstat', 'access', 'readFile', 'readFileBuffer', 'readFileStream', 'read']);
  return new Proxy(filesystem, { get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    if (!observe.has(name)) {
      if (!wrapped.has(name)) wrapped.set(name, value.bind(target));
      return wrapped.get(name);
    }
    if (!wrapped.has(name)) wrapped.set(name, async (...args) => {
      const watched = phase() === 'semantic' && observe.has(name) && args[0] === '/fixture/bin/tool';
      let event;
      if (watched) {
        requireThat(events.length < 256, 'W07_OBSERVER_CAP', name);
        event = { method: name, path: args[0], mode: typeof args[1] === 'number' ? args[1] : null, outcome: 'pending' };
        events.push(event);
      }
      try { const result = await Reflect.apply(value, target, args); if (event) event.outcome = 'returned'; return result; }
      catch (error) { if (event) event.outcome = 'rejected'; throw error; }
    });
    return wrapped.get(name);
  } });
}
export function assessWhich(events, dispatches, before, after, engine) {
  const initial = before.entries.find(entry => entry.path === '/fixture/bin/tool');
  const final = after.entries.find(entry => entry.path === '/fixture/bin/tool');
  const reads = events.filter(event => event.method.startsWith('read'));
  const stat = events.some(event => ['stat', 'lstat'].includes(event.method) && event.outcome === 'returned');
  const access = events.some(event => event.method === 'access' && event.mode === 1 && event.outcome === 'returned');
  const dispatchObservable = engine === 'virtual-bash';
  return {
    observations: {
      'No fixture executable is executed': dispatchObservable && !dispatches.some(event => event.command === 'tool' || event.command === '/fixture/bin/tool') && reads.length === 0,
      'Memory stat/access checks, not registry name synthesis': stat && access,
      'Initial permission bits 0755 retained': (initial?.mode & 0o7777) === 0o755 && (final?.mode & 0o7777) === 0o755,
    },
    receipt: { events, dispatchObservable, dispatches, limitation: dispatchObservable ? null : 'Comparator public dispatch is unobservable; no-execution predicate not credited from stdout alone.' },
  };
}
