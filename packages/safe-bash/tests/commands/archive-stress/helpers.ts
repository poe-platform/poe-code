import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { ByteSource, CommandContext, FileSystem } from "../../../src/contracts/index.js";
import type { ArchiveCommandsOptions } from "../../../src/commands/archive/index.js";

const archiveUrl = process.env.ARCHIVE_ACCEPTANCE_SOURCE
  ? pathToFileURL(process.env.ARCHIVE_ACCEPTANCE_SOURCE).href
  : new URL("../../../src/commands/archive/index.ts", import.meta.url).href;
export const { createTarCommand, archiveCommands } = await import(archiveUrl) as typeof import("../../../src/commands/archive/index.js");

export function source(bytes: Uint8Array, chunkSize = 197): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
  } };
}

export async function fixture(): Promise<FileSystem> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/input");
  await fs.mkdir("/output");
  await fs.mkdir("/outside");
  await fs.writeFile("/outside/sentinel", Buffer.from("must remain unchanged"));
  return fs;
}

export async function tar(fs: FileSystem, args: readonly string[], overrides: Partial<CommandContext> = {}, options: ArchiveCommandsOptions = {}) {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let collected = 0;
  const collect = (destination: Buffer[]) => ({ async write(chunk: Uint8Array) {
    collected += chunk.length;
    assert.ok(collected <= 4 * 1024 * 1024, "acceptance output bound exceeded");
    destination.push(Buffer.from(chunk));
  } });
  const result = await createTarCommand(options).execute({
    command: "tar", args, fs, cwd: "/input", env: {},
    signal: AbortSignal.timeout(5000), stdin: source(Buffer.alloc(0)),
    stdout: collect(stdout), stderr: collect(stderr), ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") };
}

export function success(result: { exitCode: number; stderr: string }): void {
  assert.equal(result.exitCode, 0, result.stderr);
}

export async function absent(fs: FileSystem, path: string): Promise<void> {
  await assert.rejects(fs.lstat(path), { code: "ENOENT" });
}

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export async function deadline<Value>(promise: Promise<Value>, milliseconds = 3000): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("acceptance deadline exceeded")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
