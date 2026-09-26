import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";

it("admits shared command contracts only when their declared runtime and types are packed", () => {
  const manifest = { name: "poe-code", exports: {
    "./safe-bash/contracts": { types: "./packages/safe-bash-contracts/dist/index.d.ts", import: "./packages/safe-bash-contracts/dist/index.js" },
    "./safe-bash/contracts/*": { types: "./packages/safe-bash-contracts/dist/*.d.ts", import: "./packages/safe-bash-contracts/dist/*.js" }
  } };
  const metafile = { outputs: {
    "dist/csvkit.js": { imports: [{ path: "poe-code/safe-bash/contracts", external: true }, { path: "poe-code/safe-bash/contracts/value", external: true }] },
    "packages/safe-bash-contracts/dist/index.js": {},
    "packages/safe-bash-contracts/dist/value.js": {}
  } };
  const packed = new Set(["packages/safe-bash-contracts/dist/index.js", "packages/safe-bash-contracts/dist/index.d.ts", "packages/safe-bash-contracts/dist/value.js", "packages/safe-bash-contracts/dist/value.d.ts"]);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  packed.delete("packages/safe-bash-contracts/dist/value.d.ts");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([{ external: "poe-code/safe-bash/contracts/value", reason: "workspace-not-inlined" }]);
});
