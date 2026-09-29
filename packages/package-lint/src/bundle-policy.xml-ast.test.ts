import { expect, it } from "vitest";
import { collectCanonicalDeclarations, findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture, memLintFs } from "./fixtures.js";

it.each(["node", "browser"] as const)("keeps the XML AST implementation and types in the %s canonical runtime", profile => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  const graph = profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
  const chunk = `dist/shared/safe-js/${profile === "browser" ? "browser/" : ""}chunks/fs.js`;
  graph.metafile.inputs["packages/xml-ast/src/index.ts"] = {};
  graph.metafile.outputs[chunk]!.inputs["packages/xml-ast/src/index.ts"] = {};
  metafile.canonicalTypes["dist/types/safe-fs/core.d.ts"]!.push("../xml-ast/index.js");
  metafile.canonicalTypes["dist/types/xml-ast/index.d.ts"] = [];
  packed.add("dist/types/xml-ast/index.d.ts");
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
  packed.add("dist/types/xml-ast/index.js");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "duplicate-packed-runtime"});
});

it.each(["node", "browser"] as const)("refuses duplicated XML code within the %s canonical graph", profile => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  const graph = profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
  const directory = `dist/shared/safe-js/${profile === "browser" ? "browser/" : ""}`;
  graph.metafile.inputs["packages/xml-ast/src/index.ts"] = {};
  for (const filename of [`${directory}safe-fs.js`, `${directory}chunks/fs.js`]) graph.metafile.outputs[filename]!.inputs["packages/xml-ast/src/index.ts"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "duplicate-canonical-singleton"});
});

it("collects emitted XML declarations for canonical closure inspection", async () => {
  const fs = memLintFs({
    "/repo/dist/types/safe-fs/xml.d.ts": 'export * from "../xml-ast/index.js";',
    "/repo/dist/types/xml-ast/index.d.ts": "export declare class XmlLimitError extends SyntaxError { readonly limit: string; }",
    "/repo/dist/types/xml-ast/unapproved.d.ts": "export {};",
  });
  const result = await collectCanonicalDeclarations("/repo", fs);
  expect(result.canonicalTypes).toEqual({
    "dist/types/safe-fs/xml.d.ts": ["../xml-ast/index.js"],
    "dist/types/xml-ast/index.d.ts": [],
  });
});
