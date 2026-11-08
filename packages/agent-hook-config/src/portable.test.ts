import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

let hooks: typeof import("./index.js");
beforeAll(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "hooks", logLevel: "silent" });
  hooks = new Function(`${bundle.outputFiles[0].text}; return hooks;`)();
});

it("bridges hooks with isolated Worker storage and preserves overlapping runs", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/.claude", { recursive: true });
  await fs.mkdir("/repo/.git/info", { recursive: true });
  await fs.writeFile("/repo/.claude/settings.json", new TextEncoder().encode(JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "echo café" }] }]
  } })));
  const runtime = { fs };
  const first = await hooks.bridgeHooks("claude-code", "codex", "/repo", "/home/test", "same", { strategy: "transform" }, runtime);
  const second = await hooks.bridgeHooks("claude-code", "codex", "/repo", "/home/test", "same", { strategy: "transform" }, runtime);
  expect(first.strategy).toBe("transform");
  await hooks.cleanupBridgedHooks(first, runtime);
  expect(new TextDecoder().decode(await fs.readFile(second.writtenPath))).toContain("café");
  await hooks.cleanupBridgedHooks(JSON.parse(JSON.stringify(second)), runtime);
  await hooks.cleanupBridgedHooks(second, runtime);
  expect(new TextDecoder().decode(await fs.readFile("/repo/.git/info/exclude"))).toBe("");
});

async function provider(command: string) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/.claude", { recursive: true });
  await fs.mkdir("/repo/.git/info", { recursive: true });
  await fs.writeFile("/repo/.claude/settings.json", new TextEncoder().encode(JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: "command", command }] }]
  } })));
  return { fs };
}

it("isolates providers with identical paths and serializes overlapping transformations", async () => {
  const a = await provider("echo A"), b = await provider("echo B");
  const bridge = (runtime: typeof a) => hooks.bridgeHooks("claude-code", "codex", "/repo", "/home/test", "same", { strategy: "transform" }, runtime);
  const [first, second, other] = await Promise.all([bridge(a), bridge(a), bridge(b)]);
  await expect(hooks.cleanupBridgedHooks(first, b)).rejects.toThrow("filesystem conflicts");
  await hooks.cleanupBridgedHooks(first, a);
  expect(new TextDecoder().decode(await a.fs.readFile(second.writtenPath!))).toContain("echo A");
  expect(new TextDecoder().decode(await b.fs.readFile(other.writtenPath!))).toContain("echo B");
  await hooks.cleanupBridgedHooks(second, a);
  await hooks.cleanupBridgedHooks(other, b);
});

it("keeps user hooks while removing only generated handlers", async () => {
  const runtime = await provider("echo generated");
  await runtime.fs.mkdir("/repo/.codex", { recursive: true });
  const path = "/repo/.codex/hooks.json";
  await runtime.fs.writeFile(path, new TextEncoder().encode(JSON.stringify({ custom: true, hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }]
  } })));
  const manifest = await hooks.bridgeHooks("claude-code", "codex", "/repo", "/home/test", "run", { strategy: "transform" }, runtime);
  await hooks.cleanupBridgedHooks(manifest, runtime);
  const contents = new TextDecoder().decode(await runtime.fs.readFile(path));
  expect(contents).toContain("echo mine");
  expect(contents).not.toContain("echo generated");
});

it("refuses hook sources reached through symbolic-link parents", async () => {
  const runtime = await provider("echo outside");
  await runtime.fs.rename("/repo/.claude", "/source");
  await runtime.fs.symlink("/source", "/repo/.claude");
  await expect(hooks.readClaudeHooks("/repo", "/home/test", { scope: "project" }, runtime)).rejects.toThrow("symbolic link");
});

it("retains a shared generated symlink until its final run is cleaned", async () => {
  const runtime = await provider("echo user");
  await runtime.fs.mkdir("/home/test/.claude", { recursive: true });
  await runtime.fs.rename("/repo/.claude/settings.json", "/home/test/.claude/settings.json");
  const first = await hooks.bridgeHooks("claude-code", "claude-code", "/repo", "/home/test", "first", { strategy: "symlink" }, runtime);
  const second = await hooks.bridgeHooks("claude-code", "claude-code", "/repo", "/home/test", "second", { strategy: "symlink" }, runtime);
  await hooks.cleanupBridgedHooks(first, runtime);
  expect(await runtime.fs.readlink(second.symlinkPath!)).toBe("/home/test/.claude/settings.json");
  await hooks.cleanupBridgedHooks(second, runtime);
  await expect(runtime.fs.lstat(second.symlinkPath!)).rejects.toThrow();
});

it("refuses direct hook writes through symbolic-link parents", async () => {
  const runtime = await provider("echo source");
  await runtime.fs.mkdir("/outside", { recursive: true });
  await runtime.fs.symlink("/outside", "/repo/.codex");
  const transformed = hooks.transformHooks([{ event: "SessionStart", handler: { type: "command", command: "echo generated" } }], "claude-code", "codex", { runId: "run" });
  await expect(hooks.writeCodexHooks("/repo/.codex/hooks.json", transformed.entries, "run", undefined, runtime)).rejects.toThrow("symbolic link");
  expect(await runtime.fs.readdir("/outside")).toEqual([]);
});
