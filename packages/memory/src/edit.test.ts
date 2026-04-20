import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { editPage } = await import("./edit.js");

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
});
