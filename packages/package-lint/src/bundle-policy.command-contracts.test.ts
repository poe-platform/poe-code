import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";

it.each(["packages/safe-bash-contracts/dist", "dist/shared/safe-bash-contracts"])("admits declared shared contracts only with packed runtime and types (%s)", runtime => {
  const manifest = { name: "poe-code", exports: {
    "./safe-bash/contracts": { types: "./packages/safe-bash-contracts/dist/index.d.ts", import: `./${runtime}/index.js` },
    "./safe-bash/contracts/*": { types: "./packages/safe-bash-contracts/dist/*.d.ts", import: `./${runtime}/*.js` }
  } };
  const metafile = { outputs: {
    "dist/csvkit.js": { imports: [{ path: "poe-code/safe-bash/contracts", external: true }, { path: "poe-code/safe-bash/contracts/value", external: true }] },
    [`${runtime}/index.js`]: {},
    [`${runtime}/value.js`]: {}
  } };
  const packed = new Set([`${runtime}/index.js`, "packages/safe-bash-contracts/dist/index.d.ts", `${runtime}/value.js`, "packages/safe-bash-contracts/dist/value.d.ts"]);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  packed.delete("packages/safe-bash-contracts/dist/value.d.ts");
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([{ external: "poe-code/safe-bash/contracts/value", reason: "workspace-not-inlined" }]);
});
