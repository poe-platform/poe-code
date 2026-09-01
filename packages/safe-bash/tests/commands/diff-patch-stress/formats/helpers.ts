import assert from "node:assert/strict";
import { toByteSource, type ByteSink, type ByteSource } from "../../../../src/contracts/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
export type Files = Readonly<Record<string, string>>;

export async function filesystem(files: Files = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, text] of Object.entries(files)) await fs.writeFile(`/work/${name}`, Buffer.from(text));
  return fs;
}

interface RunOptions {
  readonly files?: Files;
  readonly fs?: MemoryFileSystem;
  readonly input?: string | ByteSource;
  readonly options?: DiffPatchOptions;
  readonly signal?: AbortSignal;
  readonly stdout?: ByteSink;
}

export async function run(tool: "diff" | "patch", args: readonly string[], options: RunOptions = {}) {
  const fs = options.fs ?? await filesystem(options.files);
  const command = createDiffPatchCommands(options.options).find(candidate => candidate.name === tool);
  assert(command);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  const sink = (chunks: Buffer[]): ByteSink => ({ async write(chunk) {
    outputBytes += chunk.byteLength;
    assert(outputBytes <= 512 * 1024, "virtual combined output cap");
    chunks.push(Buffer.from(chunk));
  } });
  const input = options.input ?? "";
  const result = await command.execute({
    command: tool, args, cwd: "/work", env: {}, fs,
    signal: options.signal ?? new AbortController().signal,
    stdin: typeof input === "string" ? toByteSource(input) : input,
    stdout: options.stdout ?? sink(stdout), stderr: sink(stderr),
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), fs };
}

export async function contents(fs: MemoryFileSystem) {
  return Buffer.from(await fs.readFile("/work/target", { maxBytes: 256 * 1024 })).toString("utf8");
}

export const patchArgs = ["--batch", "--binary", "--fuzz=0", "--no-backup-if-mismatch", "target"];
export const labels = ["--label", "target", "--label", "target"];
