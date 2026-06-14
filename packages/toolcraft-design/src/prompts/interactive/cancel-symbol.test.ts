import { describe, expect, it } from "vitest";
import { CANCEL, isCancel } from "./cancel-symbol.js";

describe("prompt cancellation symbol", () => {
  it("uses a registry symbol that survives duplicate module instances", () => {
    expect(isCancel(CANCEL)).toBe(true);
    expect(isCancel("foo")).toBe(false);
    expect(Symbol.for("poe.cancel")).toBe(CANCEL);
  });
});
