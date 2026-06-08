import { describe, expect, it, vi } from "vitest";
import { codeReviewGroup, listCodeReviewProfilesCommand, readCodeReviewDraftCommand } from "./cli.js";
import { discoverCodeReviewProfiles } from "./assets.js";
import { loadCodeReviewRuntimeConfig } from "./config.js";

vi.mock("./assets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assets.js")>()),
  discoverCodeReviewProfiles: vi.fn(async () => [])
}));

vi.mock("./config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config.js")>()),
  loadCodeReviewRuntimeConfig: vi.fn(async () => ({
    draftStore: ".poe-code/code-review/reviews",
    humanGate: { provider: "none" as const },
    profileDirectories: ["/catalog"]
  }))
}));

describe("code-review command group", () => {
  it("exposes the root command surface", () => {
    expect(codeReviewGroup.children.map(({ name }) => name).sort()).toEqual([
      "agent-mcp",
      "commit",
      "drafts",
      "ingest",
      "install",
      "profiles",
      "prompt-preview",
      "run"
    ]);
  });

  it("reports a missing requested draft instead of a successful empty result", async () => {
    await expect(
      readCodeReviewDraftCommand.handler({
        params: {
          prUrl: "https://github.com/acme/repo/pull/404",
          cwd: "/repo"
        }
      } as never)
    ).rejects.toThrow("No active code review draft found");
  });

  it("lists profiles from configured external catalogs", async () => {
    await listCodeReviewProfilesCommand.handler({ params: { cwd: "/repo" } } as never);

    expect(loadCodeReviewRuntimeConfig).toHaveBeenCalledWith("/repo");
    expect(discoverCodeReviewProfiles).toHaveBeenCalledWith({
      cwd: "/repo",
      profileDirectories: ["/catalog"]
    });
  });

});
