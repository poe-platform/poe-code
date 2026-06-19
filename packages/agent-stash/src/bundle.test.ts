import { describe, expect, it } from "vitest";
import {
  bundlePathFromGistFilename,
  gistFilenameForBundlePath,
  gistFilesFromBundle,
  loadBundleFromGist,
  verifyBundleHashes
} from "./bundle.js";
import { createEmptyManifest } from "./manifest.js";
import { hashFiles, sha256 } from "./hash.js";

describe("Gist bundle filenames", () => {
  it("encodes slash-separated bundle paths into flat Gist filenames", () => {
    const bundlePath = "skills/project/claude-code/code-review/SKILL.md";

    expect(gistFilenameForBundlePath(bundlePath)).toBe(
      "skills%2Fproject%2Fclaude-code%2Fcode-review%2FSKILL.md"
    );
    expect(bundlePathFromGistFilename(gistFilenameForBundlePath(bundlePath))).toBe(bundlePath);
  });

  it("writes encoded Gist filenames while preserving manifest paths", () => {
    const manifest = createEmptyManifest(new Date("2026-01-01T00:00:00.000Z"), "default");
    const files = gistFilesFromBundle(manifest, [
      { path: "hooks/project/claude-code/PreToolUse.json", content: "{}" }
    ]);

    expect(files["hooks%2Fproject%2Fclaude-code%2FPreToolUse.json"]).toEqual({ content: "{}" });
    expect(files["hooks/project/claude-code/PreToolUse.json"]).toBeUndefined();
    expect(files["agent-stash.json"]?.content).toContain("\"items\": []");
  });

  it("writes Gist filename maps with prototype-safe own keys", () => {
    const manifest = createEmptyManifest(new Date("2026-01-01T00:00:00.000Z"), "default");
    const files = gistFilesFromBundle(manifest, [
      { path: "__proto__", content: "prototype" }
    ]);

    expect(Object.hasOwn(files, "__proto__")).toBe(true);
    expect(files["__proto__"]?.content).toBe("prototype");
  });

  it("loads both encoded and legacy slash-key Gist files as bundle paths", () => {
    const encoded = gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md");
    const bundle = loadBundleFromGist({
      id: "gist-1",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: JSON.stringify({
            schemaVersion: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: []
          })
        },
        [encoded]: { filename: encoded, content: "encoded" },
        "hooks/project/claude-code/PreToolUse.json": {
          filename: "hooks/project/claude-code/PreToolUse.json",
          content: "legacy"
        }
      }
    });

    expect(bundle.files.get("skills/project/claude-code/code-review/SKILL.md")).toBe("encoded");
    expect(bundle.files.get("hooks/project/claude-code/PreToolUse.json")).toBe("legacy");
  });

  it("rejects Gist files that decode to the same bundle path", () => {
    const bundlePath = "skills/project/claude-code/code-review/SKILL.md";
    const encoded = gistFilenameForBundlePath(bundlePath);

    expect(() => loadBundleFromGist({
      id: "gist-1",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: JSON.stringify({
            schemaVersion: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: []
          })
        },
        [encoded]: { filename: encoded, content: "encoded" },
        [bundlePath]: { filename: bundlePath, content: "legacy" }
      }
    })).toThrow(`Duplicate Gist bundle path: ${bundlePath}`);
  });

  it("rejects Gist bundle files whose content is not a string", () => {
    expect(() => loadBundleFromGist({
      id: "gist-1",
      files: {
        "agent-stash.json": {
          filename: "agent-stash.json",
          content: JSON.stringify({
            schemaVersion: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: []
          })
        },
        [gistFilenameForBundlePath("skills/project/claude-code/code-review/SKILL.md")]: {
          filename: "skills%2Fproject%2Fclaude-code%2Fcode-review%2FSKILL.md",
          content: 42 as unknown as string
        }
      }
    })).toThrow("Invalid Gist file content: skills%2Fproject%2Fclaude-code%2Fcode-review%2FSKILL.md");
  });

  it("rejects remote bundle files not referenced by the manifest", () => {
    const bundlePath = "skills/project/claude-code/code-review/SKILL.md";
    const content = "# Skill\n";
    const file = {
      path: bundlePath,
      size: Buffer.byteLength(content, "utf8"),
      sha256: sha256(content)
    };
    const manifest = createEmptyManifest(new Date("2026-01-01T00:00:00.000Z"), "default");
    manifest.items = [{
      id: "project:skill:claude-code:code-review",
      kind: "skill",
      agentId: "claude-code",
      name: "code-review",
      scope: "project",
      path: "skills/project/claude-code/code-review",
      files: [file],
      updatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: hashFiles([file])
    }];
    const bundle = loadBundleFromGist({
      id: "gist-1",
      files: {
        ...gistFilesFromBundle(manifest, [{ path: bundlePath, content }]),
        [gistFilenameForBundlePath("skills/project/claude-code/code-review/extra.md")]: {
          filename: gistFilenameForBundlePath("skills/project/claude-code/code-review/extra.md"),
          content: "extra\n"
        }
      }
    });

    expect(() => verifyBundleHashes(bundle)).toThrow(
      "Remote bundle contains untracked file skills/project/claude-code/code-review/extra.md"
    );
  });
});
