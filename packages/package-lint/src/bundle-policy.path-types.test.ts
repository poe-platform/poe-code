import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

it("follows the authenticated platform path declaration profiles", () => {
  const { manifest, metafile, packed } = canonicalBundleFixture();
  const pathImport = { types: {
    workerd: "./packages/safe-fs/dist/platform/browser-path.d.ts",
    browser: "./packages/safe-fs/dist/platform/browser-path.d.ts",
    default: "./packages/safe-fs/dist/platform/node-path.d.ts"
  }, default: null };
  Object.assign(manifest.imports, { "#safe-fs-platform-path": pathImport });
  metafile.canonicalTypes["packages/safe-fs/dist/core.d.ts"].push("./contracts/path.js");
  const declarations = {
    "packages/safe-fs/dist/contracts/path.d.ts": ["#safe-fs-platform-path"],
    "packages/safe-fs/dist/platform/node-path.d.ts": ["node:path"],
    "packages/safe-fs/dist/platform/browser-path.d.ts": ["../contracts/portable-path.js"],
    "packages/safe-fs/dist/contracts/portable-path.d.ts": []
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
  declarations["packages/safe-fs/dist/platform/browser-path.d.ts"].push("node:path");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "external-canonical-types"
  });
  declarations["packages/safe-fs/dist/platform/browser-path.d.ts"].pop();
  pathImport.types.browser = pathImport.types.default;
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "invalid-canonical-type-import"
  });
});
