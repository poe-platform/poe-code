import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolvePromptDocument } from "./prompt-document.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files)).promises;
}

describe("resolvePromptDocument", () => {
  it("composes packaged bases, partials, and project overrides before one-pass rendering", async () => {
    const fs = createFs({
      "/repo/prompts/review.md": [
        "---",
        "extends: true",
        "audience: project",
        "---",
        "{{> project-rules}}",
        "",
        "Review {{target}}."
      ].join("\n"),
      "/repo/prompts/project-rules.md": "Project rule for {{target}}.",
      "/package/prompts/review.md": "Before\n\n{{yield}}\n\nAfter {{target}}."
    });

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "prompts/review.md",
        basePaths: ["/package/prompts"],
        variables: { target: "API" },
        fs
      })
    ).resolves.toEqual({
      template: "Before\n\nProject rule for {{target}}.\nReview {{target}}.\n\nAfter {{target}}.",
      prompt: "Before\n\nProject rule for API.\nReview API.\n\nAfter API.",
      metadata: { audience: "project" },
      sources: { audience: "document", prompt: "document" },
      source: "/repo/prompts/review.md",
      chain: [
        "/repo/prompts/review.md",
        "/package/prompts/review.md",
        "/repo/prompts/project-rules.md"
      ]
    });
  });

  it("supports in-memory Markdown over packaged base directories", async () => {
    const fs = createFs({
      "/package/prompts/review.md": "Base {{yield}}"
    });

    const result = await resolvePromptDocument({
      cwd: "/repo",
      filePath: "prompts/review.md",
      content: "---\nextends: true\n---\nChild",
      basePaths: ["/package/prompts"],
      fs
    });

    expect(result.prompt).toBe("Base Child");
    expect(result.chain).toEqual(["/repo/prompts/review.md", "/package/prompts/review.md"]);
  });

  it("resolves a missing optional project override from a packaged base", async () => {
    const fs = createFs({
      "/package-a/prompts/review.md": "A"
    });

    const result = await resolvePromptDocument({
      cwd: "/repo",
      filePath: "prompts/review.md",
      optional: true,
      basePaths: ["/package-a/prompts"],
      fs
    });

    expect(result.prompt).toBe("A");
    expect(result.sources.prompt).toBe("base-1");
    expect(result.chain).toEqual([
      "/repo/prompts/review.md",
      "/package-a/prompts/review.md"
    ]);
  });

  it("rejects unresolved required variables", async () => {
    const fs = createFs({ "/repo/prompts/review.md": "Review {{target}}." });

    await expect(
      resolvePromptDocument({ cwd: "/repo", filePath: "prompts/review.md", fs })
    ).rejects.toThrow('Template variable "target" not found.');
  });

  it("reports missing packaged bases for optional overrides", async () => {
    const fs = createFs({});

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "prompts/review.md",
        optional: true,
        basePaths: ["/package/prompts"],
        fs
      })
    ).rejects.toThrow('Base "review" not found.');
  });

  it("reports circular packaged-base inheritance", async () => {
    const fs = createFs({
      "/package-a/review.md": "---\nextends: true\n---\nA",
      "/package-b/review.md": "---\nextends: true\n---\nB"
    });

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "review.md",
        content: "---\nextends: true\n---\nProject",
        basePaths: ["/package-a", "/package-b", "/package-a"],
        fs
      })
    ).rejects.toThrow("Circular extends detected");
  });

  it("rejects partial traversal outside prompt directories", async () => {
    const fs = createFs({ "/secret.md": "secret" });

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "prompts/review.md",
        content: "{{> ../secret}}",
        fs
      })
    ).rejects.toThrow("Partial name must remain inside prompt directories");
  });

  it("rejects document traversal outside cwd", async () => {
    const fs = createFs({ "/secret.md": "secret" });

    await expect(
      resolvePromptDocument({ cwd: "/repo", filePath: "../secret.md", fs })
    ).rejects.toThrow("Prompt document path must remain inside cwd");
  });

  it("rejects relative base paths", async () => {
    const fs = createFs({ "/repo/prompts/review.md": "Review" });

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "prompts/review.md",
        basePaths: ["../package/prompts"],
        fs
      })
    ).rejects.toThrow("Prompt document base paths must be absolute");
  });

  it("rejects symlink escapes from configured roots", async () => {
    const volume = Volume.fromJSON({
      "/outside/review.md": "secret",
      "/repo/prompts/.keep": ""
    });
    volume.symlinkSync("/outside/review.md", "/repo/prompts/review.md");
    const fs = createFsFromVolume(volume).promises;

    await expect(
      resolvePromptDocument({ cwd: "/repo", filePath: "prompts/review.md", fs })
    ).rejects.toThrow("Prompt document path escapes configured root");
  });

  it("rejects project symlinks that jump into a configured base root", async () => {
    const volume = Volume.fromJSON({
      "/package/prompts/review.md": "packaged",
      "/repo/prompts/.keep": ""
    });
    volume.symlinkSync("/package/prompts/review.md", "/repo/prompts/review.md");
    const fs = createFsFromVolume(volume).promises;

    await expect(
      resolvePromptDocument({
        cwd: "/repo",
        filePath: "prompts/review.md",
        basePaths: ["/package/prompts"],
        fs
      })
    ).rejects.toThrow("Prompt document path escapes configured root");
  });
});
