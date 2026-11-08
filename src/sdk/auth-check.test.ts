import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../cli/errors.js";
import type { HttpClient } from "../cli/http.js";
import { checkPoeAuth } from "./auth-check.js";

describe("checkPoeAuth", () => {
  it("checks a custom base path with a trailing slash", async () => {
    const httpClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ current_point_balance: 8_432 })
    })) as unknown as HttpClient;

    await expect(
      checkPoeAuth({ apiKey: "test-key", baseUrl: "https://example.com/proxy/", httpClient })
    ).resolves.toBeUndefined();
    expect(httpClient).toHaveBeenCalledWith("https://example.com/proxy/usage/current_balance", {
      method: "GET",
      headers: { Authorization: "Bearer test-key" }
    });
  });

  it("preserves HTTP failure metadata", async () => {
    const httpClient = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "invalid_api_key" })
    })) as unknown as HttpClient;

    const error = await checkPoeAuth({
      apiKey: "revoked-key",
      baseUrl: "https://api.poe.com",
      httpClient
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "Failed to check authentication (HTTP 401)",
      httpStatus: 401,
      endpoint: "/usage/current_balance"
    });
  });
});
