import { expect, it } from "vitest";
import { collectPackageFiles, findBundleIssues } from "./bundle-policy.js";
import { memLintFs } from "./fixtures.js";

it("excludes disposable maps and literal paths from the publication inventory", async () => {
  const fs = memLintFs({
    "/repo/dist/index.js": "export {};",
    "/repo/dist/index.d.ts": "export {};",
    "/repo/dist/index.js.map": "{}",
    "/repo/dist/deep/index.mjs.map": "{}",
    "/repo/dist/deep/index.cjs.map": "{}",
    "/repo/dist/deep/index.d.ts.map": "{}",
    "/repo/dist/deep/index.d.mts.map": "{}",
    "/repo/dist/deep/index.d.cts.map": "{}",
    "/repo/dist/world.map": "runtime data",
    "/repo/dist/LICENSE": "license",
    "/repo/dist/corpus/input.txt": "fixture",
    "/repo/dist/corpus-tools/index.js": "export {};",
    "/repo/dist/retired.js": "export {};"
  });
  const files = await collectPackageFiles("/repo", ["dist", "!dist/corpus", "!dist/retired.js",
    ...["js", "mjs", "cjs", "d.ts", "d.mts", "d.cts"].map(suffix => `!**/*.${suffix}.map`)], fs);
  expect(files).toEqual(new Set(["dist/index.js", "dist/index.d.ts", "dist/world.map",
    "dist/LICENSE", "dist/corpus-tools/index.js"]));
  expect(findBundleIssues({ imports: { "#engine": "./dist/retired.js" } }, new Set(), {
    outputs: { "dist/index.js": { imports: [{ path: "#engine", external: true }] } }
  }, files)).toEqual([{ external: "#engine", reason: "invalid-external" }]);
});

it.each(["!../outside", "!/outside", "!dist/*.js", "!**/", "!"])("rejects unsupported exclusion %s", async entry => {
  await expect(collectPackageFiles("/repo", [entry], memLintFs({}))).rejects.toThrow("Unsupported package files entry");
});

it("ships the public declaration mirror without duplicate private declarations", async () => {
  const fs = memLintFs({
    "/repo/dist/types/owner/index.d.ts": "export {};",
    "/repo/packages/owner/dist/index.d.ts": "export {};",
    "/repo/packages/owner/dist/vendor.d.mts": "export {};",
    "/repo/packages/owner/dist/vendor.d.cts": "export {};",
    "/repo/packages/owner/dist/index.js": "export {};",
  });
  const files = await collectPackageFiles("/repo", ["dist", "packages/owner/dist",
    "!packages/*/dist/**/*.d.ts", "!packages/*/dist/**/*.d.mts", "!packages/*/dist/**/*.d.cts"], fs);
  expect([...files].sort()).toEqual(["dist/types/owner/index.d.ts", "packages/owner/dist/index.js"]);
});
