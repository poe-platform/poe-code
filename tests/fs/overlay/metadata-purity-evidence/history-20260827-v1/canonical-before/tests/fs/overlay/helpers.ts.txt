import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { ErrnoCode, FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";

export const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
export const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
export const errno = (code: ErrnoCode) => (error: unknown): boolean => error instanceof FsError && error.code === code;

export function wrapped(backend: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function immutable(backend: FileSystem): { lower: FileSystem; mutations: string[] } {
  const mutations: string[] = [];
  const forbidden = new Set(["writeFile", "appendFile", "mkdir", "rm", "rmdir", "rename", "copyFile", "symlink", "link", "chmod", "utimes", "truncate", "writeStream"]);
  const lower = new Proxy(backend, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, readOnly: true };
      if (typeof property === "string" && forbidden.has(property)) {
        return async () => { mutations.push(property); throw new Error(`lower mutation: ${property}`); };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { lower, mutations };
}

export async function snapshot(backend: FileSystem, path = "/"): Promise<unknown> {
  const { atimeMs: _readSideEffect, ...stat } = await backend.lstat(path);
  if (stat.type === "file") return { stat, bytes: [...await backend.readFile(path)] };
  if (stat.type === "symlink") return { stat, target: await backend.readlink!(path) };
  const children: Record<string, unknown> = {};
  for (const entry of await backend.readdir(path)) children[entry.name] = await snapshot(backend, path === "/" ? `/${entry.name}` : `${path}/${entry.name}`);
  return { stat, children };
}

export async function fixture(context: TestContext, setup?: (lower: MemoryFileSystem, upper: MemoryFileSystem) => Promise<void>, maxBufferBytes?: number) {
  const backing = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await setup?.(backing, upper);
  const before = await snapshot(backing);
  const { lower, mutations } = immutable(backing);
  const overlay = createOverlayFileSystem({ upper, lower, ...(maxBufferBytes === undefined ? {} : { maxBufferBytes }) });
  context.after(async () => {
    assert.deepEqual(mutations, []);
    assert.deepEqual(await snapshot(backing), before);
  });
  return { overlay, upper, lower, backing };
}

export function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
}
