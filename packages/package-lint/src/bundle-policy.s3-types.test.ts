import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

it("follows S3 request declarations without exposing Node types to browsers", () => {
  const { manifest, metafile, packed } = canonicalBundleFixture();
  const requestImport = {
    types: {
      workerd: "./dist/types/safe-fs/fs/s3/http/request-fetch.d.ts",
      browser: "./dist/types/safe-fs/fs/s3/http/request-fetch.d.ts",
      default: "./dist/types/safe-fs/fs/s3/http/request-node.d.ts"
    },
    default: null
  };
  Object.assign(manifest.imports, { "#safe-fs-s3-request": requestImport });
  for (const entry of ["core", "index"])
    metafile.canonicalTypes[`dist/types/safe-fs/${entry}.d.ts`].push("./fs/s3/http/types.js");
  const declarations = {
    "dist/types/safe-fs/fs/s3/http/types.d.ts": ["#safe-fs-s3-request"],
    "dist/types/safe-fs/fs/s3/http/request-node.d.ts": ["node:http", "./request.js"],
    "dist/types/safe-fs/fs/s3/http/request-fetch.d.ts": ["./request.js"],
    "dist/types/safe-fs/fs/s3/http/request.d.ts": ["#safe-fs-s3-request"]
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
  declarations["dist/types/safe-fs/fs/s3/http/request-fetch.d.ts"].push("node:http");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "external-canonical-types"
  });
  declarations["dist/types/safe-fs/fs/s3/http/request-fetch.d.ts"].pop();
  requestImport.types.browser = requestImport.types.default;
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "invalid-canonical-type-import"
  });
});
