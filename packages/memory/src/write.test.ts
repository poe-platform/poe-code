import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { appendToPage, clearMemory, writePage } = await import("./write.js");

describe("clearMemory", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("wipes pages and cache content, then regenerates empty index and log files", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Existing index\n",
      "/repo/.poe-code/memory/LOG.md": "- old entry\n",
      "/repo/.poe-code/memory/pages/architecture.md": "# Architecture\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n",
      "/repo/.poe-code/memory/.cache/ingest/source.json": '{"cached":true}\n',
      "/repo/.poe-code/memory/notes.md": "# stray\n"
    });

    await clearMemory("/repo/.poe-code/memory");

    await expect(vol.promises.readdir("/repo/.poe-code/memory/pages")).resolves.toEqual([]);
    await expect(vol.promises.stat("/repo/.poe-code/memory/.cache")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Memory index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).resolves.toBe("");
    await expect(vol.promises.stat("/repo/.poe-code/memory/notes.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects a symlinked memory root without deleting external content", async () => {
    vol.fromJSON({
      "/repo/.poe-code/.keep": "",
      "/outside/pages/remove.md": "preserve me\n",
      "/outside/INDEX.md": "# external index\n",
      "/outside/LOG.md": "external log\n"
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory");

    await expect(clearMemory("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.readFile("/outside/pages/remove.md", "utf8")).resolves.toBe("preserve me\n");
    await expect(vol.promises.readFile("/outside/INDEX.md", "utf8")).resolves.toBe("# external index\n");
  });
});

describe("writePage", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-04-19T16:12:13.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes a page, then reconciles index, log, and frontmatter", async () => {
    const root = "/repo/.poe-code/memory";

    vol.fromJSON({
      [`${root}/INDEX.md`]: "# stale index\n",
      [`${root}/LOG.md`]:
        "- 2026-04-18T10:00:00.000Z  **update** `pages/architecture.md` — old reason\n",
      [`${root}/pages/architecture.md`]: [
        "---",
        "description: System overview",
        "---",
        "# Architecture",
        ""
      ].join("\n")
    });

    await expect(
      writePage(
        root,
        "pages/packages/superintendent.md",
        ["# Superintendent", "", "Checkpoint rules live here.", ""].join("\n"),
        {
          frontmatter: {
            name: "superintendent",
            description: "Loop harness"
          },
          reason: "captured checkpoint rules"
        }
      )
    ).resolves.toEqual({
      created: ["pages/packages/superintendent.md"],
      deleted: [],
      updated: []
    });

    await expect(
      vol.promises.readFile(`${root}/pages/packages/superintendent.md`, "utf8")
    ).resolves.toBe(
      [
        "---",
        "name: superintendent",
        "description: Loop harness",
        "last_touched_at: 2026-04-19T16:12:13.000Z",
        "---",
        "# Superintendent",
        "",
        "Checkpoint rules live here.",
        ""
      ].join("\n")
    );

    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe(
      [
        "# Memory index",
        "",
        "- [architecture](pages/architecture.md) — System overview",
        "- [packages/superintendent](pages/packages/superintendent.md) — Loop harness",
        ""
      ].join("\n")
    );

    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe(
      [
        "- 2026-04-18T10:00:00.000Z  **update** `pages/architecture.md` — old reason",
        "- 2026-04-19T16:12:13.000Z  **create** `pages/packages/superintendent.md` — captured checkpoint rules",
        ""
      ].join("\n")
    );
  });

  it("rejects writes through symlinked page directories", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      "/outside/.keep": ""
    });
    await vol.promises.mkdir(`${root}/pages`, { recursive: true });
    await vol.promises.symlink("/outside", `${root}/pages/linked`);

    await expect(
      writePage(root, "pages/linked/new.md", "# New outside\n", { reason: "write" })
    ).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.stat("/outside/new.md")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("appendToPage", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-04-19T17:18:19.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("preserves frontmatter, appends only to the body, and logs an update", async () => {
    const root = "/repo/.poe-code/memory";

    vol.fromJSON({
      [`${root}/INDEX.md`]: "# stale index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/architecture.md`]: [
        "---",
        "name: architecture",
        "description: System overview",
        "---",
        "# Architecture",
        "",
        "Existing detail.",
        ""
      ].join("\n")
    });

    await expect(
      appendToPage(root, "pages/architecture.md", "\nNew detail.\n", {
        reason: "captured follow-up"
      })
    ).resolves.toEqual({
      created: [],
      deleted: [],
      updated: ["pages/architecture.md"]
    });

    await expect(vol.promises.readFile(`${root}/pages/architecture.md`, "utf8")).resolves.toBe(
      [
        "---",
        "name: architecture",
        "description: System overview",
        "last_touched_at: 2026-04-19T17:18:19.000Z",
        "---",
        "# Architecture",
        "",
        "Existing detail.",
        "",
        "New detail.",
        ""
      ].join("\n")
    );

    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe(
      [
        "- 2026-04-19T17:18:19.000Z  **update** `pages/architecture.md` — captured follow-up",
        ""
      ].join("\n")
    );
  });

  it("rejects appends through symlinked page directories", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      "/outside/existing.md": "# Outside\n"
    });
    await vol.promises.mkdir(`${root}/pages`, { recursive: true });
    await vol.promises.symlink("/outside", `${root}/pages/linked`);

    await expect(
      appendToPage(root, "pages/linked/existing.md", "appended outside\n", { reason: "append" })
    ).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.readFile("/outside/existing.md", "utf8")).resolves.toBe("# Outside\n");
  });
});
