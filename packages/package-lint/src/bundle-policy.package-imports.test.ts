import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";

const metafile = { outputs: { "dist/browser.js": {
  imports: [{ path: "#engine", external: true }]
} } };
const packed = new Set(["dist/browser.js", "dist/engine.js", "dist/engine.workerd.js"]);

it("does not replace canonical native-asset authentication with package-import admission", () => {
  const specifier = "#safe-fs-native-seek";
  const manifest = { name: "poe-code", imports: { [specifier]: "./dist/engine.js" } };
  const nativeImport = { outputs: { "dist/index.js": { imports: [{ path: specifier, external: true }] } } };
  expect(findBundleIssues(manifest, new Set(), nativeImport, packed))
    .toEqual([{ external: specifier, reason: "invalid-external" }]);
});

it("admits a conditional package runtime only when every target is packed", () => {
  const manifest = { name: "example", imports: { "#engine": {
    types: "./dist/engine.d.ts", workerd: "./dist/engine.workerd.js", default: "./dist/engine.js"
  } } };
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  expect(findBundleIssues(manifest, new Set(), metafile, new Set(["dist/browser.js", "dist/engine.js"])))
    .toEqual([{ external: "#engine", reason: "invalid-external" }]);
});

it.each([
  undefined, null, {}, { types: "./dist/engine.js" },
  { workerd: "./dist/missing.js", default: "./dist/engine.js" },
  { default: "../dist/engine.js" }, { default: "./dist/../dist/engine.js" },
  { default: "./dist/*.js" }, { default: "./dist/engine.d.ts" },
  { default: "./dist/engine.js?mode=browser" }, { default: "dependency" },
  { default: "./dist\\engine.js" }, { default: "./dist//engine.js" }
])("rejects missing, non-runtime and nonliteral package-import targets: %j", target => {
  expect(findBundleIssues({ name: "example", imports: { "#engine": target } }, new Set(), metafile, packed))
    .toEqual([{ external: "#engine", reason: "invalid-external" }]);
});
