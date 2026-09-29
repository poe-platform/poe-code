import { expect, it } from "vitest";
import { collectCanonicalDeclarations, findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture, memLintFs } from "./fixtures.js";

it.each(["node", "browser"] as const)("keeps the XML AST implementation and types in the %s canonical runtime", profile => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  const graph = profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
  const chunk = `packages/safe-js/dist/${profile === "browser" ? "browser/" : ""}chunks/fs.js`;
  graph.metafile.inputs["packages/xml-ast/src/index.ts"] = {};
  graph.metafile.outputs[chunk]!.inputs["packages/xml-ast/src/index.ts"] = {};
  metafile.canonicalTypes["packages/safe-fs/dist/core.d.ts"]!.push("../../xml-ast/dist/index.js");
  metafile.canonicalTypes["packages/xml-ast/dist/index.d.ts"] = [];
  packed.add("packages/xml-ast/dist/index.d.ts");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);

  graph.metafile.outputs[chunk]!.inputs["packages/xml-ast/src/unapproved.ts"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "foreign-canonical-input"});
});

it("refuses an independently bundled XML error class in a consumer", () => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  metafile.inputs["packages/xml-ast/src/index.ts"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "duplicate-canonical-runtime"});
});

it("refuses a second packed XML runtime outside the canonical bundle", () => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  packed.add("packages/xml-ast/dist/index.js");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "duplicate-packed-runtime"});
});

it.each(["node", "browser"] as const)("refuses duplicated XML code within the %s canonical graph", profile => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  const graph = profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
  const directory = `packages/safe-js/dist/${profile === "browser" ? "browser/" : ""}`;
  graph.metafile.inputs["packages/xml-ast/src/index.ts"] = {};
  for (const filename of [`${directory}safe-fs.js`, `${directory}chunks/fs.js`]) graph.metafile.outputs[filename]!.inputs["packages/xml-ast/src/index.ts"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "duplicate-canonical-singleton"});
});

it("collects emitted XML declarations for canonical closure inspection", async () => {
  const fs = memLintFs({
    "/repo/packages/safe-fs/dist/xml.d.ts": 'export * from "../../xml-ast/dist/index.js";',
    "/repo/packages/xml-ast/dist/index.d.ts": "export declare class XmlLimitError extends SyntaxError { readonly limit: string; }",
    "/repo/packages/xml-ast/dist/unapproved.d.ts": "export {};",
  });
  const result = await collectCanonicalDeclarations("/repo", fs);
  expect(result.canonicalTypes).toEqual({
    "packages/safe-fs/dist/xml.d.ts": ["../../xml-ast/dist/index.js"],
    "packages/xml-ast/dist/index.d.ts": [],
  });
});
