import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");

export async function collectModelResponseEvents(options) {
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
  for await (const event of options.response.events) collector.consume(event, arena, options);
  return collector.finish(roots);
}
