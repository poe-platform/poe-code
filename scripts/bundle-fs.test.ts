import { expect, it, vi } from "vitest";
import { resolveConsumerGraph } from "./bundle-graph.mjs";
import { canonicalFs } from "../packages/package-lint/src/bundle-policy.js";
vi.mock(
  "../packages/package-lint/dist/bundle-policy.js",
  () => import("../packages/package-lint/src/bundle-policy.js")
);

it("externalizes exactly the three canonical routes without flattening core or node", () => {
  const result = resolveConsumerGraph(
    {
      alias: {
        "@poe-code/safe-fs": "/repo/packages/safe-fs/src/index.ts",
        "@poe-code/safe-fs/core": "/repo/packages/safe-fs/src/core.ts",
        "@poe-code/safe-fs/node": "/repo/packages/safe-fs/src/node/index.ts",
        other: "/repo/packages/other/src/index.ts"
      },
      external: ["node:*", "jose"]
    },
    canonicalFs
  );
  expect(result.alias).toEqual({
    "@poe-code/safe-fs": "poe-code/safe-fs",
    "@poe-code/safe-fs/core": "poe-code/safe-fs/core",
    "@poe-code/safe-fs/node": "poe-code/safe-fs/node",
    other: "/repo/packages/other/src/index.ts"
  });
  expect(result.external).toEqual([
    "node:*",
    "jose",
    "poe-code/safe-fs",
    "poe-code/safe-fs/core",
    "poe-code/safe-fs/node"
  ]);
});

it("keeps Node SafeJS and all Node FS roots in one publisher-managed split build", async () => {
  const { resolveCanonicalFsBuilds } = await import("./bundle-fs.mjs");
  const builds = resolveCanonicalFsBuilds(
    "/repo",
    { alias: {}, external: ["node:*"] },
    { index: "/repo/packages/safejs/src/index.ts" }
  );
  expect(builds.node).toMatchObject({
    write: false,
    splitting: true,
    conditions: ["node"],
    target: "node18.18",
    entryPoints: {
      index: "/repo/packages/safejs/src/index.ts",
      "safe-fs": "/repo/packages/safe-fs/src/index.ts",
      "safe-fs-core": "/repo/packages/safe-fs/src/core.ts",
      "safe-fs-node": "/repo/packages/safe-fs/src/node-host.ts"
    }
  });
  expect(builds.browser).toMatchObject({
    write: false,
    splitting: true,
    conditions: ["browser"],
    platform: "browser",
    external: [],
    outdir: "/repo/packages/safejs/dist/browser"
  });
  expect(builds.browser.entryPoints).toEqual({
    "safe-fs": "/repo/packages/safe-fs/src/core.ts",
    "safe-fs-core": "/repo/packages/safe-fs/src/core.ts"
  });
});
