import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { dump, restore } from "../index.js";
import { deepCopyFromSandbox, deepCopyToSandbox, getPromiseProperties, isSandboxPromise } from "./values.js";

it("imports own string descriptors, cycles and shared values without sharing host objects", async () => {
  const native = Promise.resolve(7);
  const shared = { count: 1 };
  Object.defineProperties(native, {
    label: { value: "answer", enumerable: true, configurable: true },
    hidden: { value: shared },
    alias: { value: shared, writable: true },
    self: { value: native }
  });
  const imported = deepCopyToSandbox(native);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  const properties = getPromiseProperties(imported);
  expect(Object.getOwnPropertyDescriptor(properties, "label")).toEqual({ value: "answer", enumerable: true, configurable: true, writable: false });
  expect(properties.hidden).toEqual(shared);
  expect(properties.hidden).not.toBe(shared);
  expect(properties.alias).toBe(properties.hidden);
  expect(properties.self).toBe(imported);
  expect(Object.getOwnPropertyDescriptor(properties, "hidden")).toMatchObject({ enumerable: false, writable: false, configurable: false });
  await expect(imported.promise).resolves.toBe(7);
  const exported = deepCopyFromSandbox(imported) as Promise<number> & { self: unknown; label: string };
  expect(exported.self).toBe(exported);
  expect(exported.label).toBe("answer");
  await expect(exported).resolves.toBe(7);
});

it.each(["label", "then"])("omits native Promise %s accessor metadata without invoking it", async key => {
  const getter = vi.fn(() => "secret");
  const native = Promise.resolve(1);
  Object.defineProperty(native, key, { get: getter });
  const imported = deepCopyToSandbox(native);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  expect(Object.hasOwn(getPromiseProperties(imported), key)).toBe(false);
  await expect(imported.promise).resolves.toBe(1);
  expect(getter).not.toHaveBeenCalled();
});

it("preserves the nonextensibility of imported Promise properties", () => {
  const native = Object.preventExtensions(Promise.resolve(1));
  const imported = deepCopyToSandbox(native);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  expect(Object.isExtensible(getPromiseProperties(imported))).toBe(false);
});

it.each([0, undefined, null])("imports a Promise with a shadowed then data property %j", async shadow => {
  const native = Promise.resolve(7);
  Object.defineProperty(native, "then", { value: shadow, configurable: true });
  const imported = deepCopyToSandbox(native);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  expect(getPromiseProperties(imported).then).toBe(shadow);
  await expect(imported.promise).resolves.toBe(7);
});

it.each([undefined, {}])("imports a Promise with a shadowed constructor data property %j", async shadow => {
  const native = Promise.resolve(7);
  Object.defineProperty(native, "constructor", { value: shadow, configurable: true });
  const imported = deepCopyToSandbox(native);
  if (!isSandboxPromise(imported)) throw new Error("Missing imported Promise");
  expect(getPromiseProperties(imported).constructor).toEqual(shadow);
  await expect(imported.promise).resolves.toBe(7);
});

it("exposes copied Promise data to guest property reads without changing settlement", async () => {
  const input = Promise.resolve(7);
  Object.defineProperty(input, "label", { value: "answer", enumerable: true });
  const result = await run("return [input.label, Object.getOwnPropertyDescriptor(input, 'label').writable, await input]", { bindings: { input } });
  expect(result.ok ? result.returnValue : result.error).toEqual(["answer", false, 7]);
  const source = "return [input.label, Object.getOwnPropertyDescriptor(input, 'label').writable, await input]";
  const replayed = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(replayed.ok ? replayed.returnValue : replayed.error).toEqual(["answer", false, 7]);
});

it("keeps distinct callable Promise properties bound across public replay", async () => {
  const input = Object.assign(Promise.resolve(7), { first: () => 1, second: () => 2 });
  const source = "return [input.first(), input.second(), await input]";
  const result = await run(source, { bindings: { input } });
  expect(result.ok ? result.returnValue : result.error).toEqual([1, 2, 7]);
  const replacement = Object.assign(Promise.resolve(99), { first: () => 10, second: () => 20 });
  const replayed = await run(source, { bindings: { input: replacement }, snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(replayed.ok ? replayed.returnValue : replayed.error).toEqual([1, 2, 7]);
});

it.each([{ then: 0 }, { constructor: undefined }, { then: 0, constructor: undefined }])(
  "preserves native await behavior for imported own data shadows %j", async shadows => {
    const input = Promise.resolve(7);
    for (const [key, value] of Object.entries(shadows)) Object.defineProperty(input, key, { value, configurable: true });
    const native: unknown = await input;
    const expected = [typeof native, native === input, native === 7];
    const source = "const result = await input; return [typeof result, result === input, result === 7]";
    const result = await run(source, { bindings: { input } });
    expect(result.ok ? result.returnValue : result.error).toEqual(expected);
    const replayed = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(replayed.ok ? replayed.returnValue : replayed.error).toEqual(expected);
  }
);
