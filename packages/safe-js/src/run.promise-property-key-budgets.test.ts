import { expect, it } from "vitest";
import { Budget, dump, restore, run } from "./index.js";
import { wrapCallerInjectedBindings } from "./interp/host-bridge.js";
import { deepCopyToSandbox } from "./interp/values.js";
import { CompileScope } from "./interp/regex/compile-guard.js";

it.each([128, 129])("revalidates imported Promise keys when rebinding them (length: %s)", length => {
  const native = Promise.resolve(7);
  Object.defineProperty(native, "x".repeat(length), { value: 1 });
  const input = deepCopyToSandbox(native);
  const convert = () => wrapCallerInjectedBindings({ input }, {
    budget: new Budget({ stringLength: 128 }), promiseReplacements: new WeakMap()
  });
  if (length === 128) expect(convert).not.toThrow();
  else expect(convert).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
});

it.each([
  { promise: false, length: 128 }, { promise: false, length: 129 },
  { promise: true, length: 128 }, { promise: true, length: 129 }
])("applies string limits to imported property keys %j", async ({ promise, length }) => {
  const input = promise ? Promise.resolve(7) : {};
  Object.defineProperty(input, "x".repeat(length), { value: 1, enumerable: true });
  const result = await run("return 1", { bindings: { input }, budget: new Budget({ stringLength: 128 }) }).then(
    value => value.ok ? { ok: true, value: value.returnValue } : { ok: false, error: value.error },
    error => ({ ok: false, error })
  );
  if (length === 128) expect(result).toEqual({ ok: true, value: 1 });
  else expect(result).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget: "stringLength" } });
});

it.each([
  { promise: false, length: 128 }, { promise: false, length: 129 },
  { promise: true, length: 128 }, { promise: true, length: 129 }
])("applies replay string limits to property keys %j", async ({ promise, length }) => {
  const input = promise ? Promise.resolve(7) : {};
  Object.defineProperty(input, "x".repeat(length), { value: 1, enumerable: true });
  const source = "return 1";
  const original = await run(source, { bindings: { input } });
  const result = await run(source, { snapshot: restore(JSON.parse(await dump(original)), { source }), budget: new Budget({ stringLength: 128 }) }).then(
    value => value.ok ? { ok: true, value: value.returnValue } : { ok: false, error: value.error },
    error => ({ ok: false, error })
  );
  if (length === 128) expect(result).toEqual({ ok: true, value: 1 });
  else expect(result).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget: "stringLength" } });
});

it.each([128, 129])("checks Promise keys at the host bridge before replay preparation (length: %s)", length => {
  const input = Promise.resolve(7);
  Object.defineProperty(input, "x".repeat(length), { value: 1 });
  const convert = () => wrapCallerInjectedBindings({ input }, { budget: new Budget({ stringLength: 128 }) });
  if (length === 128) expect(convert).not.toThrow();
  else expect(convert).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
});

it.each([128, 129])("checks Promise keys in compilation-owned direct copies (length: %s)", length => {
  const input = Promise.resolve(7);
  Object.defineProperty(input, "x".repeat(length), { value: 1 });
  const budget = new Budget({ stringLength: 128 });
  const operation = budget.acquireCompileOwner(false);
  const compilation = new CompileScope(operation.owner);
  try {
    const convert = () => deepCopyToSandbox(input, { compilation });
    if (length === 128) expect(convert).not.toThrow();
    else expect(convert).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
  } finally { compilation.dispose(); operation.release(); }
});
