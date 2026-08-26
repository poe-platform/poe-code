import assert from "node:assert/strict";
import { dirname } from "node:path/posix";
import { Shell } from "../../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { diffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import type { ByteSource, FileSystem } from "../../../../src/contracts/index.js";
import type { Fixture, Step } from "./fixtures.js";
import type { Namespace } from "./native.js";

export const root = "/fixture";
export const cwd = `${root}/work`;
export async function filesystem(files: Fixture["files"] = {}, directories: readonly string[] = []): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(`${root}/boundary`, Buffer.from("fixture boundary\n"));
  for (const directory of directories) await fs.mkdir(`${cwd}/${directory}`, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await fs.mkdir(dirname(`${cwd}/${path}`), { recursive: true });
    await fs.writeFile(`${cwd}/${path}`, Buffer.from(contents));
  }
  return fs;
}

export async function snapshot(fs: FileSystem): Promise<Namespace> {
  const namespace: Namespace = { ".": { kind: "directory" } };
  assert.equal((await fs.lstat(root)).type, "directory", "fixture boundary directory disappeared");
  const visit = async (relative: string): Promise<void> => {
    for (const entry of (await fs.readdir(`${root}/${relative}`)).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await fs.lstat(`${root}/${path}`);
      if (stat.type === "directory") { namespace[path] = { kind: "directory" }; await visit(path); }
      else if (stat.type === "symlink") namespace[path] = { kind: "symlink", target: await fs.readlink!(`${root}/${path}`) };
      else namespace[path] = { kind: "file", hex: Buffer.from(await fs.readFile(`${root}/${path}`)).toString("hex") };
    }
  };
  await visit("");
  return namespace;
}

export function shell(fs: FileSystem, options: DiffPatchOptions = {}): Shell {
  return new Shell({ fs, cwd, limits: { maxOutputBytes: 65_536 } }).use(diffPatchCommands(options));
}

export async function execute(instance: Shell, step: Step, signal?: AbortSignal, stdin?: ByteSource) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return instance.exec(["patch", ...step.args.map(arg => arg.replaceAll("@ROOT@", root))].map(quote).join(" "), {
    stdin: stdin ?? step.input.replaceAll("@ROOT@", root), ...(signal ? { signal } : {}),
  });
}

export async function contents(fs: FileSystem, path: string): Promise<string> {
  return Buffer.from(await fs.readFile(`${cwd}/${path}`)).toString("utf8");
}

export function requireAtomic(stderr: string): void {
  assert.doesNotMatch(stderr, /unsupported option.*atomic|unknown option.*atomic/u, "required --atomic option is missing; this is a failure, not a skip");
}

export function instrument(fs: MemoryFileSystem, intercept: (method: string, args: readonly unknown[]) => unknown | undefined): FileSystem {
  return new Proxy(fs, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const replacement = intercept(String(property), args);
        return replacement === undefined ? Reflect.apply(member, target, args) : replacement;
      };
    },
  });
}
