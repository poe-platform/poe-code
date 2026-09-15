import { expect, it, vi } from "vitest";
import { resolveConsumerGraph } from "./bundle-graph.mjs";
import { canonicalFs } from "../packages/package-lint/src/bundle-policy.js";
vi.mock(
  "../packages/package-lint/dist/bundle-policy.js",
  () => import("../packages/package-lint/src/bundle-policy.js")
);

it("builds the explicit workerd runtime separately from Node filesystem publishers", async () => {
  const { resolveWorkerdRuntimeBuild } = await import("./bundle-fs.mjs");
  const options = resolveWorkerdRuntimeBuild("/repo", { alias: { fs: "public-fs" }, external: ["public-fs"] });
  expect(options).toMatchObject({
    entryPoints: { workerd: "/repo/packages/safe-js/src/workerd.ts" },
    alias: { fs: "public-fs" }, external: ["public-fs"],
    conditions: ["workerd"], platform: "node", splitting: false,
    write: false, outdir: "/repo/packages/safe-js/dist",
  });
});

it("externalizes canonical routes without flattening core, node or bridge", () => {
  const result = resolveConsumerGraph(
    {
      alias: {
        "@poe-code/safe-fs": "/repo/packages/safe-fs/src/index.ts",
        "@poe-code/safe-fs/core": "/repo/packages/safe-fs/src/core.ts",
        "@poe-code/safe-fs/node": "/repo/packages/safe-fs/src/node/index.ts",
        "@poe-code/safe-fs/node/filesystem": "/repo/packages/safe-fs/src/node/index.ts",
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
    "@poe-code/safe-fs/node/filesystem": "poe-code/safe-fs/node/filesystem",
    other: "/repo/packages/other/src/index.ts"
  });
  expect(result.external).toEqual([
    "node:*",
    "jose",
    "poe-code/safe-fs",
    "poe-code/safe-fs/core",
    "poe-code/safe-fs/node",
    "poe-code/safe-fs/node/filesystem"
  ]);
});

it("keeps Node SafeJS and all Node FS roots in one publisher-managed split build", async () => {
  const { resolveCanonicalFsBuilds } = await import("./bundle-fs.mjs");
  const builds = resolveCanonicalFsBuilds(
    "/repo",
    { alias: {}, external: ["node:*"] },
    { index: "/repo/packages/safe-js/src/index.ts" }
  );
  expect(builds.node).toMatchObject({
    write: false,
    splitting: true,
    conditions: ["node"],
    target: "node18.18",
    entryPoints: {
      index: "/repo/packages/safe-js/src/index.ts",
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
    outdir: "/repo/packages/safe-js/dist/browser"
  });
  expect(builds.browser.entryPoints).toEqual({
    "safe-fs": "/repo/packages/safe-fs/src/core.ts",
    "safe-fs-core": "/repo/packages/safe-fs/src/core.ts"
  });
});

it("externalizes the registered native loader only in the Node canonical profile", async () => {
  const { resolveCanonicalFsBuilds } = await import("./bundle-fs.mjs");
  const builds = resolveCanonicalFsBuilds("/repo", { alias: {}, external: ["node:*"] }, {}, {
    specifier: "#safe-fs-native-seek",
  });
  expect(builds.node.external).toEqual(["node:*", "#safe-fs-native-seek"]);
  expect(builds.browser.external).toEqual([]);
});

it("publishes separately built runtimes without pruning live canonical filesystem chunks", async () => {
  const { createFsFromVolume, Volume } = await import("memfs");
  const { publishBundleOutputs } = await import("./publish-bundle.mjs");
  const { resolveCanonicalFsBuilds, resolveWorkerdRuntimeBuild, mergeRuntimeBundleOutputs } = await import("./bundle-fs.mjs");
  const graph = { alias: {}, external: [] };
  const node = resolveCanonicalFsBuilds("/repo", graph, { index: "/repo/packages/safe-js/src/index.ts" }).node;
  const workerd = resolveWorkerdRuntimeBuild("/repo", graph);
  const chunk = "packages/safe-js/dist/chunks/canonical-NEW.js";
  const makeResult = (outputs: Record<string, { entryPoint?: string; imports?: { path: string }[] }>) => ({
    metafile: { inputs: {}, outputs: Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, { imports: [], ...output }])) },
    outputFiles: Object.keys(outputs).map(filename => ({ path: "/repo/" + filename, contents: new TextEncoder().encode(filename) })),
  });
  const nodeResult = makeResult({
    ...Object.fromEntries(Object.entries(node.entryPoints).map(([name, source]) => [
      `packages/safe-js/dist/${name}.js`, { entryPoint: source.slice("/repo/".length), imports: [{ path: chunk }] },
    ])),
    [chunk]: {},
  });
  const workerdResult = makeResult({ "packages/safe-js/dist/workerd.js": { entryPoint: "packages/safe-js/src/workerd.ts" } });
  const volume = Volume.fromJSON({ "/repo/packages/safe-js/dist/chunks/stale.js": "old" });
  await publishBundleOutputs(mergeRuntimeBundleOutputs(nodeResult, workerdResult), {
    outdir: node.outdir,
    entryPoints: [...Object.values(node.entryPoints), ...Object.values(workerd.entryPoints)],
    workingDirectory: "/repo",
  }, createFsFromVolume(volume).promises);
  expect(volume.existsSync("/repo/" + chunk)).toBe(true);
  expect(volume.existsSync("/repo/packages/safe-js/dist/workerd.js")).toBe(true);
  expect(volume.existsSync("/repo/packages/safe-js/dist/safe-fs.js")).toBe(true);
  expect(volume.existsSync("/repo/packages/safe-js/dist/chunks/stale.js")).toBe(false);
});
