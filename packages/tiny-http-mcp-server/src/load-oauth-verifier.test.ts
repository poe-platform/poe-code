import { describe, expect, it } from "vitest";
import { loadOAuthVerifier } from "./load-oauth-verifier.js";

function dataModule(source: string): string {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

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

describe("loadOAuthVerifier", () => {
  it("loads a verifier with an own verify method", async () => {
    const verifier = await loadOAuthVerifier({
      modulePath: dataModule("export default { verify() { return { scopes: [] }; } };")
    });

    expect(typeof verifier.verify).toBe("function");
  });

  it("rejects verifier exports whose verify method is only inherited", async () => {
    const modulePath = dataModule("export default {};");
    let caught: unknown;

    await withObjectPrototypeProperties({ verify: () => ({ scopes: [] }) }, async () => {
      try {
        await loadOAuthVerifier({ modulePath });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("must be an object with a verify() method");
  });
});
