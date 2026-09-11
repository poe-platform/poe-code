import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const OwnedCodeDOMException = vi.hoisted(() => {
  class OwnedCodeDOMException extends Error {
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
      Object.defineProperty(this, "code", { value: 25, configurable: true });
    }
  }
  vi.stubGlobal("DOMException", OwnedCodeDOMException);
  return OwnedCodeDOMException;
});
import { coerceThrownValue } from "./exceptions.js";
import { Budget } from "./budget.js";

it("omits unverified DOMException codes when the runtime has no intrinsic code getter", () => {
  const failure = new OwnedCodeDOMException("invalid clone", "DataCloneError");
  const getter = vi.fn(() => { throw new Error("Untrusted code getter ran"); });
  Object.defineProperty(failure, "code", { get: getter });
  const projected = coerceThrownValue(failure, new Budget(), []);
  expect(projected).toMatchObject({ name: "DataCloneError", message: "invalid clone" });
  expect(projected).not.toHaveProperty("code");
  expect(getter).not.toHaveBeenCalled();
  const forged = Object.setPrototypeOf(Object.assign(new Error("forged"), { code: 25 }), OwnedCodeDOMException.prototype);
  expect(coerceThrownValue(forged, new Budget(), [])).not.toHaveProperty("code");
});
