import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const createAuthStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    backend: "file" as const,
    store: {
      getApiKey: getApiKeyMock
    }
  }))
);

vi.mock("./create-auth-store.js", () => ({
  createAuthStore: createAuthStoreMock
}));

async function loadCheckAuth() {
  return await import("./check-auth.js");
}

describe("checkAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    getApiKeyMock.mockReset();
    getApiKeyMock.mockResolvedValue(null);
    createAuthStoreMock.mockClear();
  });

  it("uses provided apiKey without reading from auth store", async () => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "user@example.com",
            current_point_balance: 1500
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toEqual({
      email: "user@example.com",
      balance: 1500
    });

    expect(createAuthStoreMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://poe.com/usage/current_balance", {
      method: "GET",
      headers: {
        Authorization: "Bearer provided-key"
      }
    });
  });

  it("reads the api key from the auth store when omitted", async () => {
    const { checkAuth } = await loadCheckAuth();
    getApiKeyMock.mockResolvedValue("stored-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "stored@example.com",
            current_point_balance: 99
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(checkAuth({ fetch: fetchMock as typeof fetch })).resolves.toEqual({
      email: "stored@example.com",
      balance: 99
    });

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when no api key is available", async () => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn();

    await expect(checkAuth({ fetch: fetchMock as typeof fetch })).resolves.toBeNull();

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the provided baseUrl", async () => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "custom@example.com",
            current_point_balance: 5
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await checkAuth({
      apiKey: "provided-key",
      baseUrl: "https://example.test",
      fetch: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/usage/current_balance",
      expect.any(Object)
    );
  });

  it("returns null balance when the response balance is null", async () => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "user@example.com",
            current_point_balance: null
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toEqual({
      email: "user@example.com",
      balance: null
    });
  });

  it.each([401, 403])("returns null when Poe rejects the key with HTTP %i", async (status) => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "forbidden" }), {
          status,
          headers: { "content-type": "application/json" }
        })
    );

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toBeNull();
  });

  it("returns null on network errors", async () => {
    const { checkAuth } = await loadCheckAuth();
    const fetchMock = vi.fn(async () => {
      throw new Error("network failed");
    });

    await expect(
      checkAuth({
        apiKey: "provided-key",
        fetch: fetchMock as typeof fetch
      })
    ).resolves.toBeNull();
  });
});
