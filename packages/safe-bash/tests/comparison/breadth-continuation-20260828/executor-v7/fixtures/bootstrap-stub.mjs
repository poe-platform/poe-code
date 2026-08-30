let saved;
export function consume(host, extra) {
  const detached = host.getBuiltinModule;
  saved = detached;
  const first = detached('module');
  const second = detached('worker_threads');
  if (extra) { try { detached('module'); } catch {} }
  return { bothUndefined: first === undefined && second === undefined };
}
export function later() { try { saved('module'); } catch {} }
