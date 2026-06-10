import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { statusOf } = await import("./status.js");

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

describe("statusOf", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports an uninitialized memory root when the directory is missing", async () => {
    await expect(statusOf("/repo/.poe-code/memory")).resolves.toEqual({
      pageCount: 0,
      totalBytes: 0,
      lastWriteAt: null,
      initialized: false
    });
  });

  it("reports an empty memory directory as uninitialized", async () => {
    vol.mkdirSync("/repo/.poe-code/memory", { recursive: true });

    await expect(statusOf("/repo/.poe-code/memory")).resolves.toEqual({
      pageCount: 0,
      totalBytes: 0,
      lastWriteAt: null,
      initialized: false
    });
  });

  it("does not report uninitialized status for stat errors with inherited missing codes", async () => {
    const root = "/repo/.poe-code/memory";
    const stat = vol.promises.stat.bind(vol.promises);
    vi.spyOn(vol.promises, "stat").mockImplementation(async (...args) => {
      if (String(args[0]) === root) {
        throw new Error("status stat denied");
      }

      return stat(...args);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(statusOf(root)).rejects.toThrow("status stat denied");
    });
  });

  it("counts pages, totals markdown bytes, and reports the newest markdown mtime", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n",
      "/repo/.poe-code/memory/LOG.md": "- log\n",
      "/repo/.poe-code/memory/pages/architecture.md": "# Architecture\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n",
      "/repo/.poe-code/memory/.cache/ingest/a.json": '{"ignored":true}',
      "/repo/.poe-code/memory/pages/notes.txt": "ignore me"
    });

    vol.utimesSync(
      "/repo/.poe-code/memory/INDEX.md",
      new Date("2026-04-18T10:00:00.000Z"),
      new Date("2026-04-18T10:00:00.000Z")
    );
    vol.utimesSync(
      "/repo/.poe-code/memory/LOG.md",
      new Date("2026-04-18T11:00:00.000Z"),
      new Date("2026-04-18T11:00:00.000Z")
    );
    vol.utimesSync(
      "/repo/.poe-code/memory/pages/architecture.md",
      new Date("2026-04-18T12:00:00.000Z"),
      new Date("2026-04-18T12:00:00.000Z")
    );
    vol.utimesSync(
      "/repo/.poe-code/memory/pages/packages/superintendent.md",
      new Date("2026-04-18T13:00:00.000Z"),
      new Date("2026-04-18T13:00:00.000Z")
    );

    await expect(statusOf("/repo/.poe-code/memory")).resolves.toEqual({
      pageCount: 2,
      totalBytes:
        Buffer.byteLength("# Index\n") +
        Buffer.byteLength("- log\n") +
        Buffer.byteLength("# Architecture\n") +
        Buffer.byteLength("# Superintendent\n"),
      lastWriteAt: "2026-04-18T13:00:00.000Z",
      initialized: true
    });
  });

  it("rejects a symlinked initialized memory root", async () => {
    vol.fromJSON({
      "/outside/memory/INDEX.md": "# Index\n",
      "/outside/memory/LOG.md": "- log\n",
      "/outside/memory/pages/secret.md": "# Outside\n"
    });
    vol.mkdirSync("/repo/.poe-code", { recursive: true });
    await vol.promises.symlink("/outside/memory", "/repo/.poe-code/memory");

    await expect(statusOf("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlinked pages directory before counting pages", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n",
      "/repo/.poe-code/memory/LOG.md": "- log\n",
      "/outside/pages/secret.md": "# Outside\n"
    });
    await vol.promises.symlink("/outside/pages", "/repo/.poe-code/memory/pages");

    await expect(statusOf("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
  });
});
