import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
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

export async function findExecutable(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) for (const path of candidate.includes("/") ? [candidate] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map(directory => join(directory, candidate))) {
    try { await access(path, 1); return path; } catch {}
  }
  return undefined;
}

export const nativePrograms = {
  gzip: await findExecutable(["/usr/bin/gzip", "gzip"]),
  base64: await findExecutable(["/usr/bin/base64", "base64"]),
  python: await findExecutable(["python3"]),
  shasum: await findExecutable(["/usr/bin/shasum", "shasum"]),
  sha256sum: await findExecutable(["gsha256sum", "/sbin/sha256sum", "sha256sum"]),
  sha1sum: await findExecutable(["gsha1sum", "/sbin/sha1sum", "sha1sum"]),
  md5sum: await findExecutable(["gmd5sum", "/sbin/md5sum", "md5sum"]),
  cksum: await findExecutable(["/usr/bin/cksum", "cksum"]),
  xxd: await findExecutable(["xxd"]),
  od: await findExecutable(["/usr/bin/od", "od"]),
};

export async function native(program: string | undefined, args: readonly string[], stdin: string | Uint8Array = "", fixture: Fixture = {}) {
  assert(program, "required native oracle unavailable");
  const root = await realpath(await mkdtemp(join(tmpdir(), "safe-byte-independent-")));
  try {
    for (const directory of fixture.directories ?? []) await mkdir(safe(root, directory), { recursive: true });
    for (const [name, data] of Object.entries(fixture.files ?? {})) {
      const path = safe(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, data);
    }
    for (const [name, target] of Object.entries(fixture.links ?? {})) {
      const path = safe(root, name); safe(root, join(dirname(name), target));
      await mkdir(dirname(path), { recursive: true }); await symlink(target, path);
    }
    const result = await new Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
      const child = spawn(program, [...args], { cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root }, stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = []; const stderr: Buffer[] = [];
      let failure: Error | undefined; let size = 0;
      const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop(new Error("native byte oracle deadline exceeded")), 5000);
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (bytes: Buffer) => {
        size += bytes.length;
        if (size > 8 * 1024 * 1024) stop(new Error("native byte oracle output limit exceeded")); else chunks.push(bytes);
      });
      child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
      child.on("error", error => { failure = error; });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (failure) reject(failure); else if (signal || exitCode === null) reject(new Error("native byte oracle terminated abnormally"));
        else resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      });
      child.stdin.end(stdin);
    });
    const files: Record<string, Buffer> = {}; const links: Record<string, string> = {};
    const visit = async (directory: string) => {
      for (const name of await readdir(join(root, directory))) {
        const relative = directory ? `${directory}/${name}` : name;
        const path = join(root, relative); const stat = await lstat(path);
        if (stat.isSymbolicLink()) links[relative] = await readlink(path);
        else if (stat.isDirectory()) await visit(relative);
        else { assert(stat.isFile() && stat.size <= 8 * 1024 * 1024); files[relative] = await readFile(path); }
      }
    };
    await visit("");
    return { ...result, files, links };
  } finally { await rm(root, { recursive: true, force: true }); }
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
