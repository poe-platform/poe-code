import { expect, it } from "vitest";
import { run } from "../run.js";
import { materializeWrappedErrorCause, readErrorCause } from "../error/shape.js";
import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { ownSandboxSymbolKeys } from "./values.js";

it.each(["Error", "DOMException"])("accepts %s inputs without exposing diagnostic origin metadata", async kind => {
  const error = kind === "Error" ? new Error("host") : new DOMException("host", "AbortError");
  expect(await run("return [error.message,Object.getOwnPropertySymbols(error).length]", { bindings: { error } }))
    .toMatchObject({ ok: true, returnValue: ["host", 0] });
});

it("hides the actual private marker but preserves same-description user symbols", () => {
  const error = new Error("host");
  const key = Symbol("wrappedErrorCause");
  const bindings = wrapCallerInjectedBindings({ error }, { budget: new Budget() });
  Object.defineProperty(bindings.error, key, { value: "public", enumerable: true });
  expect(ownSandboxSymbolKeys(bindings.error)).toEqual([key]);
});

it("retains the original host cause for explicit diagnostic materialization", () => {
  const error = new Error("host");
  const bindings = wrapCallerInjectedBindings({ error }, { budget: new Budget() });
  expect(readErrorCause(bindings.error)).toBeUndefined();
  materializeWrappedErrorCause(bindings.error);
  expect(readErrorCause(bindings.error)).toBe(error);
  expect(ownSandboxSymbolKeys(bindings.error)).toEqual([]);
});
