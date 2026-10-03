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
  for (const module of ["stream", "errors"]) {
    graph.metafile.inputs[`packages/xml-ast/src/${module}.ts`] = {};
    graph.metafile.outputs[chunk]!.inputs[`packages/xml-ast/src/${module}.ts`] = {};
    metafile.canonicalTypes["dist/types/xml-ast/index.d.ts"]!.push(`./${module}.js`);
    metafile.canonicalTypes[`dist/types/xml-ast/${module}.d.ts`] = [];
    packed.add(`dist/types/xml-ast/${module}.d.ts`);
  }
  for (const dependency of ["saxes/saxes.js", "xmlchars/xml/1.0/ed5.js"]) {
    graph.metafile.outputs[chunk]!.inputs[`node_modules/${dependency}`] = {};
  }
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);

  graph.metafile.outputs[chunk]!.inputs["packages/xml-ast/src/unapproved.ts"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({external: "poe-code/safe-fs", reason: "foreign-canonical-input"});
});

it.each(["index", "stream", "errors"])("refuses independently bundled XML %s code in a consumer", module => {
  const {manifest, metafile, packed} = canonicalBundleFixture();
  metafile.inputs[`packages/xml-ast/src/${module}.ts`] = {};
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
    "/repo/dist/types/xml-ast/stream.d.ts": 'import type { XmlElement } from "./index.js";',
    "/repo/dist/types/xml-ast/errors.d.ts": "export declare class XmlLimitError extends SyntaxError {}",
    "/repo/dist/types/xml-ast/unapproved.d.ts": "export {};",
  });
  const result = await collectCanonicalDeclarations("/repo", fs);
  expect(result.canonicalTypes).toEqual({
    "dist/types/safe-fs/xml.d.ts": ["../xml-ast/index.js"],
    "dist/types/xml-ast/index.d.ts": [],
    "dist/types/xml-ast/stream.d.ts": ["./index.js"],
    "dist/types/xml-ast/errors.d.ts": [],
  });
});

it.each(["node", "browser"] as const)("retains streaming XML and bundled parser code in the %s canonical closure", profile => {
  const { manifest, metafile, packed } = canonicalBundleFixture();
  const graph = profile === "node" ? metafile.canonicalBundle : metafile.browserCanonicalBundle;
  const chunk = `dist/shared/safe-js/${profile === "browser" ? "browser/" : ""}chunks/fs.js`;
  for (const input of ["packages/xml-ast/src/stream.ts", "node_modules/saxes/saxes.js", "node_modules/xmlchars/xml/1.0/ed5.js"]) {
    graph.metafile.inputs[input] = {};
    graph.metafile.outputs[chunk]!.inputs[input] = {};
  }
  metafile.canonicalTypes["dist/types/safe-fs/core.d.ts"]!.push("../xml-ast/index.js");
  metafile.canonicalTypes["dist/types/xml-ast/index.d.ts"] = ["./stream.js"];
  metafile.canonicalTypes["dist/types/xml-ast/stream.d.ts"] = ["./index.js"];
  packed.add("dist/types/xml-ast/index.d.ts"); packed.add("dist/types/xml-ast/stream.d.ts");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  graph.metafile.outputs[chunk]!.inputs["node_modules/saxes-unapproved/index.js"] = {};
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toContainEqual({ external: "poe-code/safe-fs", reason: "foreign-canonical-input" });
});

it("collects the streaming declaration cycle without admitting unrelated XML modules", async () => {
  const result = await collectCanonicalDeclarations("/repo", memLintFs({
    "/repo/dist/types/xml-ast/index.d.ts": 'export * from "./stream.js";',
    "/repo/dist/types/xml-ast/stream.d.ts": 'import type { XmlElement } from "./index.js"; export declare function parse(): XmlElement;',
    "/repo/dist/types/xml-ast/unapproved.d.ts": "export {};"
  }));
  expect(result.canonicalTypes).toEqual({
    "dist/types/xml-ast/index.d.ts": ["./stream.js"],
    "dist/types/xml-ast/stream.d.ts": ["./index.js"]
  });
});
