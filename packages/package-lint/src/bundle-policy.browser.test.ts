import { describe, expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

describe("Node-only SafeJS browser boundary", () => {
  const routes = ["./safejs", "./safejs/core", "./safejs/cli"] as const;
  it.each(routes)("rejects unsafe export conditions for %s", (route) => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
    const original = manifest.exports[route];
    const variants = [
      undefined,
      { types: original.types.default, import: original.import },
      { ...original, browser: original.import },
      { types: original.types, import: original.import, browser: null },
      { ...original, types: { ...original.types, browser: original.types.default } },
      { ...original, types: { ...original.types, default: "./missing.d.ts" } },
      { ...original, import: "./missing.js" }
    ];
    for (const value of variants) {
      const changed = { ...manifest, exports: { ...manifest.exports, [route]: value } };
      expect(findBundleIssues(changed, new Set(), metafile, packed)).toContainEqual({
        external: `poe-code${route.slice(1)}`,
        reason: "invalid-node-only-safejs-export"
      });
    }
  });
  it.each(routes)("does not add %s to the self-import exception", (route) => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    metafile.outputs["dist/index.js"].imports.push({
      path: `poe-code${route.slice(1)}`,
      external: true,
      kind: "import-statement"
    });
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
      external: `poe-code${route.slice(1)}`,
      reason: "workspace-not-inlined"
    });
  });
  it("does not deny unrelated public routes", () => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    const extended = {
      ...manifest,
      exports: { ...manifest.exports, "./credentials": { import: "./dist/credentials.js" } }
    };
    expect(findBundleIssues(extended, new Set(), metafile, packed)).toEqual([]);
  });
});

