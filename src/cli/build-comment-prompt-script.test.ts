import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

const scriptPath = "../../scripts/workflows/build-comment-prompt.cjs";

type MockResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

function createResponse(options: {
  status: number;
  body: unknown;
  link?: string | null;
}): MockResponse {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    statusText: options.status === 200 ? "OK" : "",
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "link") {
          return options.link ?? null;
        }
        return null;
      }
    },
    json: async () => options.body
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

describe("build comment prompt workflow script", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let output: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    output = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);

    process.env.ISSUE_NUMBER = "42";
    process.env.COMMENT_BODY = "Please fix auth.spec.ts flake";
    process.env.COMMENT_AUTHOR = "bob";
    process.env.GITHUB_REPOSITORY = "poe-platform/poe-code";
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    delete process.env.ISSUE_NUMBER;
    delete process.env.COMMENT_BODY;
    delete process.env.COMMENT_AUTHOR;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
  });

  it("builds prompt with conversation and highlighted latest instruction", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        body: {
          title: "Fix auth bug",
          body: "The login flow breaks.",
          user: { login: "alice" },
          created_at: "2026-02-27T10:00:00Z"
        }
      }) satisfies MockResponse
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        body: [
          {
            body: "I can reproduce this.",
            user: { login: "bob" },
            created_at: "2026-02-27T11:00:00Z"
          }
        ]
      }) satisfies MockResponse
    );

    await import(scriptPath + "?t=" + Date.now());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const prompt = output.join("");
      expect(prompt).toContain("You are working on GitHub issue #42: Fix auth bug.");
      expect(prompt).toContain("Conversation:");
      expect(prompt).toContain("@alice (2026-02-27T10:00:00.000Z):");
      expect(prompt).toContain("The login flow breaks.");
      expect(prompt).toContain("@bob (2026-02-27T11:00:00.000Z):");
      expect(prompt).toContain("I can reproduce this.");
      expect(prompt).toContain("Latest instruction (from @bob):");
      expect(prompt).toContain("Please fix auth.spec.ts flake");
      expect(prompt).toContain("Act on the latest instruction above.");
    });
  });
});
