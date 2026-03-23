import { describe, expect, it, vi } from "vitest";
import { checkAuth } from "./check-auth.js";

describe("checkAuth", () => {
  it("returns identity when API responds with valid data", async () => {
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

    expect(fetchMock).toHaveBeenCalledWith("https://poe.com/usage/current_balance", {
      method: "GET",
      headers: {
        Authorization: "Bearer provided-key"
      }
    });
  });

  it("uses the provided baseUrl", async () => {
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
