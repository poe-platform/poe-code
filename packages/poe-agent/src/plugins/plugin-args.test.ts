import { describe, expect, it } from "vitest";
import {
  assertNoSymbolicLinkPath,
  getOptionalBoolean,
  getOptionalNonNegativeInteger,
  getOptionalNumber,
} from "./plugin-args.js";

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("plugin-args", () => {
  it("parses optional booleans", () => {
    expect(getOptionalBoolean({ enabled: true }, "enabled")).toBe(true);
    expect(getOptionalBoolean({}, "enabled")).toBeUndefined();
  });

  it("rejects non-boolean optional booleans", () => {
    expect(() => getOptionalBoolean({ enabled: "yes" }, "enabled")).toThrow(
      'Tool argument "enabled" must be a boolean',
    );
  });

  it("parses optional finite numbers", () => {
    expect(getOptionalNumber({ timeout: 4.5 }, "timeout")).toBe(4.5);
    expect(getOptionalNumber({}, "timeout")).toBeUndefined();
  });

  it("rejects non-finite optional numbers", () => {
    expect(() => getOptionalNumber({ timeout: Number.POSITIVE_INFINITY }, "timeout")).toThrow(
      'Tool argument "timeout" must be a finite number',
    );
  });

  it("parses optional non-negative integers", () => {
    expect(getOptionalNonNegativeInteger({ offset: 0 }, "offset")).toBe(0);
    expect(getOptionalNonNegativeInteger({ offset: 3 }, "offset")).toBe(3);
    expect(getOptionalNonNegativeInteger({}, "offset")).toBeUndefined();
  });

  it("rejects negative and non-integer optional integers", () => {
    expect(() => getOptionalNonNegativeInteger({ offset: -1 }, "offset")).toThrow(
      'Tool argument "offset" must be a non-negative integer',
    );
    expect(() => getOptionalNonNegativeInteger({ offset: 1.5 }, "offset")).toThrow(
      'Tool argument "offset" must be a non-negative integer',
    );
  });

  it("does not treat inherited lstat codes as missing path ancestors", async () => {
    const lstatError = new Error("lstat denied");
    const fs = {
      async lstat(filePath: string) {
        if (filePath === "/workspace") {
          throw lstatError;
        }
        return { isSymbolicLink: () => false };
      }
    };

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(assertNoSymbolicLinkPath(fs, "/workspace/file.txt")).rejects.toBe(lstatError);
    });
  });
});
