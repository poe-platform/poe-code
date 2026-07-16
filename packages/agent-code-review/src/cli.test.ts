import { describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";
import {
  codeReviewGroup,
  listCodeReviewProfilesCommand,
  readCodeReviewDraftCommand,
  runCodeReviewCommand
} from "./cli.js";
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

  it("rejects an invalid prUrl argument before resolving the review agent", async () => {
    const invocation = runCodeReviewCommand.handler({
      params: { prUrl: "not-a-url", cwd: "/repo" }
    } as never);

    await expect(invocation).rejects.toBeInstanceOf(UserError);
    await expect(invocation).rejects.toThrow(
      'Invalid prUrl argument. Expected a GitHub pull request URL like https://github.com/<owner>/<repo>/pull/<number>, received "not-a-url".'
    );
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
