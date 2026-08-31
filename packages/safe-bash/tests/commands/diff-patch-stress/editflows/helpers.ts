import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { oraclePath } from "../gnu-target/oracle.js";
import { admitNativeGit, nativeGitProfile } from "./git-profile.js";

export type Files = Readonly<Record<string, string>>;
export const cwd = "/work";

export async function memory(files: Files): Promise<MemoryFileSystem> {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir(cwd);
  for (const [path, content] of Object.entries(files)) {
    await filesystem.mkdir(`${cwd}/${dirname(path)}`, { recursive: true });
    await filesystem.writeFile(`${cwd}/${path}`, Buffer.from(content));
  }
  return filesystem;
}

export async function run(tool: "diff" | "patch", args: readonly string[], filesystem: FileSystem, input = "") {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let captured = 0;
  const sink = (chunks: Uint8Array[]) => ({ async write(chunk: Uint8Array) {
    captured += chunk.byteLength;
    assert(captured <= 1024 * 1024, "virtual output exceeded test capture limit");
    chunks.push(chunk.slice());
  } });
  const command = createDiffPatchCommands().find(definition => definition.name === tool)!;
  const result = await command.execute({ command: tool, args, fs: filesystem, cwd, env: {},
    signal: new AbortController().signal, stdin: toByteSource(input), stdout: sink(stdout), stderr: sink(stderr) });
  return { status: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

export async function fileBytes(filesystem: FileSystem, paths: readonly string[]) {
  const result: Record<string, Buffer> = {};
  for (const path of paths) result[path] = Buffer.from(await filesystem.readFile(`${cwd}/${path}`));
  return result;
}

export function expectedBytes(files: Files) {
  return Object.fromEntries(Object.entries(files).map(([path, content]) => [path, Buffer.from(content)]));
}

export function native(root: string, tool: "diff" | "patch" | "git", args: readonly string[], input = "") {
  const git = tool === "git" ? admitNativeGit(nativeGitProfile()) : undefined;
  const result = spawnSync(tool === "git" ? git!.path : oraclePath(tool), [...args], {
    cwd: root, input, timeout: 3000, maxBuffer: 1024 * 1024, shell: false,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", HOME: root, TMPDIR: root,
      XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      ...(git ? { GIT_EXEC_PATH: git.gitCore } : {}), GIT_OPTIONAL_LOCKS: "0",
      GIT_CEILING_DIRECTORIES: dirname(root), GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, "native process terminated by signal");
  assert.notEqual(result.status, null);
  return { status: result.status!, stdout: result.stdout, stderr: result.stderr };
}

export async function isolated<T>(files: Files, operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), ".oracle-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      assert(path && !path.startsWith("/") && !path.split("/").some(part => part === ".." || part === ".git"));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function nativeBytes(root: string, paths: readonly string[]) {
  const result: Record<string, Buffer> = {};
  for (const path of paths) result[path] = await readFile(join(root, path));
  return result;
}
