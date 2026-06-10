import { describe, expect, it } from "vitest";
import {
  createAuthorizationState,
  parseAuthorizationState,
} from "./authorization-state.js";

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
      writable: true,
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

function encodeStatePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("authorization state", () => {
  it("round-trips generated authorization state", () => {
    const state = createAuthorizationState({
      issuer: "https://auth.example.com",
      requireIssuer: true,
    });

    expect(parseAuthorizationState(state)).toEqual({
      issuer: "https://auth.example.com",
      requireIssuer: true,
    });
  });

  it("ignores inherited decoded authorization state fields", async () => {
    await withObjectPrototypeProperties(
      {
        v: 1,
        n: "polluted-nonce",
        i: "https://polluted.example.com",
        r: true,
      },
      async () => {
        expect(parseAuthorizationState(encodeStatePayload({}))).toBeNull();
      }
    );
  });
});
