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
    "/repo/dist/types/safe-fs/contracts/errors.d.ts":
      'import type { PlatformErrno } from "#safe-fs-platform"; export type Imported = import("./types.js").FileSystem; export * from "./other.js"; import Legacy = require("./legacy.js");',
    "/repo/dist/types/safe-fs/node-unavailable.d.ts": "export {};",
    "/repo/dist/types/safe-fs/index.js": "throw new Error('unpublished runtime');"
  });
  const build = await loadBuildView(fs, "/repo");
  expect(build?.metafile.canonicalTypes).toEqual({
    "dist/types/safe-fs/contracts/errors.d.ts": [
      "#safe-fs-platform",
      "./types.js",
      "./other.js",
      "./legacy.js"
    ],
    "dist/types/safe-fs/node-unavailable.d.ts": []
  });
  expect(build?.metafile.canonicalEmptyTypes).toEqual([
    "dist/types/safe-fs/node-unavailable.d.ts"
  ]);
  expect(await collectCanonicalDeclarations("/repo", fs)).toMatchObject({
    canonicalTypes: build?.metafile.canonicalTypes
  });
});

it("does not silently skip build policy when emitted declaration inspection fails", async () => {
  const fs = memLintFs({
    "/repo/dist/metafile.json": JSON.stringify({ canonicalBundle: {} }),
    "/repo/dist/types/safe-fs/index.d.ts": "export {};"
  });
  const failure = Object.assign(new Error("declarations unreadable"), { code: "EACCES" });
  fs.readdir = async () => {
    throw failure;
  };
  await expect(loadBuildView(fs, "/repo")).rejects.toBe(failure);
});

it("loads the extracted XML declaration through its own package boundary", async () => {
  const fs = memLintFs({
    "/repo/dist/metafile.json": JSON.stringify({ canonicalBundle: {} }),
    "/repo/dist/types/safe-fs/xml.d.ts": 'export * from "../xml-ast/index.js";',
    "/repo/dist/types/xml-ast/index.d.ts": "export declare class XmlLimitError extends SyntaxError {}",
    "/repo/dist/types/xml-ast/unapproved.d.ts": "export {};"
  });
  const readFile = vi.spyOn(fs, "readFile");
  const build = await loadBuildView(fs, "/repo");
  expect(build?.metafile.canonicalTypes).toEqual({
    "dist/types/safe-fs/xml.d.ts": ["../xml-ast/index.js"],
    "dist/types/xml-ast/index.d.ts": []
  });
  expect(readFile).not.toHaveBeenCalledWith("/repo/dist/types/xml-ast/unapproved.d.ts");
});

it.each([
  ["dist/types", "/outside/xml"],
  ["dist/types/xml-ast", "/outside/xml/dist"],
  ["dist/types/xml-ast/index.d.ts", "/outside/xml/dist/index.d.ts"]
])("rejects extracted XML declaration symlink %s before payload reads", async (link, target) => {
  const fs = memLintFs({
    "/repo/dist/metafile.json": JSON.stringify({ canonicalBundle: {} }),
    "/outside/xml/dist/index.d.ts": "export {};"
  }, { [`/repo/${link}`]: target });
  const readFile = vi.spyOn(fs, "readFile");
  await expect(loadBuildView(fs, "/repo")).rejects.toThrow("Unsupported source");
  expect(readFile.mock.calls.filter(([file]) => file.endsWith(".d.ts"))).toEqual([]);
});

it("rejects extracted XML declarations whose canonical path leaves their package", async () => {
  const target = "/repo/dist/types/xml-ast/index.d.ts";
  const fs = memLintFs({
    "/repo/dist/metafile.json": JSON.stringify({ canonicalBundle: {} }),
    [target]: "export {};"
  });
  const realpath = fs.realpath!.bind(fs);
  fs.realpath = file => file === target ? Promise.resolve("/outside/index.d.ts") : realpath(file);
  const readFile = vi.spyOn(fs, "readFile");
  await expect(loadBuildView(fs, "/repo")).rejects.toThrow("Canonical source path escapes");
  expect(readFile).not.toHaveBeenCalledWith(target);
});

it.each(["complete", "unknown-private-type", "private-runtime", "missing-policy-types"])(
  "runs all 18 rules with exact private type edge handling: %s",
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
      files["/repo/dist/types/safe-fs/core.d.ts"] +=
        '\nexport type Bad = import("#other").Type;';
    if (defect === "missing-policy-types")
      packed.delete("dist/types/safe-fs/platform/browser.d.ts");
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
    expect(result.evaluated).toHaveLength(18);
    expect(result.skipped).toEqual([]);
    expect(result.violations).toEqual(
      defect === "complete"
        ? []
        : expect.arrayContaining([expect.objectContaining({ rule: "bundle-self-contained" })])
    );
  }
);
