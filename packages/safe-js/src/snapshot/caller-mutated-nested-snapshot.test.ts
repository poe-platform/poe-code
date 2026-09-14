import { expect, it } from "vitest";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { createSandboxPromise } from "../interp/values.js";

const mutations: Array<{
  name: string;
  key: string;
  create: (get: () => number) => unknown;
}> = [
  {
    name: "object getter",
    key: "extra",
    create: (get) => Object.defineProperty({}, "value", { get, enumerable: true })
  },
  {
    name: "non-enumerable object getter",
    key: "extra",
    create: (get) => Object.defineProperty({}, "value", { get })
  },
  {
    name: "array getter",
    key: "extra",
    create: (get) => Object.defineProperty([0], "0", { get, enumerable: true })
  },
  {
    name: "non-enumerable array getter",
    key: "extra",
    create: (get) => Object.defineProperty([0], "0", { get, enumerable: false })
  },
  {
    name: "frozen Promise lookalike",
    key: "extra",
    create: (get) => Object.freeze(Object.defineProperty({}, "promise", { get, enumerable: true }))
  },
  {
    name: "nested Proxy",
    key: "extra",
    create: (get) =>
      new Proxy(
        {},
        {
          get,
          ownKeys: () => {
            get();
            return [];
          }
        }
      )
  },
  {
    name: "non-enumerable clock getter",
    key: "clock",
    create: (get) => Object.defineProperty({}, "next", { get })
  }
];

it.each(mutations)(
  "rejects a caller-installed $name without host effects",
  async ({ key, create }) => {
    const source = "effect(); return 7;";
    let hostCalls = 0;
    const effect = () => ++hostCalls;
    const result = await run(source, { bindings: { effect } });
    expect(result).toMatchObject({ ok: true, returnValue: 7 });
    expect(hostCalls).toBe(1);
    const previous = Object.getOwnPropertyDescriptor(result.snapshot, key);
    let invocations = 0;
    result.snapshot[key] = create(() => ++invocations);
    hostCalls = 0;
    for (const boundary of [
      () => restore(result.snapshot, { source }),
      () => run(source, { snapshot: result.snapshot, bindings: { effect } })
    ]) {
      let rejected: unknown;
      try {
        await boundary();
      } catch (error) {
        rejected = error;
      }
      expect(invocations).toBe(0);
      expect(hostCalls).toBe(0);
      expect(rejected).toMatchObject({ name: "SnapshotValidationError", code: "invalidType" });
    }
    if (previous) Object.defineProperty(result.snapshot, key, previous);
    else Reflect.deleteProperty(result.snapshot, key);
    const recovered = await run(source, { snapshot: result.snapshot, bindings: { effect } });
    expect(recovered).toMatchObject({ ok: true, returnValue: 7 });
    expect(invocations).toBe(0);
    expect(hostCalls).toBe(0);
  }
);

it("does not consult a caller-modified call method on an engine getter", async () => {
  const source = "return 7;";
  const result = await run(source);
  const promise = createSandboxPromise(Promise.resolve(1));
  const getter = Object.getOwnPropertyDescriptor(promise, "promise")!.get!;
  let invocations = 0;
  Object.defineProperty(getter, "call", {
    configurable: true,
    value: () => {
      invocations++;
      return Reflect.apply(getter, promise, []);
    }
  });
  result.snapshot.extra = promise;
  try {
    expect(() => restore(result.snapshot, { source })).not.toThrow();
    expect(invocations).toBe(0);
  } finally {
    Reflect.deleteProperty(getter, "call");
  }
});

it("replays engine-created module namespaces while rejecting caller Proxy replacements", async () => {
  const source = 'import * as host from "host"; return host.read();';
  let hostCalls = 0;
  const modules = { host: { read: () => ++hostCalls } };
  const result = await run(source, { modules });
  expect(result).toMatchObject({ ok: true, returnValue: 1 });
  expect(() => restore(result.snapshot, { source })).not.toThrow();
  expect(await run(source, { snapshot: result.snapshot, modules }))
    .toMatchObject({ ok: true, returnValue: 1 });
  expect(hostCalls).toBe(1);

  const bindings = result.snapshot.bindings as Record<string, unknown>;
  const namespace = bindings.host;
  let traps = 0;
  bindings.host = new Proxy(namespace as object, {
    ownKeys: target => { traps++; return Reflect.ownKeys(target); },
    get: (target, key) => { traps++; return Reflect.get(target, key); }
  });
  await expect(run(source, { snapshot: result.snapshot, modules }))
    .rejects.toMatchObject({ name: "SnapshotValidationError", code: "invalidType", path: "$.bindings.host" });
  expect(traps).toBe(0);
  expect(hostCalls).toBe(1);
  bindings.host = namespace;
  expect(await run(source, { snapshot: result.snapshot, modules }))
    .toMatchObject({ ok: true, returnValue: 1 });
  expect(hostCalls).toBe(1);
});
