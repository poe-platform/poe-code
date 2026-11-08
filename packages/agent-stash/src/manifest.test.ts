import { describe, expect, it } from "vitest";
import { hashFiles } from "./hash.js";
import { createEmptyManifest, parseManifest, serializeManifest, stableItemId, validateBundlePath } from "./manifest.js";
import type { AgentStashManifest } from "./types.js";

const manifestFile = {
  path: "skills/project/claude-code/code-review/SKILL.md",
  size: 7,
  sha256: "a".repeat(64)
};

const manifest: AgentStashManifest = {
  schemaVersion: 1,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
  items: [
    {
      id: "project:skill:claude-code:code-review",
      kind: "skill",
      agentId: "claude-code",
      name: "code-review",
      scope: "project",
      path: "skills/project/claude-code/code-review",
      files: [manifestFile],
      updatedAt: "2026-01-02T03:04:05.000Z",
      contentHash: hashFiles([manifestFile])
    }
  ]
};

describe("manifest", () => {
  it("round-trips a valid manifest", () => {
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest);
  });

  it("rejects manifest documents that are not objects", () => {
    expect(() => parseManifest("null")).toThrow("Manifest must be an object.");
  });

  it("rejects malformed manifest JSON with a stable error", () => {
    expect(() => parseManifest("{")).toThrow("Malformed agent-stash manifest.");
  });

  it("rejects manifest profile fields that are not safe profile names", () => {
    expect(() => parseManifest(serializeManifest({ ...manifest, profile: 42 as unknown as string }))).toThrow(
      "Invalid manifest profile: 42"
    );
    expect(() => parseManifest(serializeManifest({ ...manifest, profile: "../escape" }))).toThrow(
      "Invalid manifest profile: ../escape"
    );
  });

  it("rejects invalid manifest profiles at creation time", () => {
    expect(() => createEmptyManifest(new Date("2026-01-02T03:04:05.000Z"), "../escape")).toThrow(
      "Invalid manifest profile: ../escape"
    );
  });

  it("derives stable ids from scope, kind, agent, and name", () => {
    expect(
      stableItemId({ scope: "project", kind: "skill", agentId: "claude-code", name: "code-review" })
    ).toBe("project:skill:claude-code:code-review");
  });

  it("rejects absolute bundle paths", () => {
    expect(() => validateBundlePath("/tmp/skill.md")).toThrow(/relative/);
  });

  it("rejects path traversal", () => {
    expect(() => validateBundlePath("skills/../secret")).toThrow(/traversal/);
  });

  it("rejects bundle paths that are not strings", () => {
    expect(() => validateBundlePath(42 as unknown as string)).toThrow("Bundle path must be a string: 42");
  });

  it("rejects manifest items whose id does not match their canonical fields", () => {
    const invalid = {
      ...manifest,
      items: [{ ...manifest.items[0]!, id: "project:skill:claude-code:other" }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest item id mismatch for project:skill:claude-code:other");
  });

  it("rejects duplicate manifest item ids", () => {
    const invalid = {
      ...manifest,
      items: [manifest.items[0]!, { ...manifest.items[0]! }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Duplicate manifest item id: project:skill:claude-code:code-review");
  });

  it("rejects manifest item entries that are not objects", () => {
    const invalid = {
      ...manifest,
      items: [null as unknown as typeof manifest.items[0]]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest item must be an object.");
  });

  it("rejects manifest items with unsafe path or id segments", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        id: "project:skill:claude-code:bad:name",
        name: "bad:name",
        path: "skills/project/claude-code/bad:name",
        files: [{
          path: "skills/project/claude-code/bad:name/SKILL.md",
          size: 7,
          sha256: "a".repeat(64)
        }]
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Invalid manifest item name: bad:name");
  });

  it("rejects manifest items with non-string path or id segments", () => {
    const invalid = {
      ...manifest,
      items: [{ ...manifest.items[0]!, name: 42 as unknown as string }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Invalid manifest item name: 42");
  });

  it("rejects manifest items whose files field is not an array", () => {
    const invalid = {
      ...manifest,
      items: [{ ...manifest.items[0]!, files: {} as unknown as typeof manifest.items[0]["files"] }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Manifest item files must be an array: project:skill:claude-code:code-review"
    );
  });

  it("rejects manifest file entries that are not objects", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [null as unknown as typeof manifestFile]
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest file must be an object.");
  });

  it("rejects manifest file paths that are not strings", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [{
          ...manifestFile,
          path: 42 as unknown as string
        }]
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Bundle path must be a string: 42");
  });

  it("rejects manifest items whose path does not match their canonical fields", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        path: "skills/project/claude-code/other",
        files: [{
          path: "skills/project/claude-code/other/SKILL.md",
          size: 7,
          sha256: "a".repeat(64)
        }]
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest item path mismatch for project:skill:claude-code:code-review");
  });

  it("rejects manifest files outside their item path", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [{
          path: "skills/project/claude-code/other/SKILL.md",
          size: 7,
          sha256: "a".repeat(64)
        }]
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest file must be under item path: skills/project/claude-code/other/SKILL.md");
  });

  it("rejects skill items with no files", () => {
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [],
        contentHash: hashFiles([])
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Skill manifest item must contain at least one file under skills/project/claude-code/code-review"
    );
  });

  it("rejects skill manifest files that equal the skill directory path", () => {
    const directoryFile = {
      path: "skills/project/claude-code/code-review",
      size: 7,
      sha256: "a".repeat(64)
    };
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [directoryFile],
        contentHash: hashFiles([directoryFile])
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Skill manifest file must be under skill directory: skills/project/claude-code/code-review"
    );
  });

  it("rejects duplicate manifest file paths within an item", () => {
    const duplicateFiles = [manifestFile, { ...manifestFile }];
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: duplicateFiles,
        contentHash: hashFiles(duplicateFiles)
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Duplicate manifest file path: skills/project/claude-code/code-review/SKILL.md"
    );
  });

  it("rejects hook items that contain anything other than their single fragment file", () => {
    const hookFile = {
      path: "hooks/project/claude-code/PreToolUse.json",
      size: 7,
      sha256: "a".repeat(64)
    };
    const extraFile = {
      path: "hooks/project/claude-code/PreToolUse.json/extra.md",
      size: 5,
      sha256: "b".repeat(64)
    };
    const invalid = {
      ...manifest,
      items: [{
        id: "project:hook:claude-code:PreToolUse",
        kind: "hook" as const,
        agentId: "claude-code",
        name: "PreToolUse",
        scope: "project" as const,
        path: "hooks/project/claude-code/PreToolUse.json",
        files: [hookFile, extraFile],
        updatedAt: "2026-01-02T03:04:05.000Z",
        contentHash: hashFiles([hookFile, extraFile])
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Hook manifest item must contain exactly hooks/project/claude-code/PreToolUse.json"
    );
  });

  it("rejects manifest items whose content hash does not match their files", () => {
    const invalid = {
      ...manifest,
      items: [{ ...manifest.items[0]!, contentHash: "c".repeat(64) }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow("Manifest item content hash mismatch for project:skill:claude-code:code-review");
  });

  it("rejects manifest file hashes that are not lowercase hexadecimal SHA-256 values", () => {
    const invalidFile = {
      ...manifestFile,
      sha256: "z".repeat(64)
    };
    const invalid = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        files: [invalidFile],
        contentHash: hashFiles([invalidFile])
      }]
    };

    expect(() => parseManifest(serializeManifest(invalid))).toThrow(
      "Invalid manifest file hash for skills/project/claude-code/code-review/SKILL.md"
    );
  });

  it("rejects manifest timestamps that are not exact ISO instants", () => {
    expect(() => parseManifest(serializeManifest({ ...manifest, updatedAt: "not-a-date" }))).toThrow(
      "Invalid manifest updatedAt: not-a-date"
    );
    expect(() => parseManifest(serializeManifest({
      ...manifest,
      items: [{ ...manifest.items[0]!, updatedAt: "2026-01-02 03:04:05" }]
    }))).toThrow("Invalid manifest item updatedAt: 2026-01-02 03:04:05");
  });
});
