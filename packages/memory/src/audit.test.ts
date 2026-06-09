import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { auditClaims } = await import("./audit.js");

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

describe("auditClaims", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("flags stale extracted sources and missing files", async () => {
    vol.fromJSON({
      "/repo/docs/spec.md": "line 1\nline 2\nline 3\n",
      "/repo/.poe-code/memory/pages/architecture.md": [
        "<!-- memory:extracted source=docs/spec.md#L2-L5 -->",
        "This paragraph cites more lines than currently exist.",
        "",
        "<!-- memory:extracted source=docs/missing.md#L1 -->",
        "This paragraph points at a file that is gone.",
        ""
      ].join("\n")
    });

    const audit = await auditClaims("/repo/.poe-code/memory", "/repo");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ page: "pages/architecture.md" });
    expect(audit[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docs/spec.md#L2-L5'),
        expect.stringContaining("EOF 3"),
        expect.stringContaining('docs/missing.md#L1'),
        expect.stringContaining("file does not exist"),
        expect.stringContaining('frontmatter sources are missing "docs/spec.md#L2-L5"'),
        expect.stringContaining('frontmatter sources are missing "docs/missing.md#L1"')
      ])
    );
  });

  it("does not treat inherited source error codes as missing files", async () => {
    vol.fromJSON({
      "/repo/docs/spec.md": "line 1\n",
      "/repo/.poe-code/memory/pages/architecture.md": [
        "<!-- memory:extracted source=docs/spec.md#L1 -->",
        "The architecture note cites the current spec.",
        ""
      ].join("\n")
    });
    const realpath = vol.promises.realpath.bind(vol.promises);
    vi.spyOn(vol.promises, "realpath").mockImplementation(async (targetPath, options) => {
      if (String(targetPath) === "/repo/docs/spec.md") {
        throw new Error("source realpath denied");
      }

      return realpath(targetPath, options);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(auditClaims("/repo/.poe-code/memory", "/repo")).rejects.toThrow(
        "source realpath denied"
      );
    });
  });

  it("flags inferred claims below the minimum confidence threshold", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/packages/superintendent.md": [
        "<!-- memory:inferred confidence=0.2 note=\"weak signal\" -->",
        "The superintendent probably wants this branch to stay green after each step.",
        ""
      ].join("\n")
    });

    const audit = await auditClaims("/repo/.poe-code/memory", "/repo", {
      minInferredConfidence: 0.3
    });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ page: "pages/packages/superintendent.md" });
    expect(audit[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("confidence=0.2"),
        expect.stringContaining("below the minimum 0.3")
      ])
    );
  });

  it("reports malformed confidence tags as page issues", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/incidents/bad-tags.md": [
        "<!-- memory:ambiguous -->",
        "We need more evidence before trusting this note.",
        "",
        "<!-- memory:inferred confidence=1.5 -->",
        "This confidence is outside the supported range.",
        ""
      ].join("\n")
    });

    const audit = await auditClaims("/repo/.poe-code/memory", "/repo");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ page: "pages/incidents/bad-tags.md" });
    expect(audit[0]?.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('non-empty "reason"')])
    );
  });

  it("flags long untagged pages only when rejectUntagged is enabled", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/notes.md": `${"A".repeat(220)}\n${"B".repeat(30)}`
    });

    await expect(auditClaims("/repo/.poe-code/memory", "/repo")).resolves.toEqual([]);

    const audit = await auditClaims("/repo/.poe-code/memory", "/repo", {
      rejectUntagged: true
    });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ page: "pages/notes.md" });
    expect(audit[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("long untagged body"),
        expect.stringContaining("memory:*")
      ])
    );
  });

  it("flags frontmatter sources that drift from inline claim sources", async () => {
    vol.fromJSON({
      "/repo/docs/spec.md": "line 1\n",
      "/repo/.poe-code/memory/pages/architecture.md": [
        "---",
        "sources:",
        "  - docs/extra.md#L1",
        "---",
        "<!-- memory:extracted source=docs/spec.md#L1 -->",
        "The architecture note cites the current spec.",
        ""
      ].join("\n")
    });

    const audit = await auditClaims("/repo/.poe-code/memory", "/repo");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ page: "pages/architecture.md" });
    expect(audit[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('frontmatter sources are missing "docs/spec.md#L1"'),
        expect.stringContaining('frontmatter sources contain stale entry "docs/extra.md#L1"')
      ])
    );
  });

  it("flags claim sources reached through repository symlinks", async () => {
    vol.fromJSON({
      "/outside/private.md": "external secret material\n",
      "/repo/docs/.keep": "",
      "/repo/.poe-code/memory/pages/note.md": [
        "---",
        "sources:",
        "  - docs/linked.md#L1",
        "---",
        "<!-- memory:extracted source=docs/linked.md#L1 -->",
        "The note cites an apparently local source.",
        ""
      ].join("\n")
    });
    await vol.promises.symlink("/outside/private.md", "/repo/docs/linked.md");

    await expect(auditClaims("/repo/.poe-code/memory", "/repo")).resolves.toEqual([
      {
        page: "pages/note.md",
        issues: [expect.stringContaining("symbolic link")]
      }
    ]);
  });
});
