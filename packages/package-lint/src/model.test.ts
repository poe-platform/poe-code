import { expect, it } from "vitest";
import { loadWorkspace, parseMetafile } from "./model.js";
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
});

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
