import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { parseMetafile } from "../model.js";
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
});
