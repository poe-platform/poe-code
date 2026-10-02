import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { expect, it } from "vitest";

it("resolves Docker paths with an injected filesystem and rejects symlink escapes without Node", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const bundle = await build({ entryPoints: [source("./runtime.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#config-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Error });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/.poe-code", { recursive: true });
  await fs.writeFile("/repo/.poe-code/Dockerfile", new TextEncoder().encode("FROM scratch"));
  const result = await runtime.resolveRuntime({ cwd: "/repo", config: { runtime: runtime.parseRuntime({ type: "docker" }) }, fs });
  expect(result).toMatchObject({ dockerfilePath: "/repo/.poe-code/Dockerfile", buildContext: "/repo" });
  await fs.mkdir("/outside");
  await fs.writeFile("/outside/Dockerfile", new TextEncoder().encode("FROM scratch"));
  await fs.symlink!("/outside", "/repo/escape");
  await expect(runtime.resolveRuntime({ cwd: "/repo", config: { runtime: runtime.parseRuntime({ type: "docker", dockerfile: "escape/Dockerfile" }) }, fs })).rejects.toThrow("must remain inside runtime cwd");
});
