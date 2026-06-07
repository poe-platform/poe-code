import { beforeEach, describe, expect, it } from "vitest";
import { vol } from "memfs";
import { discoverCodeReviewProfiles } from "./assets.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
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

  it("rejects relative external catalog paths from direct SDK calls", async () => {
    await expect(
      discoverCodeReviewProfiles({ cwd: "/repo", profileDirectories: ["../catalog"] })
    ).rejects.toThrow("codeReview.profileDirectories entries must be absolute paths");
  });
});
