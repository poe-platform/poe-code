import { describe, expect, it } from "vitest";
import { codeReviewGroup, readCodeReviewDraftCommand } from "./cli.js";

describe("code-review command group", () => {
  it("exposes the root command surface", () => {
    expect(codeReviewGroup.children.map(({ name }) => name).sort()).toEqual([
      "agent-mcp",
      "commit",
      "drafts",
      "ingest",
      "install",
      "profiles",
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
});
