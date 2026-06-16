import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { appendToPage, clearMemory, writePage } = await import("./write.js");

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

  it("preserves existing memory when replacement scaffold initialization fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Existing index\n",
      [`${root}/LOG.md`]: "- existing audit\n",
      [`${root}/pages/page.md`]: "# Existing page\n"
    });
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).includes(".clear-") && String(filePath).endsWith("/INDEX.md")) {
        throw new Error("injected index recreate failure");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(clearMemory(root)).rejects.toThrow("injected index recreate failure");
    await expect(vol.promises.readFile(`${root}/pages/page.md`, "utf8")).resolves.toBe("# Existing page\n");
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe("- existing audit\n");
    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe("# Existing index\n");
  });

  it("clears memory without traversing a symlinked child directory", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Existing index\n",
      [`${root}/LOG.md`]: "- existing audit\n",
      "/outside/secret.md": "preserve outside\n"
    });
    await vol.promises.mkdir(`${root}/pages`, { recursive: true });
    await vol.promises.symlink("/outside", `${root}/pages/linked`);

    await expect(clearMemory(root)).resolves.toBeUndefined();
    await expect(vol.promises.readFile("/outside/secret.md", "utf8")).resolves.toBe("preserve outside\n");
    await expect(vol.promises.readdir(`${root}/pages`)).resolves.toEqual([]);
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

  it("removes a newly written page when index publication fails", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: ""
    });
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).startsWith(`${root}/INDEX.md.`)) {
        throw new Error("index offline");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(
      writePage(root, "pages/new.md", "# New memory\n", { reason: "write" })
    ).rejects.toThrow("index offline");
    await expect(vol.promises.stat(`${root}/pages/new.md`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe("# Memory index\n");
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

  it("does not treat inherited not-found codes as a missing original page", async () => {
    const root = "/repo/.poe-code/memory";
    const pagePath = `${root}/pages/new.md`;
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: ""
    });

    let deniedInitialRead = false;
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (...args) => {
      if (!deniedInitialRead && String(args[0]) === pagePath) {
        deniedInitialRead = true;
        throw new Error("page read denied");
      }

      return readFile(...args);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        writePage(root, "pages/new.md", "# New memory\n", { reason: "write" })
      ).rejects.toThrow("page read denied");
    });

    expect(deniedInitialRead).toBe(true);
  });
});

describe("appendToPage", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-04-19T16:12:13.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("appends to pages with malformed frontmatter using the same tolerant body as readPage", async () => {
    const root = "/repo/.poe-code/memory";
    const original = ["---", "description: [broken", "---", "# Broken", "", "body", ""].join("\n");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/broken.md`]: original
    });

    await expect(
      appendToPage(root, "pages/broken.md", "\nappend\n", { reason: "append" })
    ).resolves.toEqual({ created: [], updated: ["pages/broken.md"], deleted: [] });

    await expect(vol.promises.readFile(`${root}/pages/broken.md`, "utf8")).resolves.toContain(
      `${original}\nappend\n`
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

  it("preserves existing authored content when append persistence fails", async () => {
    const root = "/repo/.poe-code/memory";
    const pagePath = `${root}/pages/architecture.md`;
    const originalContent = "---\nname: architecture\n---\n# Existing memory\n";
    vol.fromJSON({
      [pagePath]: originalContent,
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: ""
    });
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).startsWith(pagePath)) {
        vol.writeFileSync(String(filePath), "---\nname:");
        throw new Error("page disk full");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(
      appendToPage(root, "pages/architecture.md", "\nNew detail.\n", { reason: "probe" })
    ).rejects.toThrow("page disk full");
    await expect(vol.promises.readFile(pagePath, "utf8")).resolves.toBe(originalContent);
  });
});
