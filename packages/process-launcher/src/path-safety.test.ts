import { describe, expect, it } from "vitest";
import { assertPathHasNoSymbolicLinks } from "./path-safety.js";
import type { LauncherFileSystem } from "./types.js";

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

describe("assertPathHasNoSymbolicLinks", () => {
  it("does not treat inherited not-found codes as missing path checks", async () => {
    const fs: Pick<LauncherFileSystem, "lstat"> = {
      lstat: async () => {
        throw new Error("lstat denied");
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(assertPathHasNoSymbolicLinks(fs, "/state/api/state.json")).rejects.toThrow(
        "lstat denied"
      );
    });
  });
});
