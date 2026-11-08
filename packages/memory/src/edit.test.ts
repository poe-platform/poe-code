import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { editPage } = await import("./edit.js");

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

describe("editPage", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("writes editor output back through writePage when the content changed", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/architecture.md`]: [
        "---",
        "name: architecture",
        "description: System overview",
        "---",
        "# Architecture",
        "",
        "Original body.",
        ""
      ].join("\n")
    });

    const launchEditor = vi.fn(async (filePath: string) => {
      await vol.promises.writeFile(
        filePath,
        [
          "---",
          "name: architecture",
          "description: Updated overview",
          "---",
          "# Architecture",
          "",
          "Updated body.",
          ""
        ].join("\n"),
        "utf8"
      );
    });

    await expect(
      editPage(root, "pages/architecture.md", {
        reason: "refined architecture notes",
        launchEditor
      })
    ).resolves.toEqual({
      changed: true,
      diff: {
        created: [],
        deleted: [],
        updated: ["pages/architecture.md"]
      }
    });

    expect(launchEditor).toHaveBeenCalledTimes(1);
    await expect(vol.promises.readFile(`${root}/pages/architecture.md`, "utf8")).resolves.toContain(
      "description: Updated overview"
    );
    await expect(vol.promises.readFile(`${root}/pages/architecture.md`, "utf8")).resolves.toContain(
      "Updated body."
    );
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toContain(
      "refined architecture notes"
    );
  });

  it("returns unchanged without writing when the editor makes no modifications", async () => {
    const root = "/repo/.poe-code/memory";
    const markdown = "# Existing\n";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/notes.md`]: markdown
    });

    const launchEditor = vi.fn(async () => {});

    await expect(
      editPage(root, "pages/notes.md", {
        reason: "no-op edit",
        launchEditor
      })
    ).resolves.toEqual({
      changed: false,
      diff: undefined
    });

    expect(launchEditor).toHaveBeenCalledTimes(1);
    await expect(vol.promises.readFile(`${root}/pages/notes.md`, "utf8")).resolves.toBe(markdown);
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe("");
  });

  it("creates a new page when editing a missing file under pages/", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: ""
    });

    const launchEditor = vi.fn(async (filePath: string) => {
      await vol.promises.writeFile(filePath, "# New page\n", "utf8");
    });

    await expect(
      editPage(root, "pages/packages/new-feature.md", {
        reason: "captured feature notes",
        launchEditor
      })
    ).resolves.toEqual({
      changed: true,
      diff: {
        created: ["pages/packages/new-feature.md"],
        deleted: [],
        updated: []
      }
    });

    await expect(
      vol.promises.readFile(`${root}/pages/packages/new-feature.md`, "utf8")
    ).resolves.toContain("# New page");
  });

  it("does not open the editor for read errors with inherited missing codes", async () => {
    const root = "/repo/.poe-code/memory";
    const pagePath = `${root}/pages/packages/new-feature.md`;
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: ""
    });
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (...args) => {
      if (String(args[0]) === pagePath) {
        throw new Error("editor source read denied");
      }

      return readFile(...args);
    });
    const launchEditor = vi.fn(async () => {});

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        editPage(root, "pages/packages/new-feature.md", {
          reason: "captured feature notes",
          launchEditor
        })
      ).rejects.toThrow("editor source read denied");
    });

    expect(launchEditor).not.toHaveBeenCalled();
  });

  it("rejects traversal paths before copying source content to the editor", async () => {
    const root = "/repo/.poe-code/memory";
    const launchEditor = vi.fn(async () => {});
    vol.fromJSON({
      [`${root}/pages/.keep`]: "",
      "/repo/.poe-code/secret.md": "outside-memory-secret\n"
    });

    await expect(
      editPage(root, "../secret.md", { reason: "inspect", launchEditor })
    ).rejects.toThrow("cannot escape");
    expect(launchEditor).not.toHaveBeenCalled();
  });

  it("rejects a symlinked temporary directory before copying page content", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/pages/note.md`]: "# Secret page\n",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", `${root}/.tmp`);
    const launchEditor = vi.fn(async () => {});

    await expect(
      editPage(root, "pages/note.md", { reason: "read", launchEditor })
    ).rejects.toThrow(/symbolic link/i);
    expect(launchEditor).not.toHaveBeenCalled();
    await expect(vol.promises.readdir("/outside")).resolves.toEqual([".keep"]);
  });

  it("returns a persisted update even when temporary cleanup fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/note.md`]: "---\nname: note\n---\nOriginal\n"
    });
    vi.spyOn(vol.promises, "rm").mockRejectedValue(new Error("temp cleanup denied"));

    await expect(
      editPage(root, "pages/note.md", {
        reason: "update note",
        launchEditor: async (filePath) => {
          await vol.promises.writeFile(filePath, "---\nname: note\n---\nUpdated\n", "utf8");
        }
      })
    ).resolves.toMatchObject({ changed: true });
    await expect(vol.promises.readFile(`${root}/pages/note.md`, "utf8")).resolves.toContain("Updated");
  });
});
