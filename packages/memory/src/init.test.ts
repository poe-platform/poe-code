import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { initMemory } = await import("./init.js");

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

describe("initMemory", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the memory root, pages directory, and empty index and log files", async () => {
    await initMemory("/repo/.poe-code/memory");

    await expect(vol.promises.stat("/repo/.poe-code/memory/pages")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Memory index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).resolves.toBe(
      ""
    );
  });

  it("is idempotent and preserves existing memory content", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Existing index\n",
      "/repo/.poe-code/memory/LOG.md": "- existing log\n",
      "/repo/.poe-code/memory/pages/architecture.md": "# Architecture\n"
    });

    await initMemory("/repo/.poe-code/memory");

    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Existing index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).resolves.toBe(
      "- existing log\n"
    );
    await expect(
      vol.promises.readFile("/repo/.poe-code/memory/pages/architecture.md", "utf8")
    ).resolves.toBe("# Architecture\n");
  });

  it("rejects a symlinked memory root before writing scaffold files", async () => {
    vol.fromJSON({
      "/repo/.poe-code/.keep": "",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory");

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.stat("/outside/INDEX.md")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vol.promises.stat("/outside/LOG.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked memory root ancestor before writing scaffold files", async () => {
    vol.fromJSON({
      "/repo/.keep": "",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code");

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.stat("/outside/memory/INDEX.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.stat("/outside/memory/LOG.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes newly created scaffold artifacts when initialization fails", async () => {
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).endsWith("/LOG.md")) {
        throw new Error("log scaffold failed");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow("log scaffold failed");
    await expect(vol.promises.stat("/repo/.poe-code/memory")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a partially written scaffold file when exclusive creation fails", async () => {
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).endsWith("/INDEX.md")) {
        vol.writeFileSync(String(filePath), "# Partial index\n", options as never);
        throw new Error("index scaffold failed");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow("index scaffold failed");
    await expect(vol.promises.stat("/repo/.poe-code/memory/INDEX.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.stat("/repo/.poe-code/memory")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not ignore scaffold write failures with inherited existing-path codes", async () => {
    const root = "/repo/.poe-code/memory";
    const writeFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).endsWith("/INDEX.md")) {
        throw new Error("index write denied");
      }

      await writeFile(filePath, data, options);
    });

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(initMemory(root)).rejects.toThrow("index write denied");
    });

    await expect(vol.promises.stat(`${root}/INDEX.md`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not treat inherited not-found codes as missing path stats", async () => {
    const root = "/repo/.poe-code/memory";
    const stat = vol.promises.stat.bind(vol.promises);
    vi.spyOn(vol.promises, "stat").mockImplementation(async (...args) => {
      if (String(args[0]) === root) {
        throw new Error("root stat denied");
      }

      return stat(...args);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(initMemory(root)).rejects.toThrow("root stat denied");
    });
  });
});
