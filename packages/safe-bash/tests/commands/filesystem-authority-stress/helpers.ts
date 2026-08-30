import assert from "node:assert/strict";
import { FsError, toByteSource, type EntryComparison, type FileStat, type FileSystem } from "../../../src/contracts/index.js";
import { filesystemCommands } from "../../../src/commands/filesystem.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

export function view(base: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return Reflect.get(overrides, key);
    const member = Reflect.get(target, key, target) as unknown;
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

export function unscoped(stat: FileStat): FileStat {
  const { identityScope: omitted, ...rest } = stat;
  void omitted;
  return rest;
}

export async function command(name: "cp" | "mv", args: readonly string[], fs: FileSystem, signal = new AbortController().signal) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await filesystemCommands().find(definition => definition.name === name)!.execute({
    command: name, args, fs, cwd: "/", env: {}, signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export const payload = Buffer.from([0, 255, 195, 169, 10, 13, 0, 42]);
export const previous = Buffer.from("previous destination\n");

export async function bytes(fs: FileSystem, path: string): Promise<Buffer | null> {
  try { return Buffer.from(await fs.readFile(path)); }
  catch (error) { if (error instanceof FsError && error.code === "ENOENT") return null; throw error; }
}

export async function unchanged(fs: FileSystem): Promise<void> {
  assert.deepEqual(await bytes(fs, "/source"), payload);
  assert.deepEqual(await bytes(fs, "/target"), previous);
}

export async function provider(options: { scoped?: boolean; alias?: boolean; target?: boolean; comparison?: "actual" | "absent" | "unknown" } = {}) {
  const base = createMemoryFileSystem();
  await base.writeFile("/source", payload);
  if (options.alias) await base.link("/source", "/target");
  else if (options.target !== false) await base.writeFile("/target", previous);
  const events: string[] = [];
  const authority: NonNullable<FileSystem["compareEntry"]> = async (path, peer, peerPath, controls) => {
    events.push(`compare:${path}:${peerPath}`);
    controls?.signal?.throwIfAborted();
    assert.equal(typeof peer.stat, "function");
    if (options.comparison === "unknown") return "unknown";
    const left = await base.stat(path, controls), right = await base.stat(peerPath, controls);
    return left.identityScope === right.identityScope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
  };
  const fs: FileSystem = view(base, {
    stat: async (path, controls) => { const stat = await base.stat(path, controls); return options.scoped ? stat : unscoped(stat); },
    lstat: async (path, controls) => { const stat = await base.lstat(path, controls); return options.scoped ? stat : unscoped(stat); },
    ...(options.comparison === "absent" ? {} : { compareEntry: authority }),
    rename: async () => { events.push("rename:EXDEV"); throw new FsError("EXDEV"); },
    copyFile: async (source, target, controls) => {
      events.push(`copy:${controls?.exclusive === true ? "exclusive" : "replace"}`);
      await base.copyFile(source, target, controls);
      events.push("published");
    },
    rm: async (path, controls) => { events.push(`remove:${path}`); await base.rm(path, controls); },
  });
  return { base, fs, events };
}

export function invalidComparison(value: unknown): NonNullable<FileSystem["compareEntry"]> {
  return async () => value as EntryComparison;
}

export function effects(events: readonly string[]): string[] {
  return events.filter(event => !event.startsWith("compare:") && event !== "rename:EXDEV");
}
