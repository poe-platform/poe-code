import { describe, expect, it } from "vitest";
import {
  attachErrorCause,
  attachErrorSpan,
  createSourceSpan,
  readErrorCause,
  readErrorSpan
} from "./shape.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
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
      if (descriptor) {
        Object.defineProperty(Object.prototype, key, descriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    }
  }
}

describe("error shape helpers", () => {
  it("attaches spans when only inherited spans exist", async () => {
    const span = createSourceSpan("return 1;", 1, 1, 1, 7);
    const error = {};

    await withObjectPrototypeProperties({ span: "polluted" }, async () => {
      attachErrorSpan(error, span);

      expect(Object.hasOwn(error, "span")).toBe(true);
      expect(readErrorSpan(error)).toEqual(span);
    });
  });

  it("ignores inherited spans and nested position fields", async () => {
    const inheritedSpan = createSourceSpan("return 1;", 1, 1, 1, 7);

    await withObjectPrototypeProperties(
      {
        column: 1,
        line: 1,
        offset: 0,
        span: inheritedSpan
      },
      async () => {
        expect(readErrorSpan({})).toBeUndefined();
        expect(readErrorSpan({ span: { start: {}, end: {} } })).toBeUndefined();
      }
    );
  });

  it("attaches and reads only own causes", async () => {
    const cause = new Error("own cause");
    const error = {};

    await withObjectPrototypeProperties({ cause: new Error("polluted cause") }, async () => {
      expect(readErrorCause(error)).toBeUndefined();

      attachErrorCause(error, cause);

      expect(Object.hasOwn(error, "cause")).toBe(true);
      expect(readErrorCause(error)).toBe(cause);
    });
  });
});
