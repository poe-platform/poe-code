import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Shell, agentCommands, createMemoryFileSystem, type ByteSource, type CommandContext, type FileSystem } from "../../../src/index.js";
import { createTarCommand, type ArchiveCommandsOptions } from "../../../src/commands/archive/index.js";

export const directory = fileURLToPath(new URL("./", import.meta.url));
export const oracle = join(directory, ".oracle/gnu-tar/1.35/bin/gtar");
export const oracleHash = "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66";
export const binary = Uint8Array.from({ length: 2051 }, (_, index) => index % 256);

export async function fixture(options: Omit<ArchiveCommandsOptions, "replace"> = {}, fs: FileSystem = createMemoryFileSystem()) {
  await fs.mkdir("/work", { recursive: true });
  await fs.mkdir("/out", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 16 * 1024 * 1024, pipeHighWaterMark: 1024 } }).use(agentCommands({ archive: options }));
  return { fs, shell };
}

export function source(bytes: Uint8Array, chunkSize = bytes.length || 1): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
  } };
}

export async function direct(args: readonly string[], fs: FileSystem, overrides: Partial<CommandContext> = {}, options: ArchiveCommandsOptions = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "tar", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: source(new Uint8Array()), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides,
  };
  const result = await createTarCommand(options).execute(context);
  return { ...result, stdoutBytes: Buffer.concat(stdout), stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export async function withNative(callback: (temporary: string, run: (args: readonly string[]) => Buffer) => Promise<void>): Promise<void> {
  assert.equal(createHash("sha256").update(await readFile(oracle)).digest("hex"), oracleHash, "Run prepare-oracle.mjs; never substitute Apple tar");
  const temporary = await mkdtemp(join(directory, ".native-test-"));
  const run = (args: readonly string[]) => execFileSync(oracle, [...args], {
    cwd: temporary, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", COPYFILE_DISABLE: "1" }, timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
  });
  try { await callback(temporary, run); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

export function header(name: string, payload: Uint8Array = new Uint8Array(), type = "0", target = ""): Buffer {
  const bytes = Buffer.alloc(512);
  bytes.write(name, 0, 100);
  for (const [offset, width, value] of [[100, 8, type === "5" ? 0o755 : 0o644], [108, 8, 0], [116, 8, 0], [124, 12, payload.length], [136, 12, 1_700_000_000], [329, 8, 0], [337, 8, 0]]) {
    bytes.write(value!.toString(8).padStart(width! - 1, "0"), offset!, width! - 1);
  }
  bytes[156] = type.charCodeAt(0);
  bytes.write(target, 157, 100);
  bytes.write("ustar\0" + "00", 257, "ascii");
  checksum(bytes);
  return bytes;
}

export function checksum(bytes: Uint8Array): void {
  bytes.fill(32, 148, 156);
  const sum = bytes.subarray(0, 512).reduce((total, byte) => total + byte, 0);
  bytes.set(Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
}

export function member(name: string, payload: Uint8Array = new Uint8Array(), type = "0", target = ""): Buffer {
  return Buffer.concat([header(name, payload, type, target), payload, Buffer.alloc((512 - payload.length % 512) % 512)]);
}

export function archive(...members: Uint8Array[]): Buffer { return Buffer.concat([...members, Buffer.alloc(1024)]); }

export function record(key: string, value: string): Buffer {
  const body = Buffer.from(` ${key}=${value}\n`);
  let size = body.length + 1;
  while (size !== body.length + String(size).length) size = body.length + String(size).length;
  return Buffer.concat([Buffer.from(String(size)), body]);
}

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

export function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
