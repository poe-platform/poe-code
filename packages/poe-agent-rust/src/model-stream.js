import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");

export async function collectModelResponseEvents(options) {
  let response = options.response;
  for (let attempt = 1; ; attempt++) {
    if (response.retry) options.emit?.({ type: "model.attempt.start", attempt });
    try {
      return await collectAttempt(options, response, attempt);
    } catch (error) {
      if (!response.retry) throw error;
      response = await response.retry(error);
    }
  }
}

async function collectAttempt(options, response, attempt) {
  const collector = new native.NativeAgentModelCollector(),
    roots = [];
  let free;
  const store = (value) => {
    const handle = free === undefined ? roots.length : free.handle;
    if (free !== undefined) free = free.next;
    Object.defineProperty(roots, handle, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
    return handle;
  };
  const retire = (handle) => {
    delete roots[handle];
    free = { handle, next: free };
  };
  const parse = (source) => {
    try {
      return store(JSON.parse(source));
    } catch {
      return null;
    }
  };
  const arena = { roots, store, parse, retire };
  try {
    for await (const event of response.events) collector.consume(event, arena, options);
  } catch (error) {
    if (response.retry) {
      const { usage } = collector.finish(roots);
      if (usage) options.emit?.({ type: "usage", usage, attempt });
      options.emit?.({ type: "model.attempt.failed", attempt, error });
    }
    throw error;
  }
  return collector.finish(roots);
}
