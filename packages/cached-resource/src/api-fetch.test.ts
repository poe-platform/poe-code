import { describe, it, expect, vi, beforeEach } from "bun:test";
import { fetchFromApi } from "./api-fetch.js";

function createMockFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}) {
  return vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    json: response.json ?? (() => Promise.resolve({})),
  } as Response);
}

describe("fetchFromApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches JSON from the configured API endpoint", async () => {
    const data = { items: ["a", "b"] };
    const mockFetch = createMockFetch({
      ok: true,
      json: () => Promise.resolve(data),
    });

    const result = await fetchFromApi<{ items: string[] }>(
      { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
      { fetch: mockFetch },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual(data);
  });

  it("passes an AbortSignal to fetch", async () => {
    const mockFetch = createMockFetch({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await fetchFromApi(
      { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
      { fetch: mockFetch },
    );

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a descriptive error for non-OK HTTP responses", async () => {
    const mockFetch = createMockFetch({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("HTTP 404: Not Found");
  });

  it("throws a timeout error when the request is aborted", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>().mockRejectedValue(abortError);

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 1000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("Request timed out after 1000ms");
  });

  it("rethrows non-abort errors as-is", async () => {
    const networkError = new Error("Network failure");
    const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>().mockRejectedValue(networkError);

    await expect(
      fetchFromApi(
        { apiEndpoint: "https://api.example.com/data", fetchTimeout: 5000 },
        { fetch: mockFetch },
      ),
    ).rejects.toThrow("Network failure");
  });
});
