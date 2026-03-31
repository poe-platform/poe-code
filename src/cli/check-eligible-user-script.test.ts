import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import fs from "node:fs";

const scriptPath = "../../scripts/workflows/check-eligible-user.cjs";

type MockResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

function createResponse(options: {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: unknown;
}): MockResponse {
  return {
    ok: options.ok,
    status: options.status,
    statusText: options.statusText ?? "",
    headers: {
      get: () => null
    },
    json: async () => options.body ?? {}
  };
}

async function waitFor(fn: () => void, timeout = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await new Promise(r => setTimeout(r, 10));
    }
  }
}

describe("check eligible user workflow script", () => {
  let originalAppend: typeof fs.appendFileSync;
  let writes: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writes = [];
    originalAppend = fs.appendFileSync;
    fs.appendFileSync = ((_, content: string | NodeJS.ArrayBufferView) => {
      const text =
        typeof content === "string"
          ? content
          : Buffer.isBuffer(content)
            ? content.toString("utf8")
            : String(content);
      writes.push(text);
    }) as typeof fs.appendFileSync;

    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    process.env.USERNAME = "eligible-user";
    process.env.GITHUB_REPOSITORY = "poe-platform/poe-code";
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_OUTPUT = "/tmp/output";
  });

  afterEach(() => {
    fs.appendFileSync = originalAppend;
    delete process.env.USERNAME;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_OUTPUT;
  });

  it("writes allowed=true for org member with write permission", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: true, status: 204 }) satisfies MockResponse
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        status: 200,
        body: { permission: "write" }
      }) satisfies MockResponse
    );

    await import(scriptPath + "?t=" + Date.now());

    await waitFor(() => {
      expect(writes.join("")).toContain("allowed=true");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/orgs/poe-platform/members/eligible-user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/poe-platform/poe-code/collaborators/eligible-user/permission",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("writes allowed=false when user is not an org member", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 404, statusText: "Not Found" }) satisfies MockResponse
    );

    await import(scriptPath + "?t=" + Date.now());

    await waitFor(() => {
      expect(writes.join("")).toContain("allowed=false");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
