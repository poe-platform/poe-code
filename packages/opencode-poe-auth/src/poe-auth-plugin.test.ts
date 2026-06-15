import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hooks } from "@opencode-ai/plugin";
import open from "open";
import { createOAuthClient } from "poe-oauth";
import PoeAuthPlugin from "./poe-auth-plugin.js";

vi.mock("open", () => ({
  default: vi.fn(async () => undefined)
}));

vi.mock("poe-oauth", () => ({
  createOAuthClient: vi.fn()
}));

type AuthHook = NonNullable<Hooks["auth"]>;
type OAuthMethod = Extract<AuthHook["methods"][number], { type: "oauth" }>;

function getAuthHook(hooks: Hooks): AuthHook {
  if (!hooks.auth) {
    throw new Error("Expected auth hook");
  }

  return hooks.auth;
}

function getOAuthMethod(hooks: Hooks): OAuthMethod {
  const method = getAuthHook(hooks).methods.find((candidate) => candidate.type === "oauth");

  if (!method || method.type !== "oauth") {
    throw new Error("Expected oauth method");
  }

  return method;
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

describe("PoeAuthPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the poe provider name", async () => {
    const hooks = await PoeAuthPlugin({} as never);

    expect(getAuthHook(hooks).provider).toBe("poe");
  });

  it("loader returns apiKey for api auth", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = getAuthHook(hooks).loader;

    expect(loader).toBeTypeOf("function");
    await expect(
      loader!(async () => ({ type: "api", key: "sk-manual" }), {} as never)
    ).resolves.toEqual({
      apiKey: "sk-manual"
    });
  });

  it("loader rejects whitespace-only manual api keys", async () => {
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await expect(loader(async () => ({ type: "api", key: "   " }), {} as never)).rejects.toThrow(
      "Poe API key is missing"
    );
  });

  it.each(["sk-first\nsk-second", "sk-first\rsk-second", "sk-first\tsk-second"])(
    "loader rejects manual api keys containing control characters",
    async (key) => {
      const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

      await expect(loader(async () => ({ type: "api", key }), {} as never)).rejects.toThrow(
        "Poe API key contains invalid characters"
      );
    }
  );

  it("loader ignores inherited api auth fields", async () => {
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await withObjectPrototypeProperties(
      {
        type: "api",
        key: "sk-polluted"
      },
      async () => {
        await expect(loader(async () => ({}) as never, {} as never)).resolves.toEqual({});
      }
    );
  });

  it("loader returns apiKey for valid oauth auth", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = getAuthHook(hooks).loader;

    expect(loader).toBeTypeOf("function");
    await expect(
      loader!(
        async () => ({
          type: "oauth",
          access: "sk-oauth",
          refresh: "sk-oauth",
          expires: Date.now() + 60_000
        }),
        {} as never
      )
    ).resolves.toEqual({
      apiKey: "sk-oauth"
    });
  });

  it("loader rejects whitespace-only stored oauth access keys", async () => {
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await expect(
      loader(
        async () => ({
          type: "oauth",
          access: "   ",
          refresh: "   ",
          expires: Date.now() + 60_000
        }),
        {} as never
      )
    ).rejects.toThrow("Poe API key is missing");
  });

  it("loader rejects stored oauth access keys containing control characters", async () => {
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await expect(
      loader(
        async () => ({
          type: "oauth",
          access: "sk-first\nsk-second",
          refresh: "sk-first\nsk-second",
          expires: Date.now() + 60_000
        }),
        {} as never
      )
    ).rejects.toThrow("Poe API key contains invalid characters");
  });

  it("loader throws for expired oauth auth", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = getAuthHook(hooks).loader;

    expect(loader).toBeTypeOf("function");
    await expect(
      loader!(
        async () => ({
          type: "oauth",
          access: "sk-expired",
          refresh: "sk-expired",
          expires: Date.now() - 1
        }),
        {} as never
      )
    ).rejects.toThrow("Poe API key expired");
  });

  it("loader rejects oauth auth at its expiration instant", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await expect(
      loader(
        async () => ({
          type: "oauth",
          access: "sk-expired-now",
          refresh: "sk-expired-now",
          expires: 1_700_000_000_000
        }),
        {} as never
      )
    ).rejects.toThrow("Poe API key expired");
  });

  it("loader rejects oauth auth with nonnumeric expiry metadata", async () => {
    const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

    await expect(
      loader(
        async () => ({
          type: "oauth",
          access: "sk-invalid-expiry",
          refresh: "sk-invalid-expiry",
          expires: "not-a-timestamp" as unknown as number
        }),
        {} as never
      )
    ).rejects.toThrow("Poe API key has invalid expiration metadata");
  });

  it.each([Date.now() + 60_000.5, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])(
    "loader rejects unsafe oauth expiry timestamp %s",
    async (expires) => {
      const loader = getAuthHook(await PoeAuthPlugin({} as never)).loader!;

      await expect(
        loader(
          async () => ({
            type: "oauth",
            access: "sk-invalid-expiry",
            refresh: "sk-invalid-expiry",
            expires
          }),
          {} as never
        )
      ).rejects.toThrow("Poe API key has invalid expiration metadata");
    }
  );

  it("loader returns empty object for unknown auth type", async () => {
    const hooks = await PoeAuthPlugin({} as never);
    const loader = getAuthHook(hooks).loader;

    expect(loader).toBeTypeOf("function");
    await expect(
      loader!(async () => ({ type: "wellknown", key: "sk", token: "token" }), {} as never)
    ).resolves.toEqual({});
  });

  it("authorize returns a URL with the expected client id", async () => {
    const waitForResult = vi.fn(async () => ({
      apiKey: "sk-poe",
      expiresIn: 60
    }));

    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl:
          "https://poe.com/oauth/authorize?client_id=client_728290227fc048cc9262091a1ea197ea",
        waitForResult
      }))
    });

    const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();

    expect(new URL(grant.url).searchParams.get("client_id")).toBe(
      "client_728290227fc048cc9262091a1ea197ea"
    );
  });

  it("authorize opens the browser with the provided URL and resolves oauth auth", async () => {
    const waitForResult = vi.fn(async () => ({
      apiKey: "sk-poe",
      expiresIn: 60
    }));

    vi.mocked(createOAuthClient).mockImplementation((config) => ({
      authorize: vi.fn(async () => {
        await config.openBrowser?.("https://poe.com/oauth/authorize?client_id=test");

        return {
          authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
          waitForResult
        };
      })
    }));

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();

    expect(open).toHaveBeenCalledWith("https://poe.com/oauth/authorize?client_id=test");
    expect(grant.method).toBe("auto");
    if (grant.method !== "auto") {
      throw new Error("Expected auto oauth grant");
    }

    await expect(grant.callback()).resolves.toEqual({
      type: "success",
      access: "sk-poe",
      refresh: "sk-poe",
      expires: 60_000 + 1_700_000_000_000
    });
  });

  it("maps null expiry to the largest valid epoch timestamp", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
        waitForResult: vi.fn(async () => ({
          apiKey: "sk-poe",
          expiresIn: null
        }))
      }))
    });

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();

    expect(grant.method).toBe("auto");
    if (grant.method !== "auto") {
      throw new Error("Expected auto oauth grant");
    }

    await expect(grant.callback()).resolves.toEqual({
      type: "success",
      access: "sk-poe",
      refresh: "sk-poe",
      expires: 8_640_000_000_000_000
    });
  });

  it("authorize callback rejects api keys containing control characters", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
        waitForResult: vi.fn(async () => ({
          apiKey: "sk-first\nsk-second",
          expiresIn: 60
        }))
      }))
    });

    const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();
    if (grant.method !== "auto") {
      throw new Error("Expected auto oauth grant");
    }

    await expect(grant.callback()).rejects.toThrow("Poe API key contains invalid characters");
  });

  it("authorize callback ignores inherited oauth result fields", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
        waitForResult: vi.fn(async () => ({}) as never)
      }))
    });

    const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();
    if (grant.method !== "auto") {
      throw new Error("Expected auto oauth grant");
    }

    await withObjectPrototypeProperties(
      {
        apiKey: "sk-polluted",
        expiresIn: 60
      },
      async () => {
        await expect(grant.callback()).rejects.toThrow("Poe API key is missing");
      }
    );
  });

  it.each([-60, 60.5, Infinity, Number.MAX_VALUE])(
    "rejects invalid oauth expiry duration %s",
    async (expiresIn) => {
      vi.mocked(createOAuthClient).mockReturnValue({
        authorize: vi.fn(async () => ({
          authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
          waitForResult: vi.fn(async () => ({ apiKey: "sk-poe", expiresIn }))
        }))
      });

      const grant = await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();
      if (grant.method !== "auto") {
        throw new Error("Expected auto oauth grant");
      }

      await expect(grant.callback()).rejects.toThrow("invalid expiration");
    }
  );

  it("creates the oauth client with the OpenCode landing page", async () => {
    vi.mocked(createOAuthClient).mockReturnValue({
      authorize: vi.fn(async () => ({
        authorizationUrl: "https://poe.com/oauth/authorize?client_id=test",
        waitForResult: vi.fn(async () => ({
          apiKey: "sk-poe",
          expiresIn: 60
        }))
      }))
    });

    await getOAuthMethod(await PoeAuthPlugin({} as never)).authorize();

    expect(createOAuthClient).toHaveBeenCalledWith({
      clientId: "client_728290227fc048cc9262091a1ea197ea",
      landingPage: {
        title: "Connected to Poe",
        body: "You can close this tab and return to OpenCode."
      },
      openBrowser: expect.any(Function)
    });
  });
});
