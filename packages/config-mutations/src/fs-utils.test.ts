import { describe, expect, it, vi } from "vitest";
import { isNotFound, pathExists, readFileIfExists } from "./fs-utils.js";
import type { FileSystem } from "./types.js";

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

function createFs(overrides: Partial<FileSystem>): FileSystem {
  return {
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({})),
    lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
    readdir: vi.fn(async () => []),
    ...overrides
  };
}

describe("fs-utils", () => {
  it("does not treat inherited error codes as not-found errors", async () => {
    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(isNotFound(new Error("permission denied"))).toBe(false);
    });
  });

  it("does not hide read errors with inherited not-found codes", async () => {
    const fs = createFs({
      readFile: vi.fn(async () => {
        throw new Error("read permission denied");
      })
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(readFileIfExists(fs, "/config.json")).rejects.toThrow(
        "read permission denied"
      );
    });
  });

  it("does not hide stat errors with inherited not-found codes", async () => {
    const fs = createFs({
      stat: vi.fn(async () => {
        throw new Error("stat permission denied");
      })
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(pathExists(fs, "/config.json")).rejects.toThrow("stat permission denied");
    });
  });
});
