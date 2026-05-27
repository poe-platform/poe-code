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
});
