import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteSource } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands, diffPatchCommands } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { oracleIdentity, oraclePath } from "./oracle.js";

export type Files = Readonly<Record<string, string>>;
export type Snapshot = Record<string, Buffer | null>;
export type Tool = "diff" | "patch";
export interface Result { exitCode: number; stdout: Buffer; stderr: Buffer }
const directory = dirname(fileURLToPath(import.meta.url));

function safeRelative(path: string): void {
  assert(path && !path.startsWith("/") && !path.includes("\\") && !path.split("/").some(part => part === ".." || part === ""));
}

export async function memory(files: Files): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, text] of Object.entries(files)) {
    safeRelative(path);
    await fs.mkdir(`/work/${dirname(path)}`, { recursive: true });
    await fs.writeFile(`/work/${path}`, Buffer.from(text));
  }
  return fs;
}

export async function snapshot(fs: MemoryFileSystem, paths: readonly string[]): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const path of paths) {
    safeRelative(path);
    try { result[path] = Buffer.from(await fs.readFile(`/work/${path}`)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result[path] = null;
    }
  }
  return result;
}

export function expectedFiles(files: Readonly<Record<string, string | null>>): Snapshot {
  return Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text === null ? null : Buffer.from(text)]));
}

export async function virtual(tool: Tool, args: readonly string[], files: Files, input = "") {
  const fs = await memory(files);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const command = createDiffPatchCommands().find(definition => definition.name === tool);
  assert(command);
  const result = await command.execute({
    command: tool, args, fs, cwd: "/work", env: { LANG: "C", LC_ALL: "C" },
    signal: AbortSignal.timeout(5000), stdin: toByteSource(input),
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { fs, exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

export async function shell(files: Files) {
  const fs = await memory(files);
  return { fs, shell: new Shell({ fs, cwd: "/work", env: { LANG: "C", LC_ALL: "C" } }).use(diffPatchCommands()) };
}

export async function native(tool: Tool, args: readonly string[], files: Files = {}, input = "", paths: readonly string[] = Object.keys(files)) {
  const root = await mkdtemp(join(directory, ".oracle-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      safeRelative(path);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const result = await new Promise<Result>((resolve, reject) => {
      const child = execFile(oraclePath(tool), [...args], {
        cwd: root, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "buffer",
        env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LANG: "C", LC_ALL: "C", TZ: "UTC" },
      }, (error, stdout, stderr) => {
        if (error && (typeof error.code !== "number" || error.killed || error.signal)) reject(error);
        else resolve({ exitCode: error?.code as number | undefined ?? 0, stdout, stderr });
      });
      child.stdin?.on("error", error => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") { child.kill("SIGKILL"); reject(error); }
      });
      child.stdin?.end(input);
    });
    const final: Snapshot = {};
    for (const path of paths) {
      safeRelative(path);
      try { final[path] = await readFile(join(root, path)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        final[path] = null;
      }
    }
    return { ...result, files: final };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function availability(tool: Tool): Promise<string> {
  return JSON.stringify(oracleIdentity(tool));
}
