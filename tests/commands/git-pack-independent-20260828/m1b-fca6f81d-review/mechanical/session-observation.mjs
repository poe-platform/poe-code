export async function openSession(api) {
  const controller = new AbortController();
  const hooks = [];
  let session;
  let completion;
  let cleanupCalls = 0;
  const relay = () => controller.abort(api.signal.reason);
  const close = () => completion ??= (async () => {
    try {
      if (session) {
        cleanupCalls++;
        await session.operation.close();
        session.finish();
      }
    } finally {
      api.signal.removeEventListener("abort", relay);
    }
  })();
  api.registerCleanup(close);
  if (api.signal.aborted) relay();
  else api.signal.addEventListener("abort", relay, { once: true });
  const { Session } = await api.load("dist/commands/git/io.js");
  const output = [];
  const context = {
    signal: controller.signal,
    stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
    registerCleanup(callback) { hooks.push(callback); },
  };
  session = new Session(context, "/");
  return {
    session, controller, hooks, output,
    async closeObservation() {
      let failed = false;
      let reason;
      try { await close(); } catch (error) { failed = true; reason = error; }
      return { failed, reason, cleanupCalls, registeredHooks: hooks.length };
    },
  };
}

export function observeReservations(session) {
  const events = [];
  const originals = new Map();
  let nextOwner = 0;
  const owners = new WeakMap();
  const owner = bytes => {
    if (!owners.has(bytes)) owners.set(bytes, ++nextOwner);
    return owners.get(bytes);
  };
  const install = (name, wrapper) => {
    const descriptor = Object.getOwnPropertyDescriptor(session, name);
    if (descriptor !== undefined) throw new Error("Unexpected own Session method");
    const original = session[name];
    originals.set(name, { descriptor, original });
    Object.defineProperty(session, name, { configurable: true, writable: true, value: wrapper(original) });
  };
  const append = record => {
    if (events.length >= 128) throw new Error("Mechanical observation event cap");
    events.push(record);
  };
  install("reserve", original => function (size) {
    append({ event: "reserve-enter", size });
    const result = Reflect.apply(original, this, [size]);
    append({ event: "reserve-return", size });
    return result;
  });
  install("unreserve", original => function (size) {
    append({ event: "unreserve", size });
    return Reflect.apply(original, this, [size]);
  });
  install("allocate", original => function (size) {
    append({ event: "allocate-enter", size });
    const bytes = Reflect.apply(original, this, [size]);
    append({ event: "allocate-return", size, owner: owner(bytes) });
    return bytes;
  });
  install("release", original => function (bytes) {
    append({ event: "release", owner: owner(bytes), size: bytes.length });
    return Reflect.apply(original, this, [bytes]);
  });
  return {
    events,
    restore() {
      for (const [name, saved] of originals) {
        if (saved.descriptor === undefined) delete session[name];
        else Object.defineProperty(session, name, saved.descriptor);
      }
    },
  };
}

export function reasonFacts(failed, actual, expected) {
  return {
    failed,
    sameReasonInWorker: failed && Object.is(actual, expected),
    actualType: actual === null ? "null" : typeof actual,
    expectedType: expected === null ? "null" : typeof expected,
  };
}
