import assert from "node:assert/strict";
import { posix } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  toByteSource, type ByteSink, type ByteSource, type FileSystem, type FsOptions,
} from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";

export const cwd = "/sandbox/work";
export const bytes = (text: string): Uint8Array => Buffer.from(text);
export const replacement = (name = "target", next = "new"): string => `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-old\n+${next}\n`;
export const creation = (name: string): string => `--- /dev/null\n+++ ${name}\n@@ -0,0 +1 @@\n+created\n`;
export const deletion = (name: string): string => `--- ${name}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;

export async function memory(files: Readonly<Record<string, string | Uint8Array>> = { target: "old\n" }): Promise<MemoryFileSystem> {
  const backing = new MemoryFileSystem();
  await backing.mkdir(cwd, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    assert(name && !name.startsWith("/") && !name.split("/").includes(".."));
    const path = `${cwd}/${name}`;
    await backing.mkdir(posix.dirname(path), { recursive: true });
    await backing.writeFile(path, typeof data === "string" ? bytes(data) : data);
  }
  return backing;
}

export async function snapshot(backing: MemoryFileSystem): Promise<unknown[]> {
  const entries: unknown[] = [];
  const visit = async (path: string): Promise<void> => {
    const stat = await backing.lstat(path);
    const identity = { path, type: stat.type, mode: stat.mode, ino: stat.ino, dev: stat.dev, nlink: stat.nlink };
    if (stat.type === "directory") {
      entries.push(identity);
      for (const entry of (await backing.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(`${path === "/" ? "" : path}/${entry.name}`);
      }
    } else if (stat.type === "symlink") entries.push({ ...identity, link: await backing.readlink(path) });
    else entries.push({ ...identity, data: Buffer.from(await backing.readFile(path)).toString("hex") });
  };
  await visit("/");
  return entries;
}

export interface Operation {
  readonly method: keyof FileSystem;
  readonly path: string;
  readonly signal: AbortSignal | undefined;
  readonly destination: string | undefined;
  readonly flag: string | undefined;
}

export interface Hooks {
  readonly before?: (operation: Operation) => void | Promise<void>;
  readonly after?: (operation: Operation) => void | Promise<void>;
  readonly streaming?: boolean;
}

export function instrument(backing: MemoryFileSystem, hooks: Hooks = {}) {
  const calls: Operation[] = [];
  async function perform<Result>(method: keyof FileSystem, path: string, options: FsOptions | undefined, action: () => Promise<Result>, destination?: string, flag?: string): Promise<Result> {
    const operation = { method, path, signal: options?.signal, destination, flag };
    calls.push(operation);
    await hooks.before?.(operation);
    const result = await action();
    await hooks.after?.(operation);
    return result;
  }
  const fs: FileSystem = {
    capabilities: { ...backing.capabilities, streamingRead: hooks.streaming ?? false },
    readFile: (path, options) => perform("readFile", path, options, () => backing.readFile(path, options)),
    writeFile: (path, data, options) => perform("writeFile", path, options, () => backing.writeFile(path, data, options), undefined, options?.flag),
    appendFile: (path, data, options) => perform("appendFile", path, options, () => backing.appendFile(path, data, options)),
    stat: (path, options) => perform("stat", path, options, () => backing.stat(path, options)),
    lstat: (path, options) => perform("lstat", path, options, () => backing.lstat(path, options)),
    readdir: (path, options) => perform("readdir", path, options, () => backing.readdir(path, options)),
    mkdir: (path, options) => perform("mkdir", path, options, () => backing.mkdir(path, options)),
    rm: (path, options) => perform("rm", path, options, () => backing.rm(path, options)),
    rename: (path, destination, options) => perform("rename", path, options, () => backing.rename(path, destination, options), destination),
    copyFile: (path, destination, options) => perform("copyFile", path, options, () => backing.copyFile(path, destination, options), destination),
    realpath: (path, options) => perform("realpath", path, options, () => backing.realpath(path, options)),
    access: (path, mode, options) => perform("access", path, options, () => backing.access(path, mode, options)),
    readlink: (path, options) => perform("readlink", path, options, () => backing.readlink(path, options)),
    ...(hooks.streaming ? {
      async *readStream(path, options) {
        yield await perform("readStream", path, options, () => backing.readFile(path, options));
      },
    } satisfies Pick<FileSystem, "readStream"> : {}),
  };
  const mutations = () => calls.filter(call => ["writeFile", "appendFile", "mkdir", "rm", "rename", "copyFile"].includes(call.method));
  return { fs, calls, mutations };
}

interface Invocation {
  readonly args?: readonly string[];
  readonly input?: string | Uint8Array | ByteSource;
  readonly signal?: AbortSignal;
  readonly options?: DiffPatchOptions;
  readonly stdout?: ByteSink;
  readonly stderr?: ByteSink;
  readonly cwd?: string;
}

export async function invoke(fs: FileSystem, tool: "diff" | "patch", invocation: Invocation = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const command = createDiffPatchCommands(invocation.options).find(item => item.name === tool);
  assert(command);
  const input = invocation.input ?? "";
  const result = await command.execute({
    command: tool, args: invocation.args ?? [], fs, cwd: invocation.cwd ?? cwd, env: {},
    signal: invocation.signal ?? new AbortController().signal,
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: invocation.stdout ?? { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: invocation.stderr ?? { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export async function assertBytes(backing: MemoryFileSystem, name: string, expected: string | Uint8Array): Promise<void> {
  assert.deepEqual(Buffer.from(await backing.readFile(`${cwd}/${name}`)), Buffer.from(typeof expected === "string" ? bytes(expected) : expected));
}

export function deferred<Result>() {
  let resolve!: (result: Result | PromiseLike<Result>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Result>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

export async function drain(): Promise<void> {
  await setImmediate();
  await setImmediate();
}
