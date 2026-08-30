import { expect, it, vi } from "vitest";
import { loadBuildView, loadWorkspace, parseMetafile } from "./model.js";
import { memLintFs, pkgJson } from "./fixtures.js";
import { createNpmPacklistProvider } from "./packlist.js";

it("preserves raw external specifiers and canonical producer evidence", () => {
  const canonicalBundle = {
    entryPoints: ["packages/safe-fs/src/index.ts"],
    metafile: { outputs: {} }
  };
  const build = parseMetafile({
    outputs: {
      "dist/index.js": {
        imports: [
          { path: "poe-code/safe-fs", external: true },
          { path: "node:nonexistent", external: true },
          { path: "file:///tmp/evil.js", external: true, kind: "dynamic-import" }
        ]
      }
    },
    canonicalBundle
  });
  expect(build.externalImports).toEqual(
    new Set(["poe-code/safe-fs", "node:nonexistent", "file:///tmp/evil.js"])
  );
  expect(build.metafile.canonicalBundle).toEqual(canonicalBundle);
  expect(build.externals).toContain("file:");
});

it.each([
  ["packages/safe-fs", "/outside/package"],
  ["packages/safe-fs/dist", "/outside/package/dist"],
  ["packages/safe-fs/dist/nested", "/outside/package/dist/nested"],
  ["packages/safe-fs/dist/index.d.ts", "/outside/package/dist/index.d.ts"]
])(
  "rejects canonical declaration symlink %s before traversal or payload reads",
  async (link, target) => {
    const fs = memLintFs(
      {
        "/repo/dist/metafile.json": pkgJson({ canonicalBundle: {} }),
        "/outside/package/dist/index.d.ts": "export type Held = string;",
        "/outside/package/dist/nested/index.d.ts": "export type Held = string;"
      },
      { [`/repo/${link}`]: target }
    );
    const readFile = vi.spyOn(fs, "readFile");
    const readdir = vi.spyOn(fs, "readdir");

    await expect(loadBuildView(fs, "/repo")).rejects.toThrow("Unsupported source");

    expect(readFile.mock.calls.filter(([file]) => file.endsWith(".d.ts"))).toEqual([]);
    expect(
      readdir.mock.calls.filter(
        ([file]) => file === `/repo/${link}` || file.startsWith(`/repo/${link}/`)
      )
    ).toEqual([]);
  }
);

it.each(["lstat", "realpath"] as const)(
  "rejects canonical declaration collection without %s metadata before payload reads",
  async (method) => {
    const fs = memLintFs({
      "/repo/dist/metafile.json": pkgJson({ canonicalBundle: {} }),
      "/repo/packages/safe-fs/dist/index.d.ts": "export {};"
    });
    fs[method] = undefined;
    const readFile = vi.spyOn(fs, "readFile");

    await expect(loadBuildView(fs, "/repo")).rejects.toThrow("metadata support");

    expect(readFile.mock.calls).toEqual([["/repo/dist/metafile.json"]]);
  }
);

it.each(["special", "canonical-escape", "excluded-identity"])(
  "rejects canonical declaration %s metadata before reading the declaration",
  async (defect) => {
    const target = "/repo/packages/safe-fs/dist/index.d.ts";
    const held = "/repo/packages/safe-fs/src/held.d.ts";
    const fs = memLintFs({
      "/repo/dist/metafile.json": pkgJson({ browserCanonicalBundle: {} }),
      "/repo/packages/safe-fs/package.json": pkgJson({
        name: "@poe-code/safe-fs",
        poeCode: { packageLint: { sourceExclude: ["src/held.d.ts"] } }
      }),
      [target]: "export {};",
      [held]: "export type Held = string;"
    });
    const lstat = fs.lstat!.bind(fs);
    const realpath = fs.realpath!.bind(fs);
    fs.lstat = async (file) => {
      if (file === target && defect === "excluded-identity") return lstat(held);
      const stat = await lstat(file);
      if (file === target && defect === "special") {
        return {
          ...stat,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
      }
      return stat;
    };
    fs.realpath = (file) =>
      file === target && defect === "canonical-escape"
        ? Promise.resolve("/outside/held.d.ts")
        : realpath(file);
    const readFile = vi.spyOn(fs, "readFile");

    await expect(loadBuildView(fs, "/repo")).rejects.toThrow();

    expect(readFile).not.toHaveBeenCalledWith(target);
    expect(readFile).not.toHaveBeenCalledWith(held);
  }
);

it("validates canonical package exclusions before reading declarations", async () => {
  const target = "/repo/packages/safe-fs/dist/index.d.ts";
  const fs = memLintFs({
    "/repo/dist/metafile.json": pkgJson({ canonicalBundle: {} }),
    "/repo/packages/safe-fs/package.json": pkgJson({
      name: "@poe-code/safe-fs",
      poeCode: { packageLint: { sourceExclude: ["src"] } }
    }),
    [target]: "export {};"
  });
  const readFile = vi.spyOn(fs, "readFile");

  await expect(loadBuildView(fs, "/repo")).rejects.toThrow("sourceExclude");

  expect(readFile).not.toHaveBeenCalledWith(target);
});

it.each([undefined, null, false, 0, -0, "", Number.NaN])(
  "preserves canonical declaration payload failure identity %s",
  async (reason) => {
    const target = "/repo/packages/safe-fs/dist/index.d.ts";
    const fs = memLintFs({
      "/repo/dist/metafile.json": pkgJson({ canonicalBundle: {} }),
      [target]: "export {};"
    });
    const readFile = fs.readFile.bind(fs);
    const rejectedRead = vi.fn<() => Promise<string>>().mockRejectedValue(reason);
    fs.readFile = (file) => (file === target ? rejectedRead() : readFile(file));
    let failed = false;
    try {
      await loadBuildView(fs, "/repo");
    } catch (error) {
      failed = true;
      expect(Object.is(error, reason)).toBe(true);
    }
    expect(failed).toBe(true);
  }
);

it.each([false, true])(
  "expands declaration-only files with explicit CLI provider: %s",
  async (explicit) => {
    const fs = memLintFs({
      "/repo/package.json": pkgJson({
        name: "poe-code",
        files: ["packages/safe-fs/dist/**/*.d.ts"]
      }),
      "/repo/packages/safe-fs/package.json": pkgJson({ name: "@poe-code/safe-fs", private: true }),
      "/repo/packages/safe-fs/dist/index.d.ts": 'export * from "./nested/contracts.js";',
      "/repo/packages/safe-fs/dist/nested/contracts.d.ts": "export interface FileSystem {}",
      "/repo/packages/safe-fs/dist/index.js": "throw new Error('second implementation');"
    });
    const model = await loadWorkspace(
      fs,
      "/repo",
      explicit ? { packlistProvider: createNpmPacklistProvider(fs) } : {}
    );
    expect(model.packageFiles.get(".")!.files).toEqual(
      new Set(["packages/safe-fs/dist/index.d.ts", "packages/safe-fs/dist/nested/contracts.d.ts"])
    );
  }
);

it("does not replace an authoritative provider's omitted declarations with source allowlist matches", async () => {
  const model = await loadWorkspace(
    memLintFs({
      "/repo/package.json": pkgJson({
        name: "poe-code",
        files: ["packages/safe-fs/dist/**/*.d.ts"]
      }),
      "/repo/packages/safe-fs/dist/index.d.ts": "export {};"
    }),
    "/repo",
    {
      packlistProvider: {
        async listPackageFiles() {
          return new Set();
        }
      }
    }
  );
  expect(model.packageFiles.get(".")!.files).toEqual(new Set());
});
