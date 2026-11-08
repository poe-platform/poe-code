import { describe, expect, it, vi } from "vitest";
import { createRuntimeLogger, type DiagnosticLogEvent } from "toolcraft";
import { requestJson } from "./http.js";

describe("HTTP diagnostic URL redaction", () => {
  it.each(["debug", "trace"] as const)("redacts query credentials at %s level", async (level) => {
    const events: DiagnosticLogEvent[] = [];
    const fetchMock = vi.fn(async () => new Response("{}", {
      headers: { "content-type": "application/json" }
    }));

    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      query: { api_key: "audit-query-secret", page: 2 },
      diagnostics: createRuntimeLogger({ level, logger: (event) => events.push(event) }),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/items?api_key=audit-query-secret&page=2",
      expect.anything()
    );
    expect(events).toContainEqual(expect.objectContaining({
      level: "debug",
      message: "GET https://api.example.test/items?api_key=****&page=2",
      data: { method: "GET", url: "https://api.example.test/items?api_key=****&page=2" }
    }));
    expect(JSON.stringify(events)).not.toContain("audit-query-secret");
  });

  it.each(["status", "network"] as const)("redacts URLs when retrying a %s failure", async (failure) => {
    const events: DiagnosticLogEvent[] = [];
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    if (failure === "status") {
      fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    } else {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    }
    fetchMock.mockResolvedValueOnce(new Response("{}", {
      headers: { "content-type": "application/json" }
    }));

    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      query: { access_token: "audit-retry-secret" },
      diagnostics: createRuntimeLogger({ level: "debug", logger: (event) => events.push(event) }),
      fetch: fetchMock,
      retries: { max: 1, backoff: "exponential", retryOn: [503], sleep: async () => undefined }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(expect.objectContaining({
      message: "Retrying GET https://api.example.test/items?access_token=****"
    }));
    expect(JSON.stringify(events)).not.toContain("audit-retry-secret");
  });
});

describe("HTTP credential redaction", () => {
  it.each([200, 400])("redacts request and response credential headers for status %s", async (status) => {
    const events: DiagnosticLogEvent[] = [];
    const headers = {
      "X-Api-Key": "request-key-secret",
      "x-AUTH-token": "request-token-secret",
      Client_Secret: "request-client-secret",
      "X-Public": "visible"
    };
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", {
      status,
      headers: {
        "content-type": "application/json",
        "X-Api-Key": "response-key-secret",
        "x-AUTH-token": "response-token-secret",
        Client_Secret: "response-client-secret",
        "X-Public": "visible"
      }
    }));
    const result = requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      headers,
      diagnostics: createRuntimeLogger({ level: "trace", logger: (event) => events.push(event) }),
      fetch: fetchMock
    });

    if (status === 200) {
      await expect(result).resolves.toEqual({});
    } else {
      await expect(result).rejects.toMatchObject({
        request: { headers: { "X-Api-Key": "****", "x-AUTH-token": "****", Client_Secret: "****", "X-Public": "visible" } },
        response: { headers: { "x-api-key": "****", "x-auth-token": "****", client_secret: "****", "x-public": "visible" } }
      });
    }
    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: expect.objectContaining(headers)
    }));
    const written = JSON.stringify(events);
    expect(written).toContain("visible");
    for (const value of ["request-key-secret", "request-token-secret", "request-client-secret", "response-key-secret", "response-token-secret", "response-client-secret"]) {
      expect(written).not.toContain(value);
    }
  });

  it.each(["json", "form", "raw"] as const)("redacts structured %s bodies without changing requests or results", async (bodyMode) => {
    const events: DiagnosticLogEvent[] = [];
    const payload = {
      password: "request-secret",
      user: "visible",
      nested: [{ refreshToken: "nested-request-secret" }]
    };
    const responsePayload = { access_token: "response-secret", items: ["visible"] };
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(responsePayload), {
      headers: { "content-type": "application/json" }
    }));

    await expect(requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "POST",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      body: bodyMode === "raw" ? JSON.stringify(payload) : payload,
      bodyMode,
      diagnostics: createRuntimeLogger({ level: "trace", logger: (event) => events.push(event) }),
      fetch: fetchMock
    })).resolves.toEqual(responsePayload);

    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: expect.stringContaining("request-secret")
    }));
    expect(payload.password).toBe("request-secret");
    expect(payload.nested[0]?.refreshToken).toBe("nested-request-secret");
    const written = JSON.stringify(events);
    expect(written).toContain("visible");
    expect(written).toContain("<redacted>");
    expect(written).not.toContain("request-secret");
    expect(written).not.toContain("response-secret");
  });

  it("redacts JSON-encoded text responses without changing the returned string", async () => {
    const events: DiagnosticLogEvent[] = [];
    const body = JSON.stringify({ client_secret: "response-secret", name: "visible" });

    await expect(requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      responseMode: "text",
      diagnostics: createRuntimeLogger({ level: "trace", logger: (event) => events.push(event) }),
      fetch: async () => new Response(body)
    })).resolves.toBe(body);
    expect(JSON.stringify(events)).toContain("visible");
    expect(JSON.stringify(events)).not.toContain("response-secret");
  });

  it("redacts serialized custom values while preserving date representations", async () => {
    const events: DiagnosticLogEvent[] = [];
    const payload = {
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      custom: {
        toJSON() {
          return { password: "custom-secret", name: "visible" };
        }
      }
    };
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", {
      headers: { "content-type": "application/json" }
    }));

    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "POST",
      auth: "none",
      tokenSource: { getToken: async () => "unused" },
      body: payload,
      diagnostics: createRuntimeLogger({ level: "trace", logger: (event) => events.push(event) }),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: JSON.stringify(payload)
    }));
    const written = JSON.stringify(events);
    expect(written).toContain("2020-01-01T00:00:00.000Z");
    expect(written).toContain("visible");
    expect(written).not.toContain("custom-secret");
  });
});
