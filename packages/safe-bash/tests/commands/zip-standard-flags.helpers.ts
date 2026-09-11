import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../src/contracts/index.js";
import { settings, type ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";
import { makeZipEntry, writeZipArchive, type ZipEntry } from "../../src/commands/archive/zip-format.js";
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { createUnzipCommand } from "../../src/commands/archive/unzip.js";

export const binary = Buffer.from([0, 255, 128, 13, 10, 65]);
export const compressed = Buffer.from("binary\0payload\r\n".repeat(128));
export const modified = new Date("2024-01-02T03:04:06Z");
export const members = [
  { name: "folder/", body: Buffer.alloc(0) },
  { name: "binary", body: binary },
  { name: "folder/data", body: compressed },
  { name: "empty", body: Buffer.alloc(0) },
  { name: "link", body: Buffer.from("../binary"), symlink: true },
];

export async function archiveBytes(input = members, change?: (entries: ZipEntry[]) => void) {
  const signal = new AbortController().signal;
  const limits = settings({});
  const entries = await Promise.all(input.map(member => makeZipEntry(member.name, member.body, {
    modified, mode: member.symlink ? 0o120777 : member.name.endsWith("/") ? 0o40755 : 0o100644,
    directory: member.name.endsWith("/"), symlink: member.symlink ?? false,
  }, limits, signal)));
  change?.(entries);
  return writeZipArchive({ entries, comment: Buffer.from("archive comment\n") }, limits, signal);
}

export async function fixture(bytes?: Uint8Array) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/folder", { recursive: true });
  await fs.writeFile("/work/binary", binary);
  await fs.writeFile("/work/folder/data", compressed);
  await fs.writeFile("/work/sample.zip", bytes ?? await archiveBytes());
  return fs;
}

export async function execute(command: "zip" | "unzip", fs: FileSystem, args: readonly string[], options: ArchiveCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command, args, fs, cwd: "/work", env: {}, signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout.push(Uint8Array.from(chunk)); } },
    stderr: { async write(chunk) { stderr.push(Uint8Array.from(chunk)); } }, ...overrides,
  };
  const definition = command === "zip" ? createZipCommand(options) : createUnzipCommand(options);
  const result = await definition.execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

export function readOnlyArchive(fs: FileSystem) {
  const calls: { method: string; path: unknown }[] = [];
  const readable = new Set(["lstat", "stat", "realpath", "readFile", "readStream", "capabilitiesFor"]);
  const view = new Proxy(fs, { get(target, property) {
    if (property === "capabilities") return { streamingRead: true, permissions: false, symlinks: false };
    if (property === "capabilitiesFor") return (path: string) => {
      calls.push({ method: "capabilitiesFor", path });
      return { streamingRead: true, permissions: false, symlinks: false };
    };
    const value: unknown = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      calls.push({ method: String(property), path: args[0] });
      if (!readable.has(String(property))) throw new Error(`forbidden filesystem operation: ${String(property)}`);
      return Reflect.apply(value, target, args);
    };
  } });
  return { fs: view, calls };
}
