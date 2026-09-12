import { AsyncLocalStorage, createHook } from "node:async_hooks";
import { expect, it, vi } from "vitest";
import { admitNativePromiseProperties, createRealm, dump, restore, run } from "../index.js";
import { deepCopyToSandbox, getPromiseProperties, type SandboxPromise } from "./values.js";

it.each([Symbol("kResourceStore"), Symbol.for("async_id_symbol"), Symbol.toStringTag])("admits the exact caller symbol %s with its descriptor", key => {
  const input = Promise.resolve(7);
  Object.defineProperty(input, key, { value: 42, enumerable: true });
  expect(admitNativePromiseProperties(input, [key])).toBe(input);
  const properties = getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise);
  expect(Reflect.ownKeys(properties)).toEqual([key]);
  expect(Object.getOwnPropertyDescriptor(properties, key)).toEqual(Object.getOwnPropertyDescriptor(input, key));
});

it("keeps active and retired async contexts private independently of user admission", () => {
  const first = new AsyncLocalStorage();
  const second = new AsyncLocalStorage();
  const hook = createHook({ init() {} }).enable();
  const key = Symbol("kResourceStore");
  try {
    const input = first.run({ secret: 1 }, () => second.run({ secret: 2 }, () => Promise.resolve(7)));
    const privateKeys = Object.getOwnPropertySymbols(input);
    expect(privateKeys.length).toBeGreaterThan(0);
    Object.defineProperty(input, key, { value: 42 });
    for (const retired of [false, true]) {
      if (retired) { first.disable(); second.disable(); }
      const plain = Promise.resolve(1);
      expect(Reflect.ownKeys(getPromiseProperties(deepCopyToSandbox(plain) as SandboxPromise))).toEqual([]);
      admitNativePromiseProperties(input, [key]);
      const properties = getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise);
      expect(Reflect.ownKeys(properties)).toEqual([key]);
      for (const privateKey of privateKeys) expect(Object.hasOwn(properties, privateKey)).toBe(false);
    }
  } finally { first.disable(); second.disable(); hook.disable(); }
});

it("validates admission atomically and never invokes accessors, including later replacements", () => {
  const input = Promise.resolve(7);
  const data = Symbol("data"), accessor = Symbol("accessor");
  const getter = vi.fn(() => 1);
  Object.defineProperty(input, data, { value: 42, configurable: true });
  Object.defineProperty(input, accessor, { get: getter });
  expect(() => admitNativePromiseProperties(input, [data, accessor])).toThrow(TypeError);
  expect(Reflect.ownKeys(getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise))).toEqual([]);
  admitNativePromiseProperties(input, [data]);
  Object.defineProperty(input, data, { get: getter });
  expect(() => deepCopyToSandbox(input)).toThrow(TypeError);
  expect(getter).not.toHaveBeenCalled();
});

it.each(["binding", "host", "realm"])("preserves admitted graphs through %s", async surface => {
  const key = Symbol("data"), alias = Symbol.for("alias");
  const hook = createHook({ init() {} }).enable();
  const input = Promise.resolve(7);
  hook.disable();
  const shared = { count: 1, self: input };
  Object.defineProperty(input, key, { value: shared });
  Object.defineProperty(input, alias, { value: shared });
  admitNativePromiseProperties(input, [key, alias]);
  Object.preventExtensions(input);
  const expression = `const keys = Object.getOwnPropertySymbols(input); return [keys.length, input[keys[0]] === input[keys[1]], input[keys[0]].self === input, Object.isExtensible(input), Object.getOwnPropertyDescriptor(input, keys[0]).writable, await input];`;
  if (surface === "realm") {
    const realm = createRealm({ bindings: { input } });
    try {
      expect(await realm.evaluate(expression)).toMatchObject({ ok: true, returnValue: [2, true, true, false, false, 7] });
      expect(await realm.evaluate("return Object.getOwnPropertySymbols(input).length")).toMatchObject({ ok: true, returnValue: 2 });
    } finally { await realm.close(); }
  } else {
    const source = (surface === "host" ? "const input = (await load()).input; " : "") + expression;
    const bindings = surface === "host" ? { load: () => ({ input }) } : { input };
    const result = await run(source, { bindings });
    expect(result).toMatchObject({ ok: true, returnValue: [2, true, true, false, false, 7] });
    const replay = await run(source, { bindings, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(replay).toMatchObject({ ok: true, returnValue: [2, true, true, false, false, 7] });
  }
});

it.each(["binding", "host"])("keeps equal-description callable properties distinct through %s replay", async surface => {
  const input = Promise.resolve(7);
  const keys = [Symbol("same"), Symbol("same")];
  const first = () => 1, second = () => 2;
  Object.defineProperty(input, keys[0]!, { value: first });
  Object.defineProperty(input, keys[1]!, { value: second });
  admitNativePromiseProperties(input, keys);
  const source = (surface === "host" ? "const input = (await load()).input; " : "") + "const keys = Object.getOwnPropertySymbols(input); return [input[keys[0]](), input[keys[1]](), await input]";
  const bindings = surface === "host" ? { first, second, load: () => ({ input }) } : { input };
  const original = await run(source, { bindings });
  expect(original).toMatchObject({ ok: true, returnValue: [1, 2, 7] });
  const replay = await run(source, { bindings, snapshot: restore(JSON.parse(await dump(original)), { source }) });
  expect(replay).toMatchObject({ ok: true, returnValue: [1, 2, 7] });
});

it.each([{ surface: "binding", rejects: false }, { surface: "binding", rejects: true }, { surface: "host", rejects: false }, { surface: "host", rejects: true }])("preserves symbol properties through pending and completed replay: %j", async ({ surface, rejects }) => {
  let settle!: (value: number) => void;
  const input = new Promise<number>((resolve, reject) => { settle = rejects ? reject : resolve; });
  const key = Symbol("data");
  Object.defineProperty(input, key, { value: 42, writable: true });
  admitNativePromiseProperties(input, [key]);
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const source = (surface === "host" ? "const input = (await load()).input; " : "") + "const key = Object.getOwnPropertySymbols(input)[0]; mark(); let value; try { value = await input; } catch (error) { value = Number(error.message ?? error); } return [input[key], value]";
  const load = () => ({ input });
  const task = run(source, { bindings: surface === "host" ? { load, mark: entered } : { input, mark: entered } });
  try {
    await ready;
    await task.pause();
    const pending = restore(JSON.parse(await dump(task)), { source });
    const replay = await run(source, { snapshot: pending, bindings: { load, mark: () => {} },
      hostCallResumeProvider: request => ({ ...request, outcome: rejects ? { status: "rejected", reason: 9 } : { status: "fulfilled", value: 9 } }) });
    expect(replay).toMatchObject({ ok: true, returnValue: [42, 9] });
    settle(7);
    task.resume();
    const original = await task;
    expect(original).toMatchObject({ ok: true, returnValue: [42, 7] });
    const completed = await run(source, { bindings: { load, mark: () => {} }, snapshot: restore(JSON.parse(await dump(original)), { source }) });
    expect(completed).toMatchObject({ ok: true, returnValue: [42, 7] });
  } finally {
    settle(7);
    if (task.executionState === "paused") task.resume();
    await task;
  }
});

it("omits unadmitted symbols and snapshots the explicit admission list", () => {
  const input = Promise.resolve(7);
  const first = Symbol("same"), second = Symbol("same");
  Object.defineProperty(input, first, { value: 1 });
  Object.defineProperty(input, second, { value: 2 });
  expect(Reflect.ownKeys(getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise))).toEqual([]);
  const keys = [first];
  admitNativePromiseProperties(input, keys);
  keys.push(second);
  expect(Reflect.ownKeys(getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise))).toEqual([first]);
  admitNativePromiseProperties(input, []);
  expect(Reflect.ownKeys(getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise))).toEqual([]);
});

