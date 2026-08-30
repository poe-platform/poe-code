import { expect, it, vi } from "vitest";
import { collectCanonicalDeclarations } from "./bundle-policy.js";
import { loadBuildView, loadWorkspace, parseMetafile } from "./model.js";
import { canonicalBundleFixture, memLintFs, pkgJson } from "./fixtures.js";
import { runRules } from "./rules/index.js";

it("loads pure policy without a compiler but rejects declaration collection without it", async () => {
  const unavailableCompiler = vi.fn(() => {
    throw new Error("TypeScript is unavailable in this production consumer");
  });
  vi.resetModules();
  vi.doMock("typescript", unavailableCompiler);
  try {
    const policy = await import("./bundle-policy.js");
    expect(policy.findBundleIssues).toBeTypeOf("function");
    expect(unavailableCompiler).not.toHaveBeenCalled();
    await expect(policy.collectCanonicalDeclarations("/repo", memLintFs({}))).rejects.toThrow();
    expect(unavailableCompiler).toHaveBeenCalledOnce();
  } finally {
    vi.doUnmock("typescript");
    vi.resetModules();
  }
});

it("collects import-type and reexport edges from emitted declarations, not saved metadata", async () => {
  const fs = memLintFs({
    "/repo/dist/metafile.json": JSON.stringify({
      canonicalBundle: { entryPoints: [], metafile: {} },
      canonicalTypes: { stale: [] }
    }),
    "/repo/packages/safe-fs/dist/contracts/errors.d.ts":
      'import type { PlatformErrno } from "#safe-fs-platform"; export type Imported = import("./types.js").FileSystem; export * from "./other.js"; import Legacy = require("./legacy.js");',
    "/repo/packages/safe-fs/dist/node-unavailable.d.ts": "export {};",
    "/repo/packages/safe-fs/dist/index.js": "throw new Error('unpublished runtime');"
  });
  const build = await loadBuildView(fs, "/repo");
  expect(build?.metafile.canonicalTypes).toEqual({
    "packages/safe-fs/dist/contracts/errors.d.ts": [
      "#safe-fs-platform",
      "./types.js",
      "./other.js",
      "./legacy.js"
    ],
    "packages/safe-fs/dist/node-unavailable.d.ts": []
  });
  expect(build?.metafile.canonicalEmptyTypes).toEqual([
    "packages/safe-fs/dist/node-unavailable.d.ts"
  ]);
  expect(await collectCanonicalDeclarations("/repo", fs)).toMatchObject({
    canonicalTypes: build?.metafile.canonicalTypes
  });
});

it("does not silently skip build policy when emitted declaration inspection fails", async () => {
  const fs = memLintFs({ "/repo/dist/metafile.json": JSON.stringify({ canonicalBundle: {} }) });
  const failure = Object.assign(new Error("declarations unreadable"), { code: "EACCES" });
  fs.readdir = async () => {
    throw failure;
  };
  await expect(loadBuildView(fs, "/repo")).rejects.toBe(failure);
});

it.each(["complete", "unknown-private-type", "private-runtime", "missing-policy-types"])(
  "runs all 17 rules with exact private type edge handling: %s",
  async (defect) => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    packed.add("LICENSE");
    const files: Record<string, string> = {
      "/repo/package.json": pkgJson({ ...manifest, license: "MIT" }),
      "/repo/README.md": "fixture",
      "/repo/packages/safe-fs/package.json": pkgJson({ name: "@poe-code/safe-fs", private: true }),
      "/repo/packages/safe-fs/README.md": "fixture",
      "/repo/.github/workflows/release.yml":
        "name: Release\non: push\njobs:\n  publish:\n    steps:\n      - run: npm publish\n"
    };
    for (const filename of packed)
      files[`/repo/${filename}`] = filename.endsWith(".d.ts")
        ? metafile.canonicalTypes[filename]
            .map((specifier) => `export * from "${specifier}";`)
            .join("\n") || "export {};"
        : "export {};";
    if (defect === "unknown-private-type")
      files["/repo/packages/safe-fs/dist/core.d.ts"] +=
        '\nexport type Bad = import("#other").Type;';
    if (defect === "missing-policy-types")
      packed.delete("packages/safe-fs/dist/platform/browser.d.ts");
    if (defect === "private-runtime")
      metafile.outputs["dist/index.js"].imports.push({
        path: "#safe-fs-platform",
        external: true,
        kind: "import-statement"
      });
    const fs = memLintFs(files);
    const model = await loadWorkspace(fs, "/repo", {
      packlistProvider: {
        async listPackageFiles(_root, directory) {
          return directory === "." ? packed : new Set();
        }
      }
    });
    Object.assign(metafile, await collectCanonicalDeclarations("/repo", fs));
    const result = runRules(model, parseMetafile(metafile));
    expect(result.evaluated).toHaveLength(17);
    expect(result.skipped).toEqual([]);
    expect(result.violations).toEqual(
      defect === "complete"
        ? []
        : expect.arrayContaining([expect.objectContaining({ rule: "bundle-self-contained" })])
    );
  }
);
