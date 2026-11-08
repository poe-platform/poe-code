import { expect, it } from "vitest";
import { findBundleIssues } from "./bundle-policy.js";

it.each(["packages/safe-bash-contracts/dist", "dist/types/safe-bash-contracts"].flatMap(types =>
  ["packages/safe-bash-contracts/dist", "dist/shared/safe-bash-contracts"].map(runtime => ({ types, runtime }))
))("admits declared shared contracts only with packed runtime and types ($runtime, $types)", ({ runtime, types }) => {
  const manifest = { name: "poe-code", exports: {
    "./safe-bash/contracts": { types: `./${types}/index.d.ts`, import: `./${runtime}/index.js` },
    "./safe-bash/contracts/*": { types: `./${types}/*.d.ts`, import: `./${runtime}/*.js` }
  } };
  const metafile = { outputs: {
    "dist/csvkit.js": { imports: [{ path: "poe-code/safe-bash/contracts", external: true }, { path: "poe-code/safe-bash/contracts/value", external: true }] },
    [`${runtime}/index.js`]: {},
    [`${runtime}/value.js`]: {}
  } };
  const packed = new Set([`${runtime}/index.js`, `${types}/index.d.ts`, `${runtime}/value.js`, `${types}/value.d.ts`]);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([]);
  packed.delete(`${types}/value.d.ts`);
  expect(findBundleIssues(manifest, new Set(), metafile, packed)).toEqual([{ external: "poe-code/safe-bash/contracts/value", reason: "workspace-not-inlined" }]);
});