describe("conditional canonical FS publication", () => {
  it.each(["contracts/errors.ts", "bridge/filesystem.ts"])(
    "rejects multiple packed copies of %s inside one profile",
    (filename) => {
      const { manifest, metafile, packed, entry, chunk } = canonicalBundleFixture();
      const canonical = metafile.canonicalBundle.metafile;
      const singleton = `packages/safe-fs/src/${filename}`;
      canonical.inputs[singleton] = {};
      canonical.outputs[chunk].inputs[singleton] = {};
      expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
      canonical.outputs[entry].inputs[singleton] = {};
      expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
        external: "poe-code/safe-fs",
        reason: "duplicate-canonical-singleton"
      });
    }
  );
  it("accepts a reachable dynamic chunk, not an undeclared public root", () => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    const output = "packages/safejs/dist/chunks/lazy.js";
    const canonical = metafile.canonicalBundle.metafile;
    canonical.outputs[output] = {
      entryPoint: "packages/safe-fs/src/lazy.ts",
      imports: [],
      inputs: {}
    };
    canonical.outputs[`${output}.map`] = { imports: [], inputs: {} };
    canonical.outputs["packages/safejs/dist/chunks/fs.js"].imports.push({ path: output });
    packed.add(output);
    packed.add(`${output}.map`);
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
    canonical.outputs["packages/safejs/dist/chunks/fs.js"].imports.pop();
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
      external: "poe-code/safe-fs",
      reason: "undeclared-canonical-root"
    });
    packed.delete(output);
    packed.delete(`${output}.map`);
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  });
  it.each(["poe-code/safe-fs", "poe-code/safe-fs/core", "poe-code/safe-fs/node"])(
    "accepts the exact route %s with both complete profiles",
    (specifier) => {
      const { manifest, metafile, packed } = canonicalBundleFixture();
      metafile.outputs["dist/index.js"].imports[0].path = specifier;
      expect(findBundleIssues(manifest, new Set(["@poe-code/safe-fs"]), metafile, packed)).toEqual(
        []
      );
    }
  );

  it.each([
    "extra-route",
    "unknown-self",
    "missing-browser",
    "wrong-node-policy",
    "wrong-browser-policy",
    "browser-node-external",
    "browser-private-external",
    "cross-profile-edge",
    "missing-core-root",
    "missing-browser-map",
    "unpacked-browser-chunk",
    "missing-transitive-types",
    "missing-types-metadata",
    "node-types-in-browser",
    "type-protocol",
    "bad-private-types",
    "runtime-private-policy",
    "node-route-browser-fallback",
    "types-condition-order",
    "browser-condition-order",
    "nested-package-scope",
    "nonempty-node-types"
  ])("rejects %s without a broad self-import exemption", (defect) => {
    const { manifest, metafile, packed } = canonicalBundleFixture();
    const browser = metafile.browserCanonicalBundle.metafile;
    const shared = "packages/safejs/dist/browser/chunks/fs.js";
    if (defect === "nested-package-scope") packed.add("packages/safe-fs/package.json");
    if (defect === "nonempty-node-types") metafile.canonicalEmptyTypes = [];
    if (defect === "extra-route")
      Object.assign(manifest.exports, { "./safe-fs/anything": manifest.exports["./safe-fs"] });
    if (defect === "unknown-self")
      metafile.outputs["dist/index.js"].imports[0].path = "poe-code/safe-fs/anything";
    if (defect === "missing-browser")
      delete (metafile as Partial<typeof metafile>).browserCanonicalBundle;
    if (defect === "wrong-node-policy")
      metafile.canonicalBundle.metafile.inputs["packages/safe-fs/src/platform/browser.ts"] = {};
    if (defect === "wrong-browser-policy")
      browser.inputs["packages/safe-fs/src/platform/node.ts"] = {};
    if (defect === "browser-node-external")
      browser.outputs[shared].imports = [{ path: "node:crypto", external: true }];
    if (defect === "browser-private-external")
      browser.outputs[shared].imports = [{ path: "#safe-fs-platform", external: true }];
    if (defect === "cross-profile-edge")
      browser.outputs[shared].imports = [{ path: "packages/safejs/dist/chunks/fs.js" }];
    if (defect === "missing-core-root")
      delete metafile.canonicalBundle.metafile.outputs["packages/safejs/dist/safe-fs-core.js"];
    if (defect === "missing-browser-map") delete browser.outputs[`${shared}.map`];
    if (defect === "unpacked-browser-chunk") packed.delete(shared);
    if (defect === "missing-transitive-types")
      packed.delete("packages/safe-fs/dist/contracts/errors.d.ts");
    if (defect === "missing-types-metadata")
      delete metafile.canonicalTypes["packages/safe-fs/dist/contracts/errors.d.ts"];
    if (defect === "node-types-in-browser")
      metafile.canonicalTypes["packages/safe-fs/dist/core.d.ts"].push("node:fs");
    if (defect === "type-protocol")
      metafile.canonicalTypes["packages/safe-fs/dist/core.d.ts"].push("file:///tmp/types.d.ts");
    if (defect === "bad-private-types")
      manifest.imports["#safe-fs-platform"].types.browser =
        "./packages/safe-fs/dist/platform/node.d.ts";
    if (defect === "runtime-private-policy")
      Object.assign(manifest.imports["#safe-fs-platform"], { import: "./policy.js" });
    if (defect === "node-route-browser-fallback")
      Object.assign(manifest.exports["./safe-fs/node"], {
        browser: "./packages/safejs/dist/safe-fs-node.js"
      });
    if (defect === "types-condition-order")
      Object.assign(manifest.exports, {
        "./safe-fs": {
          ...manifest.exports["./safe-fs"],
          types: {
            default: "./packages/safe-fs/dist/index.d.ts",
            browser: "./packages/safe-fs/dist/core.d.ts"
          }
        }
      });
    if (defect === "browser-condition-order") {
      const exported = manifest.exports["./safe-fs"];
      Object.assign(manifest.exports, {
        "./safe-fs": { types: exported.types, import: exported.import, browser: exported.browser }
      });
    }
    expect(
      findBundleIssues(manifest, new Set(["@poe-code/safe-fs"]), metafile, packed).length
    ).toBeGreaterThan(0);
  });
});
