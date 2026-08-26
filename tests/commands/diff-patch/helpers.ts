import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { toByteSource, type ByteSink, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../../../src/commands/diff-patch/index.js";
import { oraclePath } from "../diff-patch-stress/gnu-target/oracle.js";

export type Files = Readonly<Record<string, string | Uint8Array>>;

export async function filesystem(files: Files = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, text] of Object.entries(files)) {
    assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
    await fs.mkdir(`/work/${dirname(path)}`, { recursive: true });
    await fs.writeFile(`/work/${path}`, typeof text === "string" ? Buffer.from(text) : text);
  }
  return fs;
}

interface RunOptions {
  readonly fs?: FileSystem;
  readonly files?: Files;
  readonly input?: string | Uint8Array | ByteSource;
  readonly options?: DiffPatchOptions;
  readonly signal?: AbortSignal;
  readonly stdout?: ByteSink;
}

export async function run(tool: "diff" | "patch", args: readonly string[], options: RunOptions = {}) {
  const fs = options.fs ?? await filesystem(options.files);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const command = createDiffPatchCommands(options.options).find(item => item.name === tool)!;
  const input = options.input ?? "";
  const result = await command.execute({
    command: tool, args, fs, cwd: "/work", env: {},
    signal: options.signal ?? new AbortController().signal,
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: options.stdout ?? { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), fs };
}

export async function contents(fs: FileSystem, path: string): Promise<string> {
  return Buffer.from(await fs.readFile(`/work/${path}`)).toString("utf8");
}

export const replacement = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

export async function native(
  tool: "diff" | "patch",
  args: readonly string[] | ((root: string) => readonly string[]),
  files: Files,
  input = "",
  options: { readonly parent?: string } = {},
) {
  const boundary = await realpath(await mkdtemp(join(options.parent ?? tmpdir(), "virtual-diff-patch-author-")));
  const root = join(boundary, "work");
  const sentinel = join(boundary, "boundary");
  try {
    await writeFile(sentinel, "fixture boundary\n", { flag: "wx" });
    await mkdir(root);
    for (const [path, text] of Object.entries(files)) {
      assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(oraclePath(tool), [...(typeof args === "function" ? args(root) : args)], {
        cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", HOME: root, TMPDIR: root },
        stdio: ["pipe", "pipe", "pipe"], shell: false,
      });
      let size = 0;
      let failure: Error | undefined;
      const stop = (error: Error) => { failure = error; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop(new Error("native command timeout")), 3000);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) stop(new Error("native command output limit"));
        else chunks.push(chunk);
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve({ exitCode: code ?? 2, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
      child.stdin.end(input);
    });
    const final: Record<string, string> = {};
    const directories: string[] = [];
    const visit = async (relative: string) => {
      for (const name of await readdir(join(root, relative))) {
        const path = relative ? `${relative}/${name}` : name;
        const stat = await lstat(join(root, path));
        if (stat.isDirectory()) { directories.push(path); await visit(path); }
        else if (stat.isFile()) final[path] = await readFile(join(root, path), "utf8");
        else throw new Error("unexpected native oracle symlink");
      }
    };
    assert.equal(await readFile(sentinel, "utf8"), "fixture boundary\n");
    const rootEntry = (await readdir(boundary, { withFileTypes: true })).find(entry => entry.name === "work");
    const rootExists = rootEntry !== undefined;
    if (rootEntry) {
      assert(rootEntry.isDirectory(), "native oracle cwd must remain a directory or be absent");
      await visit("");
    }
    return { ...result, files: final, directories: directories.sort(), rootExists };
  } finally { await rm(boundary, { recursive: true, force: true }); }
}
