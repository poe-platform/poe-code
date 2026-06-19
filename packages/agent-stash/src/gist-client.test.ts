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

  it("surfaces missing gist scope on 403", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow(/gist scope/);
  });

  it("includes non-403 response bodies in request errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("filename contains a slash", { status: 422 }));

    await expect(new GitHubGistClient("token").read("gist-1")).rejects.toThrow(
      /422: filename contains a slash/
    );
  });
});
