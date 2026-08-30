import { describe, expect, it } from "vitest";
import {
  canonicalBundleFixture,
  makeWorkspace,
  memLintFs,
  pkgJson,
  packageFiles,
  withPackageFiles
} from "../fixtures.js";
import { loadWorkspace, parseMetafile } from "../model.js";
import { createNpmPacklistProvider } from "../packlist.js";
import { bundleSelfContained } from "./bundle-self-contained.js";

function workspace() {
  return makeWorkspace({
    "/repo/package.json": pkgJson({ name: "root", dependencies: { jose: "^6.0.0" } }),
    "/repo/packages/bar/package.json": pkgJson({ name: "bar", private: true })
  });
}

describe("bundle-self-contained", () => {
  it("skips when no build view is available", async () => {
    expect(bundleSelfContained.run(await workspace(), undefined)).toHaveLength(0);
  });

  it("flags an externalized workspace package and an undeclared external", async () => {
    const build = parseMetafile({
      inputs: { "packages/bar/src/index.ts": {}, "src/index.ts": {} },
      outputs: {
        "dist/index.js": {
          imports: [
            { path: "jose", external: true, kind: "import-statement" },
            { path: "bar", external: true, kind: "import-statement" },
            { path: "missing-dep", external: true, kind: "import-statement" },
            { path: "node:fs", external: true, kind: "import-statement" }
          ]
        }
      }
    });

    const violations = bundleSelfContained.run(await workspace(), build);
    expect(violations).toHaveLength(2);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: "bar",
          detail: { external: "bar", reason: "workspace-not-inlined" }
        }),
        expect.objectContaining({
          package: "root",
          detail: { external: "missing-dep", reason: "undeclared-dependency" }
        })
      ])
    );
  });

  it("passes when the bundle externalizes only declared deps and builtins", async () => {
    const build = parseMetafile({
      inputs: { "packages/bar/src/index.ts": {} },
      outputs: {
        "dist/index.js": {
          imports: [
            { path: "jose", external: true, kind: "import-statement" },
            { path: "node:path", external: true, kind: "import-statement" }
          ]
        }
      }
    });

    expect(bundleSelfContained.run(await workspace(), build)).toHaveLength(0);
  });

  async function canonicalFixture() {
    const { manifest, metafile, packed, source, entry, chunk, types } = canonicalBundleFixture();
    const model = withPackageFiles(
      await makeWorkspace({
        "/repo/package.json": pkgJson(manifest),
        "/repo/packages/safe-fs/package.json": pkgJson({ name: "@poe-code/safe-fs", private: true })
      }),
      [[".", packageFiles(".", [...packed])]]
    );
    return { model, metafile, source, entry, chunk, types };
  }

  it("accepts only a declared canonical self-export with its complete packed closure", async () => {
    const { model, metafile } = await canonicalFixture();
    expect(bundleSelfContained.run(model, parseMetafile(metafile))).toEqual([]);
  });

  it.each(["complete", "missing-types", "provider-omits-types"])(
    "checks canonical declarations through the CLI packlist path: %s",
    async (scenario) => {
      const { model, metafile, types } = await canonicalFixture();
      const files = Object.fromEntries(
        [...model.packageFiles.get(".")!.files]
          .filter((filename) => scenario !== "missing-types" || filename !== types)
          .map((filename) => [`/repo/${filename}`, ""])
      );
      const fs = memLintFs({
        ...files,
        "/repo/package.json": pkgJson({
          name: model.root.name,
          exports: model.root.exports,
          imports: model.root.imports,
          files: model.root.files,
          dependencies: model.root.dependencies
        }),
        "/repo/packages/safe-fs/package.json": pkgJson({ name: "@poe-code/safe-fs", private: true })
      });
      const provider = createNpmPacklistProvider(fs);
      const loaded = await loadWorkspace(fs, "/repo", {
        packlistProvider:
          scenario === "provider-omits-types"
            ? {
                async listPackageFiles(rootDir, packageDir) {
                  const packed = await provider.listPackageFiles(rootDir, packageDir);
                  if (packageDir === ".") packed.delete(types);
                  return packed;
                }
              }
            : provider
      });
      const violations = bundleSelfContained.run(loaded, parseMetafile(metafile));
      expect(violations.map((violation) => violation.detail?.reason)).toEqual(
        scenario === "complete" ? [] : ["unpacked-canonical-types"]
      );
    }
  );

  it.each([
    "unknown-subpath",
    "missing-export",
    "wrong-export",
    "wrong-types",
    "missing-root",
    "undeclared-root",
    "wrong-source",
    "missing-chunk",
    "missing-map",
    "unpacked-chunk",
    "unpacked-types",
    "duplicate-runtime",
    "foreign-canonical-input",
    "external-canonical-path",
    "packed-runtime",
    "extra-export-condition",
    "missing-source-input",
    "missing-map-metadata",
    "absolute-canonical-edge",
    "missing-other-declared-root"
  ])("rejects canonical packaging defect: %s", async (defect) => {
    const { model, metafile, source, entry, chunk, types } = await canonicalFixture();
    const exported = model.root.exports as Record<string, { import: string; types: string }>;
    if (defect === "unknown-subpath")
      metafile.outputs["dist/index.js"].imports[0].path += "/unlisted";
    if (defect === "missing-export") delete exported["./safe-fs"];
    if (defect === "wrong-export")
      exported["./safe-fs"].import = "./packages/safe-fs/dist/index.js";
    if (defect === "wrong-types") exported["./safe-fs"].types = "./missing.d.ts";
    if (defect === "missing-root") delete metafile.canonicalBundle.metafile.outputs[entry];
    if (defect === "undeclared-root") metafile.canonicalBundle.entryPoints = [];
    if (defect === "wrong-source")
      metafile.canonicalBundle.metafile.outputs[entry].entryPoint = "src/not-fs.ts";
    if (defect === "missing-chunk") delete metafile.canonicalBundle.metafile.outputs[chunk];
    if (defect === "missing-map") model.packageFiles.get(".")!.files.delete(`${chunk}.map`);
    if (defect === "unpacked-chunk") model.packageFiles.get(".")!.files.delete(chunk);
    if (defect === "unpacked-types") model.packageFiles.get(".")!.files.delete(types);
    if (defect === "duplicate-runtime") metafile.inputs[source] = {};
    if (defect === "foreign-canonical-input")
      metafile.canonicalBundle.metafile.outputs[chunk].inputs["packages/safe-js/src/run.ts"] = {};
    if (defect === "external-canonical-path")
      metafile.canonicalBundle.metafile.outputs[chunk].imports = [
        { path: "file:///tmp/other.js", external: true }
      ];
    if (defect === "packed-runtime")
      model.packageFiles.get(".")!.files.add("packages/safe-fs/dist/index.js");
    if (defect === "extra-export-condition")
      Object.assign(exported["./safe-fs"], { require: "./duplicate.cjs" });
    if (defect === "missing-source-input") delete metafile.canonicalBundle.metafile.inputs[source];
    if (defect === "missing-map-metadata")
      delete metafile.canonicalBundle.metafile.outputs[`${chunk}.map`];
    if (defect === "absolute-canonical-edge")
      metafile.canonicalBundle.metafile.outputs[entry].imports = [{ path: "/tmp/fs.js" }];
    if (defect === "missing-other-declared-root")
      metafile.canonicalBundle.entryPoints.push("packages/safe-js/src/index.ts");
    expect(bundleSelfContained.run(model, parseMetafile(metafile)).length).toBeGreaterThan(0);
  });

  it.each([
    "node:nonexistent",
    "file:///tmp/fs.js",
    "https://example.test/fs.js",
    "data:text/javascript,0",
    "./fs.js",
    "../fs.js",
    "/tmp/fs.js",
    "#fs",
    "jose/../fs",
    "jose//fs",
    "jose?alias",
    "C:\\fs.js"
  ])(
    "rejects external protocol/path even when its reduced prefix is declared: %s",
    async (specifier) => {
      const model = await workspace();
      model.root.dependencies[specifier.split("/")[0]] = "*";
      const build = parseMetafile({
        outputs: {
          "dist/index.js": {
            imports: [{ path: specifier, external: true, kind: "dynamic-import" }]
          }
        }
      });
      expect(bundleSelfContained.run(model, build).length).toBeGreaterThan(0);
    }
  );

  it("validates undeclared dynamic imports and permits declared optional dependency subpaths", async () => {
    const { model, metafile } = await canonicalFixture();
    metafile.outputs["dist/index.js"].imports.push({
      path: "braintrust/logger",
      external: true,
      kind: "dynamic-import"
    });
    expect(bundleSelfContained.run(model, parseMetafile(metafile))).toEqual([]);
    metafile.outputs["dist/index.js"].imports.push({
      path: "absent/runtime",
      external: true,
      kind: "dynamic-import"
    });
    expect(bundleSelfContained.run(model, parseMetafile(metafile))).toEqual([
      expect.objectContaining({
        detail: { external: "absent/runtime", reason: "undeclared-dependency" }
      })
    ]);
  });
});