it.each(["binding", "host", "realm"])("isolates retained host context in the public %s boundary", async surface => {
  const storage = new AsyncLocalStorage();
  const key = Symbol("kResourceStore");
  const input = storage.run({ secret: "private" }, () => Promise.resolve(7));
  Object.defineProperty(input, key, { value: 42 });
  admitNativePromiseProperties(input, [key]);
  storage.disable();
  const expression = "const keys = Object.getOwnPropertySymbols(input); return [keys.length, input[keys[0]], await input]";
  if (surface === "realm") {
    const realm = createRealm({ bindings: { input } });
    try { expect(await realm.evaluate(expression)).toMatchObject({ ok: true, returnValue: [1, 42, 7] }); }
    finally { await realm.close(); }
  } else {
    const source = (surface === "host" ? "const input = (await load()).input; " : "") + expression;
    const bindings = surface === "host" ? { load: () => ({ input }) } : { input };
    const original = await run(source, { bindings });
    expect(original).toMatchObject({ ok: true, returnValue: [1, 42, 7] });
    const serialized = await dump(original);
    expect(serialized).not.toContain("private");
    expect(await run(source, { bindings, snapshot: restore(JSON.parse(serialized), { source }) })).toMatchObject({ ok: true, returnValue: [1, 42, 7] });
  }
});

it.each([Symbol("unique"), Symbol.for("global"), Symbol.iterator])("preserves admitted key/value aliases and settlement through public replay: %s", async key => {
  const input = Promise.resolve(key);
  Object.defineProperty(input, key, { value: key });
  admitNativePromiseProperties(input, [key]);
  const source = "const key = Object.getOwnPropertySymbols(input)[0]; return [input[key] === key, await input === key]";
  const original = await run(source, { bindings: { input } });
  expect(original).toMatchObject({ ok: true, returnValue: [true, true] });
  const replay = await run(source, { snapshot: restore(JSON.parse(await dump(original)), { source }) });
  expect(replay).toMatchObject({ ok: true, returnValue: [true, true] });
});

it("preserves native symbol property order independently of admission list order", () => {
  const first = Symbol("same"), second = Symbol("same");
  const input = Promise.resolve(7);
  Object.defineProperty(input, first, { value: 1 });
  Object.defineProperty(input, second, { value: 2 });
  admitNativePromiseProperties(input, [second, first]);
  expect(Object.getOwnPropertySymbols(getPromiseProperties(deepCopyToSandbox(input) as SandboxPromise))).toEqual([first, second]);
});

it("requires a native Promise and own symbol data without reading thenables", () => {
  const then = vi.fn();
  expect(() => admitNativePromiseProperties({ get then() { then(); return () => {}; } } as never, [])).toThrow(TypeError);
  expect(then).not.toHaveBeenCalled();
  const input = Promise.resolve(7);
  expect(() => admitNativePromiseProperties(input, [Symbol("absent")])).toThrow(TypeError);
  expect(() => admitNativePromiseProperties(input, ["label" as never])).toThrow(TypeError);
});
