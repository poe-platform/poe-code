import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

it.each([false, true])("qualifies the runtime closure without packed debug maps (emitted=%s)", emitted => {
  const { manifest, metafile, packed, chunk } = canonicalBundleFixture();
  for (const bundle of [metafile.canonicalBundle, metafile.browserCanonicalBundle]) {
    for (const filename of Object.keys(bundle.metafile.outputs)) {
      if (!filename.endsWith(".js.map")) continue;
      packed.delete(filename);
      if (!emitted) delete bundle.metafile.outputs[filename];
    }
  }
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  packed.delete(chunk);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({
    external: "poe-code/safe-fs", reason: "unpacked-canonical-output"
  });
});
