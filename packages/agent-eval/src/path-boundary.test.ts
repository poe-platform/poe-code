import { describe, expect, it } from "vitest";
import { assertFsCanonicalContainedPathIfPresent } from "./path-boundary.js";

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

describe("path boundary helpers", () => {
  it("does not treat inherited realpath error codes as missing optional paths", async () => {
    const fs = {
      realpath: async (targetPath: string) => {
        if (targetPath === "/repo/evals/config.json") {
          throw new Error("realpath denied");
        }

        return targetPath;
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        assertFsCanonicalContainedPathIfPresent(
          fs,
          "/repo/evals",
          "/repo/evals/config.json",
          "source.config"
        )
      ).rejects.toThrow("realpath denied");
    });
  });
});
