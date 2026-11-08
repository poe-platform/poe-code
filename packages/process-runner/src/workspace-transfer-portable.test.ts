import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("transfers Unicode files and preserves local conflicts without Node", async () => {
  const source = (name: string) => fileURLToPath(new URL(name, import.meta.url));
  const bundle = await build({ entryPoints: [source("./workspace-transfer.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#transfer-filesystem": source("./transfer-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array });
  const fs = new MemoryFileSystem();
  const remoteFs = new MemoryFileSystem();
  const encode = (text: string) => new TextEncoder().encode(text);
  await fs.mkdir("/repo", { recursive: true });
  await fs.writeFile("/repo/café.txt", encode("hello 😀"));
  const env = { fs, remoteFs, cwd: "/repo", uploadDir: "/upload" };
  expect(await runtime.uploadWorkspace(env, {})).toMatchObject({ files: 1, bytes: 10 });
  const tar = await remoteFs.readFile("/upload/workspace.tar");
  expect(new TextDecoder().decode(tar.slice(0, 10))).toBe("café.txt\0");
  expect(new TextDecoder().decode(tar.slice(512, 522))).toBe("hello 😀");
  await remoteFs.writeFile("/workspace/café.txt", encode("remote"));
  await fs.writeFile("/repo/café.txt", encode("local"));
  expect(await runtime.downloadWorkspace(env, { conflictPolicy: "refuse" })).toMatchObject({ files: 0, conflicts: [{ path: "café.txt", reason: "local_modified" }] });
  expect(await runtime.downloadWorkspace(env, { conflictPolicy: "overwrite" })).toMatchObject({ files: 1, conflicts: [] });
  expect(new TextDecoder().decode(await fs.readFile("/repo/café.txt"))).toBe("remote");
});
