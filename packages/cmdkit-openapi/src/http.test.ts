import { UserError } from "@poe-code/cmdkit";
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
    invalidate: options?.invalidate,
  };
}

function createUnauthenticatedTokenSource(message = "Authentication required.") {
  return createTokenSource("unused", {
    getTokenError: new UserError(message),
  });
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
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
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer abc",
        }),
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
      fetch: fetchMock,
    });

    expect(tokenSource.getToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/status",
      expect.objectContaining({
        headers: {},
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
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer abc",
      },
    });
  });

  it("lets the token source raise the user error when auth is missing", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createUnauthenticatedTokenSource("Run auth login first."),
        fetch: vi.fn(),
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
      fetch: fetchMock,
    }).catch(() => undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls toUpperCase once when issuing the request", async () => {
    const toUpperCase = vi.fn(() => "GET");

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: { toUpperCase } as unknown as string,
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true })),
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
        fetch: vi.fn(),
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
      pathParams: { handle: "my-bot" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots/my-bot",
      expect.any(Object)
    );
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
      pathParams: { handle: "team/red" },
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
        pathParams: { handle: "my-bot" },
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UserError &&
        error.message === 'Invalid path template "/bots/{handle".'
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
        cursor: null,
      },
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
        flags: [false, 0],
      },
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
      body: { official: true },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.objectContaining({
        body: JSON.stringify({ official: true }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
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
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/bots",
      expect.any(Object)
    );
  });

  it("returns parsed JSON for successful JSON responses", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createJsonResponse({ bots: ["a"] })),
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
        fetch: vi.fn(async () => new Response(null, { status: 204 })),
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
        fetch: vi.fn(async () => createJsonResponse({ error: "forbidden" }, 403)),
      })
    ).rejects.toMatchObject<HttpError>({
      status: 403,
      body: { error: "forbidden" },
    });
  });

  it("throws an HttpError with raw text bodies for client errors", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createTextResponse("forbidden", 403)),
      })
    ).rejects.toMatchObject<HttpError>({
      status: 403,
      body: "forbidden",
    });
  });

  it("throws an HttpError with raw text bodies for server errors", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createTextResponse("boom", 500)),
      })
    ).rejects.toMatchObject<HttpError>({
      status: 500,
      body: "boom",
    });
  });

  it("invalidates the token source before throwing on 401 responses", async () => {
    const invalidate = vi.fn(async () => undefined);

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc", { invalidate }),
      fetch: vi.fn(async () => createJsonResponse({ error: "unauthorized" }, 401)),
    }).catch(() => undefined);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("throws an HttpError when a successful response is not JSON", async () => {
    await expect(
      requestJson({
        baseUrl: "https://api.example.com",
        path: "/bots",
        method: "GET",
        tokenSource: createTokenSource("abc"),
        fetch: vi.fn(async () => createTextResponse("ok", 200)),
      })
    ).rejects.toMatchObject<HttpError>({
      status: 200,
      body: "ok",
      message: 'Expected a JSON response body but received content-type "text/plain".',
    });
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
      writeStdout: stdout,
    });

    expect(stdout).toHaveBeenCalledWith(
      "POST https://api.example.com/bots/my-bot\nAuthorization: Bearer ****\nContent-Type: application/json\n\n{\"official\":true}\n"
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
      writeStdout: vi.fn(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the request line to stderr in verbose mode", async () => {
    const stderr = vi.fn();

    await requestJson({
      baseUrl: "https://api.example.com",
      path: "/bots",
      method: "GET",
      auth: "required",
      tokenSource: createTokenSource("abc"),
      fetch: vi.fn(async () => createJsonResponse({ ok: true })),
      verbose: true,
      writeStderr: stderr,
    });

    expect(stderr).toHaveBeenCalledWith("GET https://api.example.com/bots\n");
  });
});
