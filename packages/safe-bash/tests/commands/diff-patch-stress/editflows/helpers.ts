import assert from "node:assert/strict";
import { dirname } from "node:path";
import { toByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";

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
