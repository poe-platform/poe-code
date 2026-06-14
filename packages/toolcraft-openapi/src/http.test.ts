import { RateLimitError, ServiceUnavailableError, UserError } from "toolcraft";
import { describe, expect, it, vi } from "vitest";
import { HttpError, requestJson } from "./http.js";

function createTokenSource(
  token: string,
  options?: {
    getTokenError?: Error;
    invalidate?: () => Promise<void>;
  }
) {
  return {
    getToken: vi.fn(async () => {
      if (options?.getTokenError !== undefined) {
        throw options.getTokenError;
      }

      return token;
    }),
    invalidate: options?.invalidate
  };
}

function createUnauthenticatedTokenSource(message = "Authentication required.") {
  return createTokenSource("unused", {
    getTokenError: new UserError(message)
  });
}

function createJsonResponse(body: unknown, status = 200, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" }
  });
}

function createTextResponse(body: string, status = 200, statusText = ""): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { "content-type": "text/plain" }
  });
}

describe("requestJson", () => {
  it("sets the Authorization header from the token source", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer abc"
        })
      })
    );
  });

  it("skips token resolution and omits the Authorization header when auth is disabled", async () => {
    const tokenSource = createTokenSource("abc");
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/status",
      method: "GET",
      auth: "none",
      tokenSource,
      fetch: fetchMock
    });

    expect(tokenSource.getToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/status",
      expect.objectContaining({
        headers: { Accept: "application/json" }
      })
    );
  });

  it("allows explicit Authorization headers when managed auth is disabled", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/tokens",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      headers: { Authorization: "Basic Zm9yZ2V5YXJk" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/tokens",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Basic Zm9yZ2V5YXJk" }) })
    );
  });

  it("omits the JSON content type when the request has no body", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer abc"
      }
    });
  });

  it("lets the token source raise the user error when auth is missing", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createUnauthenticatedTokenSource("Run auth login first."),
        fetch: vi.fn()
      })
    ).rejects.toThrow("Run auth login first.");
  });

  it("does not call fetch when the token source rejects", async () => {
    const fetchMock = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createUnauthenticatedTokenSource(),
      fetch: fetchMock
    }).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies fetch network failures with request URL context", async () => {
    const error = new TypeError("fetch failed", {
      cause: { code: "ECONNREFUSED", address: "127.0.0.1", port: 8080 }
    });

    await expect(
      requestJson({
        baseUrl: "http://127.0.0.1:8080",
        path: "/bots",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(error)
      })
    ).rejects.toThrow("Connection refused: 127.0.0.1:8080. Is the server running?");
  });

  it("returns parsed data with the raw Response when rawResponse is true", async () => {
    const response = createJsonResponse({ ok: true });

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: vi.fn(async () => response),
        rawResponse: true
      })
    ).resolves.toEqual({
      data: { ok: true },
      response
    });
  });

  it("throws typed HTTP errors with parsed code and request id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-rate-limited"
        }
      })
    );

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: fetchMock
      })
    ).rejects.toMatchObject<RateLimitError>({
      name: "RateLimitError",
      status: 429,
      code: "rate_limit_exceeded",
      requestId: "req-rate-limited"
    });
  });

  it("retries retryable responses and preserves the final typed error", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(createJsonResponse({ error: { code: "busy" } }, 503, "Service Unavailable"))
      .mockResolvedValueOnce(createJsonResponse({ error: { code: "busy" } }, 503, "Service Unavailable"));

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: fetchMock,
        retries: {
          max: 1,
          backoff: "exponential",
          retryOn: [503],
          sleep: async () => undefined,
          random: () => 0.5
        }
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("injects configured idempotency keys and generates one when omitted", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      body: { name: "bot" },
      idempotency: {
        header: "Idempotency-Key",
        enabled: true,
        key: "msg-42"
      }
    });

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      body: { name: "bot" },
      idempotency: {
        header: "Idempotency-Key",
        enabled: true,
        createKey: () => "generated-key"
      }
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "msg-42" })
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "generated-key" })
    });
  });

  it("calls toUpperCase once when issuing the request", async () => {
    const toUpperCase = vi.fn(() => "GET");

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: { toUpperCase } as unknown as string,
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true }))
    });

    expect(toUpperCase).toHaveBeenCalledTimes(1);
  });

  it("throws a UserError when a path parameter is missing", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots/{handle}",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn()
      })
    ).rejects.toBeInstanceOf(UserError);
  });

  it("substitutes path parameters into the request URL", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots/{handle}",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      pathParams: { handle: "my-bot" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots/my-bot",
      expect.any(Object)
    );
  });

  it("rejects inherited path parameters as missing", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots/{constructor}",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: fetchMock,
        pathParams: {}
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UserError && error.message === 'Missing path parameter "constructor".'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL-encodes path parameters that contain slashes", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots/{handle}",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      pathParams: { handle: "team/red" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots/team%2Fred",
      expect.any(Object)
    );
  });

  it("throws a UserError with the path-template message on invalid path templates", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots/{handle",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(),
        pathParams: { handle: "my-bot" }
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UserError && error.message === 'Invalid path template "/bots/{handle".'
    );
  });

  it("serializes query params with repeated array keys, omits undefined, and sends null as empty", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      query: {
        owner: "alice",
        tags: ["x", "y"],
        skip: undefined,
        cursor: null
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots?owner=alice&tags=x&tags=y&cursor=",
      expect.any(Object)
    );
  });

  it("serializes deep-object arrays with indexed bracket keys", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/preview",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      query: { lines: [{ amount: 100 }, { amount: 200 }] }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/preview?lines%5B0%5D%5Bamount%5D=100&lines%5B1%5D%5Bamount%5D=200",
      expect.any(Object)
    );
  });

  it("keeps false and zero query values when serializing scalars and arrays", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      query: {
        enabled: false,
        limit: 0,
        flags: [false, 0]
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots?enabled=false&limit=0&flags=false&flags=0",
      expect.any(Object)
    );
  });

  it("serializes deep-object query values with bracketed keys", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      query: {
        filter: {
          owner: "alice",
          active: false,
          range: { minimum: 0 },
          tags: ["one", "two"]
        }
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots?filter%5Bowner%5D=alice&filter%5Bactive%5D=false&filter%5Brange%5D%5Bminimum%5D=0&filter%5Btags%5D=one&filter%5Btags%5D=two",
      expect.any(Object)
    );
  });

  it("serializes JSON bodies with the application/json content type", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      body: { official: true }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        body: JSON.stringify({ official: true }),
        headers: expect.objectContaining({
          "Content-Type": "application/json"
        })
      })
    );
  });

  it("serializes URL-encoded form bodies", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/tokens",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      bodyMode: "form",
      body: { username: "alice", password: "hello world", scopes: ["read", "write"] }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/tokens",
      expect.objectContaining({
        body: "username=alice&password=hello+world&scopes=read&scopes=write",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded"
        })
      })
    );
  });

  it("sends raw text bodies with their declared content type", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/imports",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      bodyMode: "raw",
      contentType: "text/xml",
      body: "<Import><Name>forgeyard</Name></Import>"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/imports",
      expect.objectContaining({
        body: "<Import><Name>forgeyard</Name></Import>",
        headers: expect.objectContaining({ "Content-Type": "text/xml" })
      })
    );
  });

  it("decodes base64 request bodies before sending binary content", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/imports",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      bodyMode: "base64",
      contentType: "application/zip",
      body: "AAEC/w=="
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      headers: expect.objectContaining({ "Content-Type": "application/zip" })
    });
    expect(Buffer.from(request?.body as Uint8Array)).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("serializes multipart forms with base64 file fields and native scalars", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/uploads",
      method: "POST",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      bodyMode: "multipart",
      multipartBinaryFields: ["file"],
      body: { file: "AAEC/w==", description: "Forgeyard", placement: 2 }
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get("description")).toBe("Forgeyard");
    expect(form.get("placement")).toBe("2");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect(Buffer.from(await (file as Blob).arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("requests a JSON response representation", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" })
      })
    );
  });

  it("serializes custom scalar request headers", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: fetchMock,
      headers: {
        "x-trace-id": "trace-123",
        "x-attempt": 2,
        "x-enabled": false,
        "x-omitted": undefined
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          "x-attempt": "2",
          "x-enabled": "false",
          "x-trace-id": "trace-123"
        }
      })
    );
  });

  it("joins a trailing-slash base URL with a leading-slash path using one slash", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ ok: true }));

    await requestJson({
      baseUrl: "https://api.example.com/",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/bots", expect.any(Object));
  });

  it("returns parsed JSON for successful JSON responses", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createJsonResponse({ bots: ["a"] }))
      })
    ).resolves.toEqual({ bots: ["a"] });
  });

  it("throws an HttpError with context for malformed successful JSON responses", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "required",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () =>
          new Response('{"bots":', {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" }
          })
        )
      })
    ).rejects.toMatchObject<HttpError>({
      status: 200,
      statusText: "OK",
      request: { url: "https://api.example.com/bots" },
      body: '{"bots":'
    });
  });

  it("returns undefined for successful responses with empty bodies", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => new Response(null, { status: 204 }))
      })
    ).resolves.toBeUndefined();
  });

  it("throws an HttpError with parsed JSON bodies for client errors", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createJsonResponse({ error: "forbidden" }, 403))
      })
    ).rejects.toMatchObject<HttpError>({
      status: 403,
      body: { error: "forbidden" }
    });
  });

  it("preserves the received 401 when token invalidation fails", async () => {
    const tokenSource = createTokenSource("expired");
    tokenSource.invalidate = vi.fn(async () => {
      throw new Error("credential store unavailable");
    });

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "required",
        tokenSource,
        fetch: vi.fn(async () => createJsonResponse({ error: "unauthorized" }, 401, "Unauthorized"))
      })
    ).rejects.toMatchObject<HttpError>({
      status: 401,
      statusText: "Unauthorized",
      body: { error: "unauthorized" }
    });
  });

  it("does not invalidate saved credentials for unauthenticated 401 responses", async () => {
    const invalidate = vi.fn(async () => undefined);
    const tokenSource = createTokenSource("stored", { invalidate });

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/status",
        method: "GET",
        auth: "none",
        tokenSource,
        fetch: vi.fn(async () => createJsonResponse({ error: "unauthorized" }, 401))
      })
    ).rejects.toBeInstanceOf(HttpError);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("throws an HttpError with raw text bodies for client errors", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createTextResponse("forbidden", 403))
      })
    ).rejects.toMatchObject<HttpError>({
      status: 403,
      body: "forbidden"
    });
  });

  it("throws an HttpError with request and response details for server errors", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () =>
          createJsonResponse({ error: "boom" }, 500, "Internal Server Error")
        )
      })
    ).rejects.toMatchObject<HttpError>({
      status: 500,
      statusText: "Internal Server Error",
      request: {
        method: "GET",
        url: "https://api.example.com/bots"
      },
      response: {
        status: 500,
        statusText: "Internal Server Error",
        body: { error: "boom" }
      },
      body: { error: "boom" },
      message: "GET https://api.example.com/bots → 500 Internal Server Error"
    });
  });

  it("invalidates the token source before throwing on 401 responses", async () => {
    const invalidate = vi.fn(async () => undefined);
    let error: unknown;

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc", { invalidate }),
      fetch: vi.fn(async () => createJsonResponse({ error: "unauthorized" }, 401, "Unauthorized"))
    }).catch((caught: unknown) => {
      error = caught;
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject<HttpError>({
      request: {
        method: "GET",
        url: "https://api.example.com/bots"
      },
      response: {
        status: 401,
        statusText: "Unauthorized",
        body: { error: "unauthorized" }
      }
    });
  });

  it("preserves the 401 HttpError when token invalidation fails", async () => {
    const invalidate = vi.fn(async () => {
      throw new Error("credential store unavailable");
    });

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        auth: "required",
        tokenSource: createTokenSource("abc", { invalidate }),
        fetch: vi.fn(async () => createJsonResponse({ error: "unauthorized" }, 401, "Unauthorized"))
      })
    ).rejects.toMatchObject<HttpError>({
      status: 401,
      statusText: "Unauthorized",
      response: {
        body: { error: "unauthorized" }
      }
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("throws an HttpError when a successful response is not JSON", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createTextResponse("ok", 200))
      })
    ).rejects.toMatchObject<HttpError>({
      status: 200,
      body: "ok",
      response: {
        headers: {
          "content-type": "text/plain"
        }
      },
      message: 'Expected a JSON response body but received content-type "text/plain".'
    });
  });

  it("returns successful text responses when text mode is requested", async () => {
    const fetchMock = vi.fn(async () => createTextResponse("ok", 200));

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots/export",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: fetchMock,
        responseMode: "text",
        accept: "text/plain"
      })
    ).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots/export",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "text/plain" }) })
    );
  });

  it("returns successful binary responses as portable base64 payloads", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([0, 1, 2, 255]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" }
        })
    );

    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots/export",
        method: "GET",
        auth: "none",
        tokenSource: createTokenSource("unused"),
        fetch: fetchMock,
        responseMode: "binary",
        accept: "application/octet-stream"
      })
    ).resolves.toEqual({
      contentType: "application/octet-stream",
      encoding: "base64",
      byteLength: 4,
      data: "AAEC/w=="
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots/export",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/octet-stream" })
      })
    );
  });

  it("redacts the bearer token in HttpError request headers", async () => {
    let error: unknown;

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "required",
      tokenSource: createTokenSource("raw-token"),
      fetch: vi.fn(async () => createJsonResponse({ error: "boom" }, 500)),
      body: { official: true }
    }).catch((caught: unknown) => {
      error = caught;
    });

    expect(error).toMatchObject<HttpError>({
      request: {
        headers: {
          Authorization: "Bearer ****",
          "Content-Type": "application/json"
        },
        body: { official: true }
      }
    });
    expect(JSON.stringify((error as HttpError).request.headers)).not.toContain("raw-token");
  });

  it("redacts sensitive query values in HttpError request URLs and messages", async () => {
    let error: unknown;

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      query: { access_token: "raw-query-token", page: 2 },
      fetch: vi.fn(async () => createJsonResponse({ error: "boom" }, 500, "Internal Server Error"))
    }).catch((caught: unknown) => {
      error = caught;
    });

    expect(error).toMatchObject<HttpError>({
      request: { url: "https://api.example.com/bots?access_token=****&page=2" },
      message: "GET https://api.example.com/bots?access_token=****&page=2 → 500 Internal Server Error"
    });
    expect(String((error as Error).message)).not.toContain("raw-query-token");
  });

  it("redacts credential-bearing response headers in HttpError details", async () => {
    let error: unknown;

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/session",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: {
              "content-type": "application/json",
              "set-cookie": "session=raw-cookie; HttpOnly"
            }
          })
      )
    }).catch((caught: unknown) => {
      error = caught;
    });

    expect(error).toMatchObject<HttpError>({
      response: { headers: { "set-cookie": "****" } }
    });
    expect(JSON.stringify((error as HttpError).response.headers)).not.toContain("raw-cookie");
  });

  it("redacts the bearer token in dry-run output", async () => {
    const stdout = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots/{handle}",
      method: "POST",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(),
      pathParams: { handle: "my-bot" },
      body: { official: true },
      dryRun: true,
      writeStdout: stdout
    });

    expect(stdout).toHaveBeenCalledWith(
      'POST https://api.example.com/bots/my-bot\nAccept: application/json\nAuthorization: Bearer ****\nContent-Type: application/json\n\n{"official":true}\n'
    );
  });

  it("redacts sensitive query values in dry-run output", async () => {
    const stdout = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      fetch: vi.fn(),
      query: {
        api_key: "dry-secret-token",
        page: 2
      },
      dryRun: true,
      writeStdout: stdout
    });

    expect(stdout).toHaveBeenCalledWith(
      "GET https://api.example.com/bots?api_key=****&page=2\nAccept: application/json\n\n"
    );
  });

  it("does not call fetch during dry runs", async () => {
    const fetchMock = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: fetchMock,
      dryRun: true,
      writeStdout: vi.fn()
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes a verbose request and response transcript for successful JSON bodies", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "bot-1", ok: true }), {
            status: 200,
            statusText: "OK",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req-123"
            }
          })
      ),
      body: { name: "Helper", enabled: true },
      verbose: true,
      writeStderr: stderr
    });

    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr.mock.calls.map(([chunk]) => chunk).join("")).toBe(
      [
        "→ POST https://api.example.com/bots",
        "    Accept: application/json",
        "    Authorization: Bearer ****",
        "    Content-Type: application/json",
        "    {",
        '      "name": "Helper",',
        '      "enabled": true',
        "    }",
        "← 200 OK",
        "    content-type: application/json",
        "    x-request-id: req-123",
        "    {",
        '      "id": "bot-1",',
        '      "ok": true',
        "    }",
        ""
      ].join("\n")
    );
  });

  it("redacts query credentials and response cookies in verbose transcripts", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/session",
      method: "GET",
      auth: "none",
      tokenSource: createTokenSource("unused"),
      query: { api_key: "raw-query-token" },
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "session=raw-cookie; HttpOnly"
            }
          })
      ),
      verbose: true,
      writeStderr: stderr
    });

    const written = stderr.mock.calls.map(([chunk]) => chunk).join("");
    expect(written).toContain("?api_key=****");
    expect(written).toContain("    set-cookie: ****");
    expect(written).not.toContain("raw-query-token");
    expect(written).not.toContain("raw-cookie");
  });

  it("writes a verbose response transcript for successful empty 204 responses without a body section", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status: 204,
            statusText: "No Content",
            headers: {
              "x-request-id": "req-empty"
            }
          })
      ),
      verbose: true,
      writeStderr: stderr
    });

    const written = stderr.mock.calls.map(([chunk]) => chunk).join("");
    expect(written).toContain("→ GET https://api.example.com/bots\n");
    expect(written).toContain("← 204 No Content\n");
    expect(written).toContain("    x-request-id: req-empty\n");
    expect(written).not.toContain("{");
  });

  it("writes the verbose transcript before throwing for failed JSON responses", async () => {
    const stderr = vi.fn();
    let error: unknown;

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            statusText: "Internal Server Error",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req-failed"
            }
          })
      ),
      verbose: true,
      writeStderr: stderr
    }).catch((caught: unknown) => {
      error = caught;
      expect(stderr.mock.calls.map(([chunk]) => chunk).join("")).toContain('    "error": "boom"');
    });

    expect(error).toMatchObject<HttpError>({
      status: 500,
      statusText: "Internal Server Error",
      request: {
        method: "GET",
        url: "https://api.example.com/bots",
        headers: {
          Authorization: "Bearer ****"
        }
      },
      response: {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-failed"
        },
        body: { error: "boom" }
      },
      body: { error: "boom" },
      message: "GET https://api.example.com/bots → 500 Internal Server Error"
    });
    expect(stderr.mock.calls.map(([chunk]) => chunk).join("")).toContain(
      "← 500 Internal Server Error\n"
    );
  });

  it("writes raw text response bodies in verbose transcripts", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createTextResponse("plain\nbody", 200, "OK")),
      verbose: true,
      writeStderr: stderr
    }).catch(() => undefined);

    expect(stderr.mock.calls.map(([chunk]) => chunk).join("")).toContain(
      ["← 200 OK", "    content-type: text/plain", "    plain", "    body"].join("\n")
    );
  });

  it("truncates verbose transcript bodies over four kilobytes", async () => {
    const stderr = vi.fn();
    const body = { value: "x".repeat(5 * 1024) };

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "POST",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true })),
      body,
      verbose: true,
      writeStderr: stderr
    });

    const written = stderr.mock.calls.map(([chunk]) => chunk).join("");
    expect(written).toContain("… (");
    expect(written).toContain(" bytes truncated)");
    expect(written).not.toContain("rerun without --verbose");
    expect(written).not.toContain("set --debug");
  });

  it("redacts authorization values in verbose request transcripts", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("raw-token"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true })),
      verbose: true,
      writeStderr: stderr
    });

    const written = stderr.mock.calls.map(([chunk]) => chunk).join("");
    expect(written).toContain("Authorization: Bearer ****");
    expect(written).not.toContain("raw-token");
  });

  it("does not write to stderr when verbose is omitted", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true })),
      writeStderr: stderr
    });

    expect(stderr).not.toHaveBeenCalled();
  });
});
