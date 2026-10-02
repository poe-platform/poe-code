import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";

it.each(["yaml-file", "markdown-dir"])("manages %s tasks without Node globals", async type => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ entryPoints: [source("./index.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#task-list-host": source("./default-host.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    crypto: globalThis.crypto, TextEncoder, TextDecoder, Error, structuredClone, setTimeout, clearTimeout
  });
  const fs = new MemoryFileSystem();
  const tasks = await runtime.openTaskList({ type, path: type === "yaml-file" ? "/tasks.yaml" : "/tasks", create: true, fs });
  const list = tasks.list("work");
  const created = await list.create({ id: "portable", name: "café 😀", description: "Unicode body" });
  expect(created.name).toBe("café 😀");
  expect(await tasks.allTasks()).toHaveLength(1);
  await list.delete("portable");
  expect(await tasks.allTasks()).toHaveLength(0);
  expect(await runtime.resolveAuth({ explicitToken: "test-token" })).toBe("test-token");
});
