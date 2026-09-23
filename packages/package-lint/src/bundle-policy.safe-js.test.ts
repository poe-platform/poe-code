import { describe, expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";
import { canonicalBundleFixture } from "./fixtures.js";

function interpreterBundle(specifiers: string[]) {
  const fixture = canonicalBundleFixture();
  const canonical = fixture.metafile.canonicalBundle;
  const chunk = "packages/safe-js/dist/chunks/interpreter.js";
  for (const name of ["index", "core", "cli"]) {
    const source = `packages/safe-js/src/${name}.ts`;
    const output = `packages/safe-js/dist/${name}.js`;
    canonical.entryPoints.push(source);
    canonical.metafile.inputs[source] = {};
    canonical.metafile.outputs[output] = {
      entryPoint: source,
      imports: [{ path: chunk }],
      inputs: {}
    };
    fixture.packed.add(output);
  }
  canonical.metafile.outputs[chunk] = {
    imports: specifiers.map(path => ({ path, external: true })),
    inputs: {}
  };
  fixture.packed.add(chunk);
  return fixture;
}

describe("SafeJS publication dependencies", () => {
  it.each([
    "@formatjs/bigdecimal",
    "@formatjs/intl-durationformat",
    "@formatjs/intl-localematcher",
    "@formatjs/intl-numberformat/locale-data/en",
    "@formatjs/intl-pluralrules",
    "@petamoriken/float16",
    "temporal-polyfill/full"
  ])("requires a runtime dependency for interpreter chunk import %s", specifier => {
    const { manifest, metafile, packed } = interpreterBundle([specifier]);
    expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([
      { external: specifier, reason: "undeclared-dependency" }
    ]);
  });

  it("does not let development dependencies satisfy published interpreter imports", () => {
    const { manifest, metafile, packed } = interpreterBundle(["@petamoriken/float16"]);
    const developmentOnly = { ...manifest, devDependencies: { "@petamoriken/float16": "^3.9.3" } };
    expect(findBundleIssues(developmentOnly, new Set(), metafile, packed)).toEqual([
      { external: "@petamoriken/float16", reason: "undeclared-dependency" }
    ]);
  });

  it("accepts declared package subpaths and Node builtins", () => {
    const { manifest, metafile, packed } = interpreterBundle(["temporal-polyfill/full", "node:fs"]);
    const published = { ...manifest, dependencies: { ...manifest.dependencies, "temporal-polyfill": "1.0.4" } };
    expect(findBundleIssues(published, new Set(), metafile, packed)).toEqual([]);
  });

  it("rejects private workspace imports from the interpreter bundle", () => {
    const { manifest, metafile, packed } = interpreterBundle(["@poe-code/agent-spawn"]);
    expect(findBundleIssues(manifest, new Set(["@poe-code/agent-spawn"]), metafile, packed)).toEqual([
      { external: "@poe-code/agent-spawn", reason: "workspace-not-inlined" }
    ]);
  });
});
