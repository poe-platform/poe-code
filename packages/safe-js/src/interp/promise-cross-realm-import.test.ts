import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { deepCopyToSandbox, getPromiseProperties, isSandboxPromise } from "./values.js";

it("imports a foreign native Promise while preserving aliases and settlement", async () => {
  const source = runInNewContext("Promise.resolve(42)");
  expect(source instanceof Promise).toBe(false);
  const imported = deepCopyToSandbox([source, source]);
  if (!Array.isArray(imported) || !isSandboxPromise(imported[0]))
    throw new Error("Expected imported Promise");
  expect(imported[0]).toBe(imported[1]);
  await expect(imported[0].promise).resolves.toBe(42);
  expect(Reflect.ownKeys(getPromiseProperties(imported[0]))).toEqual([]);
});

it("imports rejection settlement from a foreign native Promise", async () => {
  const source = runInNewContext("Promise.reject('foreign rejection')");
  // Avoid an unhandled rejection if the import itself fails.
  source.catch(() => undefined);
  const imported = deepCopyToSandbox(source);
  if (!isSandboxPromise(imported)) throw new Error("Expected imported Promise");
  await expect(imported.promise).rejects.toBe("foreign rejection");
});

it("does not import foreign Promise own data or invoke unrelated getters", async () => {
  const source = runInNewContext("Promise.resolve(7)");
  let reads = 0;
  Object.defineProperty(source, "label", { get() { reads++; return "private"; } });
  source[Symbol("host context")] = { secret: true };
  const imported = deepCopyToSandbox(source);
  if (!isSandboxPromise(imported)) throw new Error("Expected imported Promise");
  await expect(imported.promise).resolves.toBe(7);
  expect(Reflect.ownKeys(getPromiseProperties(imported))).toEqual([]);
  expect(reads).toBe(0);
});

it("does not admit a foreign Promise prototype forgery", () => {
  const source = runInNewContext("Object.create(Promise.prototype)");
  expect(() => deepCopyToSandbox(source)).toThrow(TypeError);
});
