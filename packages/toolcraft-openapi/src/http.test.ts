import { UserError } from "toolcraft";
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
        headers: {}
      })
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
      'POST https://api.example.com/bots/my-bot\nAuthorization: Bearer ****\nContent-Type: application/json\n\n{"official":true}\n'
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
      "GET https://api.example.com/bots?api_key=****&page=2\n\n"
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
