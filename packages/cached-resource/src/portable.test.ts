import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";

it("persists, reads, and clears Unicode cached data without Node globals", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ entryPoints: [source("./index.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#cached-resource-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    crypto: globalThis.crypto, TextEncoder, TextDecoder, Error, structuredClone, setTimeout, clearTimeout, AbortController
  });
  const fs = new MemoryFileSystem();
  const config = { cacheDir: "/cache", cacheName: "portable", staleTtl: 60000, freshTtl: 30000, fetchTimeout: 1000, apiEndpoint: "https://test.local" };
  await runtime.persist({ title: "café 😀" }, config, { fs });
  expect(await runtime.loadFromDisk(config, { fs })).toMatchObject({ data: { title: "café 😀" } });
  const resource = runtime.createCachedResource({}, config, { fs });
  expect(await resource.get({ offline: true })).toMatchObject({ data: { title: "café 😀" } });
  await resource.clear();
  expect(await runtime.loadFromDisk(config, { fs })).toBeNull();
  expect(runtime.resolveCacheDir("app", { env: {}, homedir: () => "/home/user" })).toBe("/home/user/.cache/app");
});
