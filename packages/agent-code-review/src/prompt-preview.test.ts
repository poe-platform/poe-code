import { beforeEach, describe, expect, it } from "vitest";
import { vol } from "memfs";
import { previewCodeReviewSpawnPrompt } from "./prompt-preview.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

describe("previewCodeReviewSpawnPrompt", () => {
  beforeEach(() => vol.reset());

  it("previews an orchestrator spawn with composed prompt provenance", async () => {
    vol.fromJSON({
      "/repo/.poe-code/code-review/prompts/orchestrator.md":
        "---\nextends: true\n---\nRepository policy\n\n{{yield}}",
      "/repo/.poe-code/code-review/profiles/security.md": "Find security regressions."
    });

    const preview = await previewCodeReviewSpawnPrompt({
      cwd: "/repo",
      spawn: "orchestrator",
      profile: "security",
      prUrl: "https://github.com/acme/widgets/pull/123",
      prDetails: { title: "Preview" },
      diff: "diff --git a/a b/a",
      priorActivity: {}
    });

    expect(preview.prompt).toContain("Repository policy");
    expect(preview.prompt).toContain("REQUIRED ORCHESTRATION FLOW");
    expect(preview.prompt).toContain("Find security regressions.");
    expect(preview.promptDocument.chain).toHaveLength(2);
  });

  it("previews reviewer and profile-synthesis spawns without network inputs", async () => {
    const reviewer = await previewCodeReviewSpawnPrompt({
      cwd: "/repo",
      spawn: "reviewer",
      profile: "generic"
    });
    const synthesis = await previewCodeReviewSpawnPrompt({
      cwd: "/repo",
      spawn: "profile-synthesis",
      profile: "security"
    });

    expect(reviewer.prompt).toContain("REQUIRED REVIEW FLOW");
    expect(reviewer.profile).toBe("generic");
    expect(synthesis.prompt).toContain("# Profile synthesis task");
    expect(synthesis.prompt).toContain("security.md");
  });

  it("rejects unsafe profile-synthesis preview paths", async () => {
    await expect(
      previewCodeReviewSpawnPrompt({
        cwd: "/repo",
        spawn: "profile-synthesis",
        profile: "../security"
      })
    ).rejects.toThrow("profile must be a safe path segment");
  });
});
