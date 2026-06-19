import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPrimitives } from "toolcraft";
import { UserError } from "toolcraft";
import type { AuthProvider } from "./index.js";
import { HttpError, bearerTokenAuth } from "./index.js";

const mocks = vi.hoisted(() => {
  let storedToken: string | null = null;
  let backend: "file" | "keychain" = "file";

  const get = vi.fn(async () => storedToken);
  const set = vi.fn(async (value: string) => {
    storedToken = value;
  });
  const remove = vi.fn(async () => {
    storedToken = null;
  });
  const createSecretStore = vi.fn(() => ({
    backend,
    store: {
      get,
      set,
      delete: remove
    }
  }));
  const password = vi.fn();
  const isCancel = vi.fn((value: unknown) => typeof value === "symbol");

  return {
    get,
    set,
    remove,
    createSecretStore,
    password,
    isCancel,
    reset(next?: { storedToken?: string | null; backend?: "file" | "keychain" }) {
      storedToken = next?.storedToken ?? null;
      backend = next?.backend ?? "file";
      get.mockClear();
      set.mockClear();
      remove.mockClear();
      createSecretStore.mockClear();
      password.mockReset();
      isCancel.mockClear();
      isCancel.mockImplementation((value: unknown) => typeof value === "symbol");
    }
  };
});

vi.mock("auth-store", () => ({
  createSecretStore: mocks.createSecretStore
}));

vi.mock("toolcraft-design", () => ({
  password: mocks.password,
  isCancel: mocks.isCancel
}));

function getAuthGroup(provider: AuthProvider) {
  const group = provider.commands[0];

  if (group?.kind !== "group") {
    throw new Error("Expected auth provider to contribute a group.");
  }

  return group;
}

function getAuthCommand(provider: AuthProvider, name: string) {
  const command = getAuthGroup(provider).children.find((child) => child.name === name);

  if (command?.kind !== "command") {
    throw new Error(`Expected auth provider to contribute the ${name} command.`);
  }

  return command;
}

function createHandlerContext<TParams>(
  params: TParams,
  options?: {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
    readStdin?: () => Promise<string>;
  }
) {
  return {
    params,
    fetch: options?.fetch ?? vi.fn(async () => new Response(null, { status: 204 })),
    fs: {
      readFile: async () => "",
      writeFile: async () => undefined,
      exists: async () => true
    },
    env: {
      get: () => undefined
    },
    diagnostics: { level: "silent" as const, emit: () => undefined },
    progress: () => undefined,
    baseUrl: options?.baseUrl,
    readStdin: options?.readStdin
  };
}

function createWhoamiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createRenderPrimitives(): RenderPrimitives {
  return {
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn()
    },
    renderTable: vi.fn(() => ""),
    getTheme: vi.fn(() => ({
      header: (value: string) => value,
      muted: (value: string) => value
    })),
    note: vi.fn()
  };
}

