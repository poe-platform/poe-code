import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Budget, SandboxError } from "./interp/budget.js";
import { wrapCallerInjectedBindings } from "./interp/host-bridge.js";
import { deepCopyToSandbox, isSandboxPromise } from "./interp/values.js";
import { CompileScope } from "./interp/regex/compile-guard.js";
import { dump, restore, run } from "./index.js";
import { encodeReplayData } from "./snapshot/replay-data.js";

it.each(["binding", "return", "settlement", "arguments", "importMeta"] as const)(
  "imports native RegExp through %s without using the host matcher",
  async route => {
    const pattern = /a+/gy;
    pattern.lastIndex = 1;
    const body = `${route === "binding" || route === "arguments" ? "const value = input;" :
      route === "importMeta" ? "const value = import.meta.input;" :
      route === "return" ? "const value = input();" : "const value = await input;"}
      return [value.source, value.flags, value.lastIndex, value.test('baaa'), value.lastIndex]`;
    const source = route === "arguments" ? `export default function(input) { ${body} }` : body;
    const bindings = { input: route === "binding" ? pattern :
      route === "return" ? () => pattern : Promise.resolve(pattern) };
    const options = route === "arguments" ? { entryPointArgs: [pattern] } :
      route === "importMeta" ? { importMeta: { input: pattern } } : { bindings };
    let result = await run(source, options);
    expect(result).toMatchObject({ ok: true, returnValue: ["a+", "gy", 1, true, 4] });
    expect(pattern.lastIndex).toBe(1);
    result = await run(source, { ...options, snapshot: restore(JSON.parse(await dump(result)), { source }) });
    expect(result).toMatchObject({ ok: true, returnValue: ["a+", "gy", 1, true, 4] });
    expect(pattern.lastIndex).toBe(1);
  }
);

it("reads foreign RegExp internal state without invoking inherited overrides", async () => {
  const pattern = runInNewContext("/a/gi") as RegExp;
  let reads = 0;
  const prototype = Object.create(Object.getPrototypeOf(pattern));
  for (const key of ["source", "flags", "global", "ignoreCase"]) {
    Object.defineProperty(prototype, key, { get() { reads++; throw new Error("unexpected getter"); } });
  }
  Object.setPrototypeOf(pattern, prototype);
  expect(await run("return [input.source,input.flags,input.test('A')]", { bindings: { input: pattern } }))
    .toMatchObject({ ok: true, returnValue: ["a", "gi", true] });
  expect(reads).toBe(0);
  expect(pattern.lastIndex).toBe(0);
});

it("rejects own accessor metadata without invoking it", () => {
  const pattern = /a/;
  let reads = 0;
  Object.defineProperty(pattern, "extra", { get() { reads++; return 7; } });
  expect(() => wrapCallerInjectedBindings({ pattern }, { budget: new Budget() }))
    .toThrow("Host RegExp accessors are not data");
  expect(reads).toBe(0);
});

it.each(["stringLength", "steps"] as const)("enforces %s during native regex compilation", limit => {
  const pattern = new RegExp("a".repeat(2000));
  const budget = new Budget(limit === "stringLength" ? { stringLength: 100 } : { maxSteps: 100 });
  let failure: unknown;
  try { wrapCallerInjectedBindings({ pattern }, { budget }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(SandboxError);
  expect(failure).toMatchObject({ budget: limit });
});

it("preserves frozen regex data, cursor descriptors and self-references", async () => {
  const pattern = /a/g;
  Object.defineProperty(pattern, "self", { value: pattern, enumerable: true });
  Object.freeze(pattern);
  const source = `return [Object.isFrozen(input), input.self === input,
    Object.getOwnPropertyDescriptor(input, 'lastIndex').writable]`;
  let result = await run(source, { bindings: { input: pattern } });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, false] });
  result = await run(source, { snapshot: restore(JSON.parse(await dump(result)), { source }) });
  expect(result).toMatchObject({ ok: true, returnValue: [true, true, false] });
});

it("retains compilation limits for regexes arriving in Promise settlements", async () => {
  const budget = new Budget({ stringLength: 100 });
  const operation = budget.acquireCompileOwner();
  const compilation = new CompileScope(operation.owner);
  try {
    const value = deepCopyToSandbox(Promise.resolve(new RegExp("a".repeat(200))), { compilation });
    if (!isSandboxPromise(value)) throw new Error("Expected imported Promise");
    await expect(value.promise).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  } finally {
    compilation.dispose();
    operation.release();
  }
});

it("charges settlement snapshot compilation to the importing owner", async () => {
  const budget = new Budget({ maxSteps: 250 });
  const operation = budget.acquireCompileOwner();
  const compilation = new CompileScope(operation.owner);
  try {
    const value = deepCopyToSandbox(Promise.resolve(new RegExp("a".repeat(20))), { compilation });
    if (!isSandboxPromise(value)) throw new Error("Expected imported Promise");
    await expect(value.promise).resolves.toMatchObject({ kind: "regex" });
    expect(() => encodeReplayData(value, { captureSettledImportedPromises: true }))
      .toThrow(SandboxError);
    expect(budget.stepsUsed).toBeGreaterThan(250);
  } finally {
    compilation.dispose();
    operation.release();
  }
});
