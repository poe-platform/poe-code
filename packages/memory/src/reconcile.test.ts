import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { appendLogEntries, reconcile, snapshot } = await import("./reconcile.js");

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

describe("snapshot", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hashes only markdown pages under pages/", async () => {
    const root = "/repo/.poe-code/memory";
    const architecture = "# Architecture\n";
    const superintendent = ["---", "description: Loop harness", "---", "# Superintendent"].join(
      "\n"
    );

    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/architecture.md`]: architecture,
      [`${root}/pages/packages/superintendent.md`]: superintendent,
      [`${root}/notes.md`]: "# ignored\n"
    });

    await expect(snapshot(root)).resolves.toEqual({
      pages: {
        "pages/architecture.md": hash(architecture),
        "pages/packages/superintendent.md": hash(superintendent)
      }
    });
  });
});

describe("reconcile", () => {
  beforeEach(() => {
    vol.reset();
    vi.setSystemTime(new Date("2026-04-19T15:04:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stamps changed pages, denormalizes sources, rewrites the index, and appends one log line per diff", async () => {
    const root = "/repo/.poe-code/memory";
    const unchanged = ["---", "description: Already there", "---", "# Stable page", ""].join("\n");

    vol.fromJSON({
      [`${root}/INDEX.md`]: "# stale\n",
      [`${root}/LOG.md`]: "- 2026-04-18T10:00:00.000Z  **update** `pages/old.md` — old reason\n",
      [`${root}/pages/architecture.md`]: [
        "---",
        "description: Old overview",
        "sources:",
        "  - docs/old-source.md",
        "---",
        "# Architecture",
        "",
        "Old body"
      ].join("\n"),
      [`${root}/pages/deleted.md`]: "# Delete me\n",
      [`${root}/pages/unchanged.md`]: unchanged
    });

    const before = await snapshot(root);

    await vol.promises.writeFile(
      `${root}/pages/architecture.md`,
      [
        "---",
        "description: System overview",
        "sources:",
        "  - docs/old-source.md",
        "---",
        "# Architecture",
        "",
        "<!-- memory:extracted source=packages/core/src/router.ts#L10-L12 -->",
        "Routes requests through the central router.",
        "",
        "<!-- memory:inferred confidence=0.7 source=packages/core/src/router.ts#L20 -->",
        "The router keeps handlers isolated.",
        ""
      ].join("\n")
    );
    await vol.promises.mkdir(`${root}/pages/packages`, { recursive: true });
    await vol.promises.writeFile(
      `${root}/pages/packages/superintendent.md`,
      [
        "---",
        "description: Loop harness",
        "sources:",
        "  - docs/old-source.md",
        "---",
        "# Superintendent",
        "",
        "A short summary.",
        ""
      ].join("\n")
    );
    await vol.promises.unlink(`${root}/pages/deleted.md`);
    await vol.promises.writeFile(`${root}/INDEX.md`, "# broken by agent\n");

    await expect(reconcile(root, before, "ingest", "captured checkpoint rules")).resolves.toEqual({
      created: ["pages/packages/superintendent.md"],
      deleted: ["pages/deleted.md"],
      updated: ["pages/architecture.md"]
    });

    await expect(vol.promises.readFile(`${root}/pages/architecture.md`, "utf8")).resolves.toBe(
      [
        "---",
        "description: System overview",
        "last_touched_at: 2026-04-19T15:04:05.000Z",
        "sources:",
        "  - packages/core/src/router.ts#L10-L12",
        "  - packages/core/src/router.ts#L20",
        "---",
        "# Architecture",
        "",
        "<!-- memory:extracted source=packages/core/src/router.ts#L10-L12 -->",
        "Routes requests through the central router.",
        "",
        "<!-- memory:inferred confidence=0.7 source=packages/core/src/router.ts#L20 -->",
        "The router keeps handlers isolated.",
        ""
      ].join("\n")
    );

    await expect(
      vol.promises.readFile(`${root}/pages/packages/superintendent.md`, "utf8")
    ).resolves.toBe(
      [
        "---",
        "description: Loop harness",
        "last_touched_at: 2026-04-19T15:04:05.000Z",
        "---",
        "# Superintendent",
        "",
        "A short summary.",
        ""
      ].join("\n")
    );

    await expect(vol.promises.readFile(`${root}/pages/unchanged.md`, "utf8")).resolves.toBe(
      unchanged
    );

    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe(
      [
        "# Memory index",
        "",
        "- [architecture](pages/architecture.md) — System overview",
        "- [packages/superintendent](pages/packages/superintendent.md) — Loop harness",
        "- [unchanged](pages/unchanged.md) — Already there",
        ""
      ].join("\n")
    );

    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe(
      [
        "- 2026-04-18T10:00:00.000Z  **update** `pages/old.md` — old reason",
        "- 2026-04-19T15:04:05.000Z  **update** `pages/architecture.md` — captured checkpoint rules",
        "- 2026-04-19T15:04:05.000Z  **delete** `pages/deleted.md` — captured checkpoint rules",
        "- 2026-04-19T15:04:05.000Z  **create** `pages/packages/superintendent.md` — captured checkpoint rules",
        ""
      ].join("\n")
    );
  });

  it("heals missing INDEX.md and LOG.md without fabricating a diff", async () => {
    const root = "/repo/.poe-code/memory";

    vol.fromJSON({
      [`${root}/pages/architecture.md`]: [
        "---",
        "description: System overview",
        "---",
        "# A",
        ""
      ].join("\n")
    });

    const before = await snapshot(root);

    await expect(reconcile(root, before, "lint", "no issues")).resolves.toEqual({
      created: [],
      deleted: [],
      updated: []
    });

    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe(
      ["# Memory index", "", "- [architecture](pages/architecture.md) — System overview", ""].join(
        "\n"
      )
    );
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe("");
  });

  it("does not treat inherited read error codes as missing generated files", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [`${root}/LOG.md`]: "",
      [`${root}/pages/page.md`]: "# Page\n"
    });
    const before = await snapshot(root);
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (filePath, options) => {
      if (String(filePath) === `${root}/INDEX.md`) {
        throw new Error("index read denied");
      }

      return readFile(filePath, options);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(reconcile(root, before, "lint", "probe")).rejects.toThrow(
        "index read denied"
      );
    });
  });

  it("rejects a symlinked generated index before overwriting external content", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/pages/page.md`]: "# Page\n",
      [`${root}/LOG.md`]: "",
      "/outside/index.md": "external index\n"
    });
    await vol.promises.symlink("/outside/index.md", `${root}/INDEX.md`);

    await expect(reconcile(root, { pages: {} }, "update", "probe")).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.readFile("/outside/index.md", "utf8")).resolves.toBe("external index\n");
  });

  it("rejects a symlinked log before appending external history", async () => {
    const root = "/repo/.poe-code/memory";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      "/outside/log.md": "external log\n"
    });
    await vol.promises.symlink("/outside/log.md", `${root}/LOG.md`);

    await expect(
      appendLogEntries(root, { created: ["pages/new.md"], updated: [], deleted: [] }, "probe")
    ).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.readFile("/outside/log.md", "utf8")).resolves.toBe("external log\n");
  });

  it("preserves a valid index when generated index persistence fails", async () => {
    const root = "/repo/.poe-code/memory";
    const indexPath = `${root}/INDEX.md`;
    const originalIndex = "# Memory index\n\n- [old](pages/old.md) — Existing entry\n";
    vol.fromJSON({
      [indexPath]: originalIndex,
      [`${root}/LOG.md`]: "",
      [`${root}/pages/architecture.md`]: "# Old memory\n"
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(`${root}/pages/architecture.md`, "# New memory\n", "utf8");
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      const isCreateIfMissing =
        typeof options === "object" && options !== null && "flag" in options && options.flag === "wx";
      if (String(filePath).startsWith(`${indexPath}.`) || (String(filePath) === indexPath && !isCreateIfMissing)) {
        vol.writeFileSync(String(filePath), "# Memory");
        throw new Error("index disk full");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(reconcile(root, before, "update", "probe")).rejects.toThrow("index disk full");
    await expect(vol.promises.readFile(indexPath, "utf8")).resolves.toBe(originalIndex);
  });

  it("preserves audit history when log persistence fails", async () => {
    const root = "/repo/.poe-code/memory";
    const logPath = `${root}/LOG.md`;
    const originalLog = "- prior audit record\n";
    vol.fromJSON({
      [`${root}/INDEX.md`]: "# Memory index\n",
      [logPath]: originalLog
    });
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).startsWith(logPath)) {
        vol.writeFileSync(String(filePath), "- truncated");
        throw new Error("log disk full");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(
      appendLogEntries(root, { created: ["pages/new.md"], updated: [], deleted: [] }, "probe")
    ).rejects.toThrow("log disk full");
    await expect(vol.promises.readFile(logPath, "utf8")).resolves.toBe(originalLog);
  });

  it("restores generated index when audit publication fails", async () => {
    const root = "/repo/.poe-code/memory";
    const originalIndex = "# Memory index\n\n- [page](pages/page.md) — Before\n";
    vol.fromJSON({
      [`${root}/INDEX.md`]: originalIndex,
      [`${root}/LOG.md`]: "",
      [`${root}/pages/page.md`]: ["---", "description: Before", "---", "# Page", "", "old", ""].join("\n")
    });
    const before = await snapshot(root);
    await vol.promises.writeFile(
      `${root}/pages/page.md`,
      ["---", "description: After", "---", "# Page", "", "new", ""].join("\n"),
      "utf8"
    );
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).startsWith(`${root}/LOG.md.`)) {
        throw new Error("injected log publication failure");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(reconcile(root, before, "edit", "updated page")).rejects.toThrow(
      "injected log publication failure"
    );
    await expect(vol.promises.readFile(`${root}/INDEX.md`, "utf8")).resolves.toBe(originalIndex);
    await expect(vol.promises.readFile(`${root}/LOG.md`, "utf8")).resolves.toBe("");
  });
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
