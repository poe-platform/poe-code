import assert from "node:assert/strict";
import { dirname, join, resolve, sep } from "node:path";
import { toByteSource, type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createByteCommands } from "../../../src/commands/bytes/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

export interface Fixture {
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly directories?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
}

function safe(root: string, name: string): string {
  assert(name && !name.startsWith("/") && !name.includes("\0"));
  const path = resolve(root, name);
  assert(path.startsWith(root + sep), `unsafe native fixture path '${name}'`);
  return path;
}

export async function memory(fixture: Fixture = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const directory of fixture.directories ?? []) await fs.mkdir(safe("/work", directory), { recursive: true });
  for (const [name, data] of Object.entries(fixture.files ?? {})) {
    const path = safe("/work", name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, Buffer.from(data));
  }
  for (const [name, target] of Object.entries(fixture.links ?? {})) {
    const path = safe("/work", name); safe("/work", join(dirname(name), target));
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.symlink(target, path);
  }
  return fs;
}

export async function run(name: string, args: readonly string[] = [], stdin: string | Uint8Array | ByteSource = "", fixture: Fixture = {}, overrides: Partial<CommandContext> = {}) {
  const fs = await memory(fixture);
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  const definition = createByteCommands().find(command => command.name === name);
  assert(definition, `missing byte command ${name}`);
  const result = await definition.execute({
    command: name, args, cwd: "/work", env: { LC_ALL: "C", LANG: "C" }, fs,
    stdin: typeof stdin === "string" || stdin instanceof Uint8Array ? toByteSource(stdin) : stdin,
    signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), fs: overrides.fs ?? fs };
}

export async function* chunks(bytes: Uint8Array, size: number): ByteSource {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}

export function wrap(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function bytes(length: number): Buffer {
  let state = 0x12345678;
  return Buffer.from(Uint8Array.from({ length }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; }));
}
