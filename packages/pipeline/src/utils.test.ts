import { describe, expect, it, vi } from "vitest";
import { isNotFound, readOptionalFile } from "./utils.js";
import type { PipelineFileSystem } from "./types.js";

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

describe("pipeline utils", () => {
  it("does not treat inherited error codes as not-found errors", async () => {
    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(isNotFound(new Error("permission denied"))).toBe(false);
    });
  });

  it("does not hide read errors with inherited not-found codes", async () => {
    const fs: Pick<PipelineFileSystem, "readFile"> = {
      readFile: vi.fn(async () => {
        throw new Error("pipeline read denied");
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(readOptionalFile(fs, "/pipeline.yaml")).rejects.toThrow(
        "pipeline read denied"
      );
    });
  });
});
