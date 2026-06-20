import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubGistClient, resolveGitHubToken } from "./gist-client.js";

describe("resolveGitHubToken", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN", async () => {
    await expect(resolveGitHubToken({ GITHUB_TOKEN: "github", GH_TOKEN: "gh" })).resolves.toBe("github");
  });

  it("uses GH_TOKEN when GITHUB_TOKEN is absent", async () => {
    await expect(resolveGitHubToken({ GH_TOKEN: "gh" })).resolves.toBe("gh");
  });
});

describe("GitHubGistClient", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it("creates secret Gists with public false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          html_url: "https://gist.github.com/gist-1",
          files: {
            "agent-stash.json": { filename: "agent-stash.json", content: "{}" }
          }
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    const client = new GitHubGistClient("token");
    await client.createSecret({ files: { "agent-stash.json": { content: "{}" } } });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({ public: false });
  });

  it("reads Gist files without relying on returned key ordering", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: {
            "z-last.txt": { filename: "z-last.txt", content: "last" },
            "agent-stash.json": { filename: "agent-stash.json", content: "{}" },
            "a-first.txt": { filename: "a-first.txt", content: "first" }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const record = await new GitHubGistClient("token").read("gist-1");

    expect(record.files["agent-stash.json"]?.content).toBe("{}");
    expect(record.files["a-first.txt"]?.content).toBe("first");
    expect(record.files["z-last.txt"]?.content).toBe("last");
  });

  it("requests fresh Gist reads from GitHub", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: {}
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await new GitHubGistClient("token").read("gist-1");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toMatchObject({
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    });
  });

  it("uses the newest Gist read when GitHub returns a stale first response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            updated_at: "2026-06-20T08:00:00Z",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{\"items\":[]}" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            updated_at: "2026-06-20T08:01:00Z",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{\"items\":[1]}" },
              "hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json": {
                filename: "hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json",
                content: "{}"
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const record = await new GitHubGistClient("token").read("gist-1");

    expect(record.files["agent-stash.json"]?.content).toBe("{\"items\":[1]}");
    expect(record.files["hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json"]?.content).toBe("{}");
  });

  it("retries timed out Gist reads with an abort signal", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce((_url, init) => {
        const signal = init?.signal;
        if (!signal) {
          return Promise.reject(new Error("missing abort signal"));
        }
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{\"items\":[1]}" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const record = await new GitHubGistClient("token", {
      readAttempts: 2,
      readRequestTimeoutMs: 1,
      readRetryDelayMs: 0
    }).read("gist-1");

    expect(record.files["agent-stash.json"]?.content).toBe("{\"items\":[1]}");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest first Gist read when a follow-up read is stale", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            updated_at: "2026-06-20T08:01:00Z",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{\"items\":[]}" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            updated_at: "2026-06-20T08:00:00Z",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{\"items\":[1]}" },
              "hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json": {
                filename: "hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json",
                content: "{}"
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const record = await new GitHubGistClient("token").read("gist-1");

    expect(record.files["agent-stash.json"]?.content).toBe("{\"items\":[]}");
    expect(record.files["hooks%2Fglobal%2Fclaude-code%2FPostToolUse.json"]).toBeUndefined();
  });

  it("preserves Gist files whose names collide with object prototype keys", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: {
            ["__proto__"]: { filename: "__proto__", content: "prototype" }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const record = await new GitHubGistClient("token").read("gist-1");

    expect(Object.hasOwn(record.files, "__proto__")).toBe(true);
    expect(record.files["__proto__"]?.content).toBe("prototype");
  });

  it("creates write inputs with prototype-safe Gist file keys", async () => {
    const input = Object.create(null) as Parameters<GitHubGistClient["createSecret"]>[0]["files"];
    input["__proto__"] = { content: "prototype" };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: {}
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    await new GitHubGistClient("token").createSecret({ files: input });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { files?: Record<string, unknown> };
    expect(Object.hasOwn(body.files ?? {}, "__proto__")).toBe(true);
  });

  it("retries transient Gist update conflicts", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Gist cannot be updated.",
            status: "409"
          }),
          { status: 409, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gist-1",
            files: {
              "agent-stash.json": { filename: "agent-stash.json", content: "{}" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const record = await new GitHubGistClient("token", {
      updateAttempts: 2,
      updateRetryDelayMs: 0
    }).update("gist-1", {
      files: {
        "agent-stash.json": { content: "{}" }
      }
    });

    expect(record.files["agent-stash.json"]?.content).toBe("{}");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe Gist ids before issuing requests", async () => {
    const client = new GitHubGistClient("token");

    await expect(client.read("../poison")).rejects.toThrow("Invalid Gist id: ../poison");
    await expect(client.update("../poison", { files: {} })).rejects.toThrow("Invalid Gist id: ../poison");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe Gist ids returned by GitHub", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "../poison",
          files: {}
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow("Invalid Gist id: ../poison");
  });

  it("rejects malformed Gist response files collections", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: "not-files"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow("Invalid Gist files response.");
  });

  it("rejects malformed JSON response bodies with a stable error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{", { status: 200, headers: { "content-type": "application/json" } })
    );

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow("Invalid GitHub Gist response JSON.");
  });

  it("rejects malformed Gist response file content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "gist-1",
          files: {
            "agent-stash.json": { filename: "agent-stash.json", content: 42 }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow("Invalid Gist file content: agent-stash.json");
  });

  it("includes 403 response bodies in request errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("secondary rate limit", { status: 403 }));

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow(/403: secondary rate limit/);
  });

  it("includes non-403 response bodies in request errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("filename contains a slash", { status: 422 }));

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow(
      /422: filename contains a slash/
    );
  });
});
