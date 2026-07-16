import { beforeEach, describe, expect, it } from "vitest";
import { vol } from "memfs";
import {
  discoverCodeReviewProfiles,
  installCodeReviewAssets,
  resolveCodeReviewRolePrompt
} from "./assets.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("installCodeReviewAssets", () => {
  beforeEach(() => vol.reset());

  it("previews the assets it would create without writing them", async () => {
    await expect(installCodeReviewAssets({ cwd: "/repo", dryRun: true })).resolves.toEqual({
      created: [
        "/repo/.poe-code/code-review/profiles/generic.md",
        "/repo/.poe-code/code-review/prompts/orchestrator.md",
        "/repo/.poe-code/code-review/prompts/subagent.md",
        "/repo/.poe-code/code-review/prompts/agent.md",
        "/repo/.poe-code/code-review/prompts/profile-synthesis.md"
      ],
      overwritten: [],
      skipped: []
    });

    expect(vol.existsSync("/repo/.poe-code")).toBe(false);
  });

  it("previews forced overwrites without changing existing assets", async () => {
    vol.fromJSON({ "/repo/.poe-code/code-review/profiles/generic.md": "# Existing\n" });

    const result = await installCodeReviewAssets({ cwd: "/repo", force: true, dryRun: true });

    expect(result.overwritten).toEqual(["/repo/.poe-code/code-review/profiles/generic.md"]);
    expect(result.created).toContain("/repo/.poe-code/code-review/prompts/orchestrator.md");
    expect(vol.readFileSync("/repo/.poe-code/code-review/profiles/generic.md", "utf8")).toBe(
      "# Existing\n"
    );
    expect(vol.existsSync("/repo/.poe-code/code-review/prompts")).toBe(false);
  });

  it("previews assets it would skip when they already exist", async () => {
    vol.fromJSON({ "/repo/.poe-code/code-review/profiles/generic.md": "# Existing\n" });

    const result = await installCodeReviewAssets({ cwd: "/repo", dryRun: true });

    expect(result.skipped).toEqual(["/repo/.poe-code/code-review/profiles/generic.md"]);
    expect(result.created).not.toContain("/repo/.poe-code/code-review/profiles/generic.md");
    expect(vol.existsSync("/repo/.poe-code/code-review/prompts")).toBe(false);
  });
});

describe("discoverCodeReviewProfiles", () => {
  beforeEach(() => vol.reset());

  it("discovers external catalogs when the repository has no local profiles", async () => {
    vol.fromJSON({
      "/catalog/security.md": "# Security\n\nFind security regressions."
    });

    await expect(
      discoverCodeReviewProfiles({ cwd: "/repo", profileDirectories: ["/catalog"] })
    ).resolves.toEqual([
      {
        name: "security",
        content: "# Security\n\nFind security regressions.",
        filePath: "/catalog/security.md",
        source: "external"
      }
    ]);
  });

  it("uses repo-local profiles before external catalogs and earlier catalogs before later ones", async () => {
    vol.fromJSON({
      "/repo/.poe-code/code-review/profiles/security.md": "repo security",
      "/catalog-a/security.md": "catalog a security",
      "/catalog-a/performance.md": "catalog a performance",
      "/catalog-b/performance.md": "catalog b performance",
      "/catalog-b/accessibility.md": "catalog b accessibility"
    });

    const profiles = await discoverCodeReviewProfiles({
      cwd: "/repo",
      profileDirectories: ["/catalog-a", "/catalog-b"]
    });

    expect(profiles.map(({ name, content, source }) => ({ name, content, source }))).toEqual([
      { name: "security", content: "repo security", source: "repo" },
      { name: "performance", content: "catalog a performance", source: "external" },
      { name: "accessibility", content: "catalog b accessibility", source: "external" }
    ]);
  });

  it("filters profiles after applying catalog precedence", async () => {
    vol.fromJSON({
      "/catalog-a/security.md": "catalog a security",
      "/catalog-b/security.md": "catalog b security",
      "/catalog-b/accessibility.md": "catalog b accessibility"
    });

    await expect(
      discoverCodeReviewProfiles({
        cwd: "/repo",
        profileDirectories: ["/catalog-a", "/catalog-b"],
        filters: ["security"]
      })
    ).resolves.toEqual([
      {
        name: "security",
        content: "catalog a security",
        filePath: "/catalog-a/security.md",
        source: "external"
      }
    ]);
  });

  it("rejects a symlinked external catalog root", async () => {
    vol.fromJSON({ "/real/security.md": "security" });
    vol.symlinkSync("/real", "/catalog");

    await expect(
      discoverCodeReviewProfiles({ cwd: "/repo", profileDirectories: ["/catalog"] })
    ).rejects.toThrow("not a regular directory");
  });

  it("does not ignore invalid profile entries with inherited missing-file codes", async () => {
    vol.mkdirSync("/repo/.poe-code/code-review/profiles/security.md", { recursive: true });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(discoverCodeReviewProfiles({ cwd: "/repo" })).rejects.toThrow(
        "Code review asset path is not a regular file"
      );
    });
  });

  it("rejects relative external catalog paths from direct SDK calls", async () => {
    await expect(
      discoverCodeReviewProfiles({ cwd: "/repo", profileDirectories: ["../catalog"] })
    ).rejects.toThrow("codeReview.profileDirectories entries must be absolute paths");
  });

  it("extends the built-in role prompt and reports provenance", async () => {
    vol.fromJSON({
      "/repo/.poe-code/code-review/prompts/orchestrator.md":
        "---\nextends: true\n---\nProject policy\n\n{{yield}}"
    });

    const resolved = await resolveCodeReviewRolePrompt({ cwd: "/repo", role: "orchestrator" });

    expect(resolved.prompt).toContain("Project policy");
    expect(resolved.prompt).toContain("Review this pull request");
    expect(resolved.chain).toHaveLength(2);
    expect(resolved.chain[0]).toBe("/repo/.poe-code/code-review/prompts/orchestrator.md");
  });

  it("keeps full role prompt overrides backward compatible", async () => {
    vol.fromJSON({
      "/repo/.poe-code/code-review/prompts/orchestrator.md": "Full project override"
    });

    const resolved = await resolveCodeReviewRolePrompt({ cwd: "/repo", role: "orchestrator" });

    expect(resolved.prompt).toBe("Full project override");
    expect(resolved.chain).toEqual(["/repo/.poe-code/code-review/prompts/orchestrator.md"]);
  });

  it("keeps validating declared role prompt metadata", async () => {
    vol.fromJSON({
      "/repo/.poe-code/code-review/prompts/orchestrator.md":
        "---\nversion: 1\nrole: subagent\n---\nWrong role"
    });

    await expect(
      resolveCodeReviewRolePrompt({ cwd: "/repo", role: "orchestrator" })
    ).rejects.toThrow("frontmatter.role must equal orchestrator");
  });
});
