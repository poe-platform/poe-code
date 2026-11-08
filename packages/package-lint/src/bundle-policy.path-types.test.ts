import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

it("follows the authenticated platform path declaration profiles", () => {
  const { manifest, metafile, packed } = canonicalBundleFixture();
  const pathImport = { types: {
    workerd: "./dist/types/safe-fs/platform/browser-path.d.ts",
    browser: "./dist/types/safe-fs/platform/browser-path.d.ts",
    default: "./dist/types/safe-fs/platform/node-path.d.ts"
  }, default: null };
  Object.assign(manifest.imports, { "#safe-fs-platform-path": pathImport });
  metafile.canonicalTypes["dist/types/safe-fs/core.d.ts"].push("./contracts/path.js");
  const declarations = {
    "dist/types/safe-fs/contracts/path.d.ts": ["#safe-fs-platform-path"],
    "dist/types/safe-fs/platform/node-path.d.ts": ["node:path"],
    "dist/types/safe-fs/platform/browser-path.d.ts": ["../contracts/portable-path.js"],
    "dist/types/safe-fs/contracts/portable-path.d.ts": []
  };
  Object.assign(metafile.canonicalTypes, declarations);
  for (const filename of Object.keys(declarations)) packed.add(filename);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);

  for (const filename of Object.keys(declarations)) {
    packed.delete(filename);
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
      external: "poe-code/safe-fs", reason: "unpacked-canonical-types"
    });
    packed.add(filename);
  }
  declarations["dist/types/safe-fs/platform/browser-path.d.ts"].push("node:path");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "external-canonical-types"
  });
  declarations["dist/types/safe-fs/platform/browser-path.d.ts"].pop();
  pathImport.types.browser = pathImport.types.default;
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "invalid-canonical-type-import"
  });
});
