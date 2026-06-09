import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("tokenfill", () => ({
  countTokens: (input: string) => {
    let count = 0;
    let inToken = false;
    for (const ch of input) {
      const isWhitespace =
        ch === " " ||
        ch === "\n" ||
        ch === "\r" ||
        ch === "\t" ||
        ch === "\f" ||
        ch === "\v";
      if (isWhitespace) {
        inToken = false;
        continue;
      }
      if (!inToken) {
        count += 1;
        inToken = true;
      }
    }
    return count;
  }
}));

const { computeTokenStats } = await import("./tokens.js");

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

describe("computeTokenStats", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts memory tokens from page bodies and source tokens from unique frontmatter sources", async () => {
    vol.fromJSON({
      "/repo/packages/a.ts": "export const a = 1;\n",
      "/repo/packages/b.ts": "export const b = 2;\nexport const c = 3;\n",
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        "  - path: packages/a.ts",
        "  - path: packages/b.ts",
        "---",
        "",
        "Hello world"
      ].join("\n"),
      "/repo/.poe-code/memory/pages/two.md": [
        "---",
        "sources:",
        "  - path: packages/a.ts",
        "  - path: packages/missing.ts",
        "---",
        "",
        "Hello"
      ].join("\n")
    });

    const stats = await computeTokenStats("/repo/.poe-code/memory");

    expect(stats).toEqual({
      memoryTokens: 3,
      sourceTokens: 15,
      reductionRatio: 5,
      missingSources: ["packages/missing.ts"]
    });
  });

  it("handles empty/uninitialized memory", async () => {
    const stats = await computeTokenStats("/repo/.poe-code/memory");

    expect(stats).toEqual({
      memoryTokens: 0,
      sourceTokens: 0,
      reductionRatio: 0,
      missingSources: []
    });
  });

  it("does not treat inherited stat error codes as missing memory roots", async () => {
    const stat = vol.promises.stat.bind(vol.promises);
    vi.spyOn(vol.promises, "stat").mockImplementation(async (targetPath) => {
      if (String(targetPath) === "/repo/.poe-code/memory") {
        throw new Error("memory stat denied");
      }

      return stat(targetPath);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(computeTokenStats("/repo/.poe-code/memory")).rejects.toThrow(
        "memory stat denied"
      );
    });
  });

  it("does not read absolute source paths outside the repository", async () => {
    vol.fromJSON({
      "/outside/private.txt": "hidden external token material",
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        "  - /outside/private.txt",
        "---",
        "memory"
      ].join("\n")
    });

    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 0,
      missingSources: ["/outside/private.txt"]
    });
  });

  it("does not report URL sources as missing local files", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        "  - https://example.test/spec.md",
        "---",
        "memory"
      ].join("\n")
    });

    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 0,
      missingSources: []
    });
  });

  it("does not count source files reached through repository symlinks", async () => {
    vol.fromJSON({
      "/outside/private.md": "external secret material\n",
      "/repo/docs/.keep": "",
      "/repo/.poe-code/memory/pages/one.md": [
        "---",
        "sources:",
        "  - docs/linked.md",
        "---",
        "memory"
      ].join("\n")
    });
    await vol.promises.symlink("/outside/private.md", "/repo/docs/linked.md");

    await expect(computeTokenStats("/repo/.poe-code/memory")).resolves.toMatchObject({
      sourceTokens: 0,
      missingSources: ["docs/linked.md"]
    });
  });
});
