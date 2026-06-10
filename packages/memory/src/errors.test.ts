import { describe, expect, it } from "vitest";
import { hasOwnErrorCode } from "./errors.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("hasOwnErrorCode", () => {
  it("matches own error codes", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(hasOwnErrorCode(error, "ENOENT")).toBe(true);
  });

  it("ignores inherited error codes", async () => {
    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(hasOwnErrorCode(new Error("permission denied"), "ENOENT")).toBe(false);
    });
  });
});
