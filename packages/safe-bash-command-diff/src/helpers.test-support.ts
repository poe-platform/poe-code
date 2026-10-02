import assert from "node:assert/strict";
import { dirname } from "node:path";
import { toByteSource, type ByteSink, type ByteSource, type FileSystem } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { createDiffCommand, type DiffPatchOptions } from "./index.js";

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

export async function run(tool: "diff", args: readonly string[], options: RunOptions = {}) {
  const fs = options.fs ?? await filesystem(options.files);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const command = createDiffCommand(options.options);
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
