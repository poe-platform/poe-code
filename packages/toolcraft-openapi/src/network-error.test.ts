import { UserError } from "toolcraft";
import { describe, expect, it } from "vitest";
import { classifyNetworkError } from "./network-error.js";

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

describe("classifyNetworkError", () => {
  it("classifies fetch failed errors with an ECONNREFUSED cause", () => {
    const error = new TypeError("fetch failed", {
      cause: { code: "ECONNREFUSED", address: "127.0.0.1", port: 8080 }
    });

    const classified = classifyNetworkError(error, "http://127.0.0.1:8080/openapi.json");

    expect(classified).toBeInstanceOf(UserError);
    expect(classified?.message).toBe(
      "Connection refused: 127.0.0.1:8080. Is the server running?"
    );
  });

  it("walks the cause chain when classifying network errors", () => {
    const rootCause = { code: "ENOTFOUND", address: "api.internal" };
    const error = new TypeError("fetch failed", {
      cause: new Error("outer", { cause: rootCause })
    });

    const classified = classifyNetworkError(error, "https://api.internal/openapi.json");

    expect(classified?.message).toBe(
      "DNS lookup failed for api.internal. Check the URL or your network."
    );
    expect(classified?.cause).toBe(error);
  });

  it.each([
    [
      { code: "ETIMEDOUT", timeout: 5000 },
      "https://api.example.com/openapi.json",
      "Request timed out after 5000ms: https://api.example.com/openapi.json."
    ],
    [
      { code: "ECONNRESET", address: "api.example.com" },
      "https://api.example.com/openapi.json",
      "Connection reset by api.example.com. Likely transient: try again."
    ],
    [
      { code: "EAI_AGAIN", address: "api.example.com" },
      "https://api.example.com/openapi.json",
      "Temporary DNS failure for api.example.com. Network may be down."
    ]
  ])("classifies %s", (cause, url, message) => {
    const error = new TypeError("fetch failed", { cause });

    expect(classifyNetworkError(error, url)?.message).toBe(message);
  });

  it("classifies aborted requests with URL context", () => {
    const url = "https://api.example.com/openapi.json";
    const error = AbortSignal.abort().reason;

    const classified = classifyNetworkError(error, url);

    expect(classified).toBeInstanceOf(UserError);
    expect(classified?.message).toBe("Request aborted: https://api.example.com/openapi.json.");
  });

  it("classifies bare fetch failures without a cause", () => {
    const error = new TypeError("fetch failed");

    const classified = classifyNetworkError(error, "https://api.example.com/openapi.json");

    expect(classified).toBeInstanceOf(UserError);
    expect(classified?.message).toBe(
      "Network request failed: https://api.example.com/openapi.json."
    );
    expect(classified?.cause).toBe(error);
  });

  it("ignores inherited fetch failure causes", async () => {
    const error = new TypeError("fetch failed");

    await withObjectPrototypeProperties(
      { cause: { code: "ENOTFOUND", address: "polluted.example" } },
      async () => {
        const classified = classifyNetworkError(error, "https://api.example.com/openapi.json");

        expect(classified).toBeInstanceOf(UserError);
        expect(classified?.message).toBe(
          "Network request failed: https://api.example.com/openapi.json."
        );
      }
    );
  });

  it("ignores inherited network detail fields", async () => {
    const error = new TypeError("fetch failed", {
      cause: { code: "ECONNREFUSED" }
    });

    await withObjectPrototypeProperties({ address: "polluted.example", port: 1234 }, async () => {
      const classified = classifyNetworkError(error, "http://127.0.0.1:8080/openapi.json");

      expect(classified?.message).toBe(
        "Connection refused: 127.0.0.1:8080. Is the server running?"
      );
    });
  });

  it.each([
    [new TypeError("fetch failed", { cause: { code: "ETIMEDOUT", timeout: 5000 } }), "Request timed out after 5000ms: https://api.example.com/items?access_token=****."],
    [AbortSignal.abort().reason, "Request aborted: https://api.example.com/items?access_token=****."],
    [new TypeError("fetch failed"), "Network request failed: https://api.example.com/items?access_token=****."]
  ])("redacts query credentials in request-location network errors", (error, message) => {
    const classified = classifyNetworkError(
      error,
      "https://api.example.com/items?access_token=raw-query-token"
    );

    expect(classified?.message).toBe(message);
    expect(classified?.message).not.toContain("raw-query-token");
  });

  it("returns null for unknown error codes", () => {
    const error = new TypeError("fetch failed", {
      cause: { code: "ERR_SOCKET_BAD_PORT" }
    });

    expect(classifyNetworkError(error, "https://api.example.com/openapi.json")).toBeNull();
  });
});
