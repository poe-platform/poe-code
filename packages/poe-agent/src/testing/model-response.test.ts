import { describe, expect, it } from "vitest";

import { collectProviderEvents, toAcpModelResponse } from "./model-response.js";

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

describe("toAcpModelResponse", () => {
  it("converts legacy responses when events is only inherited", async () => {
    async function* pollutedEvents() {
      yield { type: "message_delta" as const, text: "polluted" };
    }

    await withObjectPrototypeProperties({ events: pollutedEvents() }, async () => {
      const response = toAcpModelResponse({ content: "hello" });

      await expect(collectProviderEvents(response)).resolves.toEqual([
        { type: "text", text: "hello" },
        { type: "stop", reason: "end_turn" }
      ]);
    });
  });
});
