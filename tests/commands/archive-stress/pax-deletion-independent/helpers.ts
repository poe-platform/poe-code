import assert from "node:assert/strict";
import { createTarCommand } from "../../../../src/commands/archive/index.js";
import type { ArchiveCommandsOptions } from "../../../../src/commands/archive/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ByteSource, FileSystem, FsOptions } from "../../../../src/contracts/index.js";
export { archive, checksum, fileData, member, record } from "../pax-independent/fixtures.js";

export const normalAtime = 1_555_000_000_123;
export const normalMtime = 1_555_000_000_456;
export const globalTime = 1_700_200_000_125;
export const localTime = 1_700_300_000_500;

export async function backend() {
  const fs: FileSystem = createMemoryFileSystem();
  await fs.mkdir("/out");
  await fs.mkdir("/outside");
  await fs.writeFile("/outside/sentinel", Buffer.from("outside unchanged"));
  const observe = fs.stat.bind(fs);
  const write = fs.writeStream!.bind(fs);
  const setTimes = fs.utimes!.bind(fs);
  const state: {
    publications: number;
    times: { path: string; atime: number; mtime: number }[];
    postWriteStats: string[];
    statError?: Error;
    abortOnStat?: { controller: AbortController; reason: Error };
  } = { publications: 0, times: [], postWriteStats: [] };
  const written = new Set<string>();
  fs.writeStream = async (path, bytes, options) => {
    state.publications++;
    await write(path, bytes, options);
    await setTimes(path, normalAtime, normalMtime, options);
    written.add(path);
  };
  fs.stat = async (path, options?: FsOptions) => {
    if (written.has(path)) {
      state.postWriteStats.push(path);
      if (state.statError) throw state.statError;
      if (state.abortOnStat) {
        state.abortOnStat.controller.abort(state.abortOnStat.reason);
        throw state.abortOnStat.reason;
      }
    }
    return observe(path, options);
  };
  fs.utimes = async (path, atime, mtime, options) => {
    state.times.push({ path, atime, mtime });
    await setTimes(path, atime, mtime, options);
  };
  return { fs, state, observe };
}

export function source(bytes: Uint8Array): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += 257) yield bytes.subarray(offset, offset + 257);
  } };
}

export async function run(fs: FileSystem, input: Uint8Array | ByteSource, args: readonly string[] = ["-xf", "-", "-C", "/out"], options: ArchiveCommandsOptions = {}, signal = AbortSignal.timeout(4000)) {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let total = 0;
  const sink = (chunks: Buffer[]) => ({ async write(bytes: Uint8Array) {
    total += bytes.length;
    assert.ok(total <= 65536, "independent output limit");
    chunks.push(Buffer.from(bytes));
  } });
  const result = await createTarCommand(options).execute({ command: "tar", args, fs, cwd: "/", env: {}, signal,
    stdin: input instanceof Uint8Array ? source(input) : input, stdout: sink(stdout), stderr: sink(stderr) });
  return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

export function success(result: { exitCode: number; stderr: string }): void {
  assert.equal(result.exitCode, 0, result.stderr);
}

export async function unchangedOutside(fs: FileSystem): Promise<void> {
  assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["sentinel"]);
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "outside unchanged");
}
