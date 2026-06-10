import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { assertNoSymbolicLink } from "./path-safety.js";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

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

describe("assertNoSymbolicLink", () => {
  it("does not treat inherited lstat error codes as missing hook path segments", async () => {
    vol.reset();
    vol.mkdirSync("/repo", { recursive: true });
    const originalLstatSync = fs.lstatSync.bind(fs);
    const lstat = vi.spyOn(fs, "lstatSync").mockImplementation((targetPath, options) => {
      if (String(targetPath) === "/repo/hooks") {
        throw new Error("hook path lstat denied");
      }

      return originalLstatSync(targetPath, options);
    });

    try {
      await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
        expect(() => assertNoSymbolicLink("/repo/hooks/config.json")).toThrow(
          "hook path lstat denied"
        );
      });
    } finally {
      lstat.mockRestore();
    }
  });
});