describe("bearerTokenAuth", () => {
  beforeEach(() => {
    mocks.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("contributes auth commands under the default auth group", () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    expect(getAuthGroup(provider).name).toBe("auth");
  });

  it("marks contributed auth commands as cli-only", () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    expect(getAuthGroup(provider).scope).toEqual(["cli"]);
  });

  it("declares auth command params with toolcraft schema objects", () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    expect(getAuthCommand(provider, "login").params.kind).toBe("object");
    expect(getAuthCommand(provider, "logout").params.kind).toBe("object");
    expect(getAuthCommand(provider, "status").params.kind).toBe("object");
  });

  it("prefers the environment variable over the stored token", async () => {
    mocks.reset({ storedToken: "stored-token" });
    vi.stubEnv("INTERNAL_AGENT_TOKEN", "env-token");
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await expect(provider.getToken()).resolves.toBe("env-token");
  });

  it("falls back to the stored token when the environment is unset", async () => {
    mocks.reset({ storedToken: "stored-token" });
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await expect(provider.getToken()).resolves.toBe("stored-token");
  });

  it("points users at the default login command when no token resolves", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await expect(provider.getToken()).rejects.toThrow("auth login");
  });

  it("uses the custom command prefix in missing-token errors", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      commandPrefix: "credentials"
    });

    await expect(provider.getToken()).rejects.toThrow("credentials login");
  });

  it("invalidates stored credentials by deleting the store entry", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await provider.invalidate?.();

    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("falls back to the environment after invalidate deletes the stored token", async () => {
    mocks.reset({ storedToken: "stored-token" });
    vi.stubEnv("INTERNAL_AGENT_TOKEN", "env-token");
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await provider.invalidate?.();

    await expect(provider.getToken()).resolves.toBe("env-token");
  });

  it("does not delete a stored fallback when an environment token is invalidated", async () => {
    mocks.reset({ storedToken: "stored-token" });
    vi.stubEnv("INTERNAL_AGENT_TOKEN", "env-token");
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await expect(provider.getToken()).resolves.toBe("env-token");
    await provider.invalidate?.("env-token");

    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("throws a UserError after invalidate when neither env nor store has a token", async () => {
    mocks.reset({ storedToken: "stored-token" });
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await provider.invalidate?.();

    await expect(provider.getToken()).rejects.toBeInstanceOf(UserError);
  });

  it("stores the provided token when login uses --token", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await getAuthCommand(provider, "login").handler(
      createHandlerContext({ token: "foo", tokenStdin: undefined }) as never
    );

    expect(mocks.set).toHaveBeenCalledWith("foo");
  });

  it("stores trimmed stdin input when login uses --token-stdin", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await getAuthCommand(provider, "login").handler(
      createHandlerContext(
        { token: undefined, tokenStdin: true },
        { readStdin: async () => "  foo\n" }
      ) as never
    );

    expect(mocks.set).toHaveBeenCalledWith("foo");
  });

  it("prompts for a token when login receives no token flags", async () => {
    mocks.password.mockResolvedValueOnce("prompted-token");
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await getAuthCommand(provider, "login").handler(
      createHandlerContext({ token: undefined, tokenStdin: undefined }) as never
    );

    expect(mocks.set).toHaveBeenCalledWith("prompted-token");
  });

  it("skips whoami verification when whoamiPath is unset", async () => {
    const fetchMock = vi.fn(async () => createWhoamiResponse({ email: "unused@example.com" }));
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await getAuthCommand(provider, "login").handler(
      createHandlerContext({ token: "foo", tokenStdin: undefined }, { fetch: fetchMock }) as never
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith("foo");
  });

  it("returns whoami identity details after a verified login", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });

    const result = await getAuthCommand(provider, "login").handler(
      createHandlerContext(
        { token: "foo", tokenStdin: undefined },
        {
          baseUrl: "https://api.example.com",
          fetch: vi.fn(async () =>
            createWhoamiResponse({ email: "kjopek@quora.com", is_employee: true })
          )
        }
      ) as never
    );

    expect(result).toMatchObject({ email: "kjopek@quora.com" });
    expect(mocks.set).toHaveBeenCalledWith("foo");
  });

  it("renders the verified login message without a dead boolean suffix", () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });
    const primitives = createRenderPrimitives();

    getAuthCommand(provider, "login").render?.rich?.(
      {
        email: "kjopek@quora.com",
        isEmployee: true,
        storageBackend: "keychain"
      },
      primitives
    );

    expect(primitives.logger.success).toHaveBeenCalledWith(
      "Authenticated as kjopek@quora.com (employee confirmed)."
    );
  });

  it("rejects non-employee whoami responses during login", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });

    await expect(
      getAuthCommand(provider, "login").handler(
        createHandlerContext(
          { token: "foo", tokenStdin: undefined },
          {
            baseUrl: "https://api.example.com",
            fetch: vi.fn(async () =>
              createWhoamiResponse({ email: "guest@example.com", is_employee: false })
            )
          }
        ) as never
      )
    ).rejects.toThrow("employee");

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("surfaces whoami 401 failures during login", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });

    await expect(
      getAuthCommand(provider, "login").handler(
        createHandlerContext(
          { token: "foo", tokenStdin: undefined },
          {
            baseUrl: "https://api.example.com",
            fetch: vi.fn(async () => createWhoamiResponse({ error: "unauthorized" }, 401))
          }
        ) as never
      )
    ).rejects.toBeInstanceOf(HttpError);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("surfaces network failures during login verification", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });

    await expect(
      getAuthCommand(provider, "login").handler(
        createHandlerContext(
          { token: "foo", tokenStdin: undefined },
          {
            baseUrl: "https://api.example.com",
            fetch: vi.fn(async () => {
              throw new Error("boom");
            })
          }
        ) as never
      )
    ).rejects.toThrow("boom");

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects login when both --token and --token-stdin are provided", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await expect(
      getAuthCommand(provider, "login").handler(
        createHandlerContext({ token: "foo", tokenStdin: true }) as never
      )
    ).rejects.toThrow("--token");

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("removes the stored credential during logout", async () => {
    mocks.reset({ storedToken: "stored-token" });
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    await getAuthCommand(provider, "logout").handler(createHandlerContext({}) as never);

    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("exits cleanly when logout runs with an empty store", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    const result = await getAuthCommand(provider, "logout").handler(
      createHandlerContext({}) as never
    );

    expect({
      result,
      deleteCalls: mocks.remove.mock.calls.length
    }).toEqual({
      result: { storageBackend: "file" },
      deleteCalls: 1
    });
  });

  it("reports env-backed auth in status output data", async () => {
    vi.stubEnv("INTERNAL_AGENT_TOKEN", "env-token");
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    const result = await getAuthCommand(provider, "status").handler(
      createHandlerContext({}) as never
    );

    expect(result).toMatchObject({ tokenSource: "env (INTERNAL_AGENT_TOKEN)" });
  });

  it("reports keychain-backed auth in status output data", async () => {
    mocks.reset({ storedToken: "stored-token", backend: "keychain" });
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    const result = await getAuthCommand(provider, "status").handler(
      createHandlerContext({}) as never
    );

    expect(result).toMatchObject({ tokenSource: "keychain" });
  });

  it("reports the logged-out state when neither env nor store has a token", async () => {
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN"
    });

    const result = await getAuthCommand(provider, "status").handler(
      createHandlerContext({}) as never
    );

    expect(result).toMatchObject({ loggedIn: false });
  });

  it("includes whoami identity details in status data when configured", async () => {
    mocks.reset({ storedToken: "stored-token" });
    const provider = bearerTokenAuth({
      serviceName: "internal-agent",
      envVar: "INTERNAL_AGENT_TOKEN",
      whoamiPath: "/whoami"
    });

    const result = await getAuthCommand(provider, "status").handler(
      createHandlerContext(
        {},
        {
          baseUrl: "https://api.example.com",
          fetch: vi.fn(async () =>
            createWhoamiResponse({ email: "kjopek@quora.com", is_employee: true })
          )
        }
      ) as never
    );

    expect(result).toMatchObject({ email: "kjopek@quora.com" });
  });
});
