import { posix } from "node:path";
import type {
  AppendFileOptions, CopyFileOptions, DirectoryEntry, FileStat, FileSystem,
  FsOptions, MkdirOptions, RemoveOptions, WriteFileOptions,
} from "../../../src/contracts/filesystem.js";

type Entry = { type: "file" | "directory" | "symlink"; bytes: Uint8Array; mode: number; target?: string };

function failure(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

export class StubFileSystem implements FileSystem {
  readonly capabilities = { symlinks: true };
  readonly calls: { operation: string; paths: string[]; signal?: AbortSignal }[] = [];
  readonly entries = new Map<string, Entry>([["/", { type: "directory", bytes: new Uint8Array(), mode: 0o755 }]]);

  constructor(files: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(files)) {
      let parent = posix.dirname(path);
      while (!this.entries.has(parent)) {
        this.entries.set(parent, { type: "directory", bytes: new Uint8Array(), mode: 0o755 });
        parent = posix.dirname(parent);
      }
      this.entries.set(path, { type: "file", bytes: Buffer.from(content), mode: 0o644 });
    }
  }

  #call(operation: string, paths: string[], options?: FsOptions): void {
    options?.signal?.throwIfAborted();
    this.calls.push({ operation, paths, ...(options?.signal === undefined ? {} : { signal: options.signal }) });
  }

  #resolve(path: string, follow = true, depth = 0): string {
    if (depth > 32) throw failure("ELOOP", path);
    const normalized = posix.resolve("/", path);
    const components = normalized.split("/").filter(Boolean);
    let current = "/";
    for (const [index, component] of components.entries()) {
      current = posix.join(current, component);
      const entry = this.entries.get(current);
      if (entry?.type === "symlink" && (follow || index < components.length - 1)) {
        if (entry.target === undefined) throw failure("ENOENT", current);
        return this.#resolve(posix.resolve(posix.dirname(current), entry.target, ...components.slice(index + 1)), follow, depth + 1);
      }
    }
    return current;
  }

  #entry(path: string, follow = true): Entry {
    const entry = this.entries.get(this.#resolve(path, follow));
    if (entry === undefined) throw failure("ENOENT", path);
    return entry;
  }

  async readFile(path: string, options?: FsOptions): Promise<Uint8Array> {
    this.#call("readFile", [path], options);
    const entry = this.#entry(path);
    if (entry.type !== "file") throw failure("EISDIR", path);
    return entry.bytes.slice();
  }

  async writeFile(path: string, data: Uint8Array, options?: WriteFileOptions): Promise<void> {
    this.#call("writeFile", [path], options);
    const target = this.#resolve(path);
    const previous = this.entries.get(target);
    if (previous !== undefined && (options?.flag === "wx" || options?.flag === "ax")) throw failure("EEXIST", path);
    if (previous?.type === "directory") throw failure("EISDIR", path);
    if (this.#entry(posix.dirname(target)).type !== "directory") throw failure("ENOTDIR", path);
    const bytes = options?.flag?.startsWith("a") && previous !== undefined ? Buffer.concat([previous.bytes, data]) : data.slice();
    this.entries.set(target, { type: "file", bytes, mode: previous?.mode ?? options?.mode ?? 0o666 });
  }

  async appendFile(path: string, data: Uint8Array, options?: AppendFileOptions): Promise<void> {
    await this.writeFile(path, data, { ...options, flag: "a" });
  }

  #stat(path: string, follow: boolean): FileStat {
    const entry = this.#entry(path, follow);
    return { type: entry.type, size: entry.bytes.length, mode: entry.mode, mtimeMs: 2000, atimeMs: 1000, ctimeMs: 3000 };
  }

  async stat(path: string, options?: FsOptions): Promise<FileStat> {
    this.#call("stat", [path], options);
    return this.#stat(path, true);
  }

  async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    this.#call("lstat", [path], options);
    return this.#stat(path, false);
  }

  async readdir(path: string, options?: FsOptions): Promise<DirectoryEntry[]> {
    this.#call("readdir", [path], options);
    if (this.#entry(path).type !== "directory") throw failure("ENOTDIR", path);
    const parent = this.#resolve(path);
    return [...this.entries].filter(([candidate]) => candidate !== parent && posix.dirname(candidate) === parent)
      .map(([candidate, entry]) => ({ name: posix.basename(candidate), type: entry.type }));
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.#call("mkdir", [path], options);
    const target = this.#resolve(path);
    const existing = this.entries.get(target);
    if (existing !== undefined) {
      if (options?.recursive && existing.type === "directory") return;
      throw failure("EEXIST", path);
    }
    if (options?.recursive) await this.mkdir(posix.dirname(target), options);
    if (this.#entry(posix.dirname(target)).type !== "directory") throw failure("ENOTDIR", path);
    this.entries.set(target, { type: "directory", bytes: new Uint8Array(), mode: options?.mode ?? 0o777 });
  }

  async rm(path: string, options?: RemoveOptions): Promise<void> {
    this.#call("rm", [path], options);
    const target = this.#resolve(path, false);
    const entry = this.entries.get(target);
    if (entry === undefined) {
      if (options?.force) return;
      throw failure("ENOENT", path);
    }
    if (entry.type === "directory" && !options?.recursive) throw failure("EISDIR", path);
    for (const candidate of this.entries.keys()) {
      if (candidate === target || candidate.startsWith(`${target}/`)) this.entries.delete(candidate);
    }
  }

  async rename(source: string, destination: string, options?: FsOptions): Promise<void> {
    this.#call("rename", [source, destination], options);
    this.#entry(source, false);
    for (const [path, entry] of [...this.entries]) {
      if (path === source || path.startsWith(`${source}/`)) {
        this.entries.set(destination + path.slice(source.length), entry);
        this.entries.delete(path);
      }
    }
  }

  async copyFile(source: string, destination: string, options?: CopyFileOptions): Promise<void> {
    this.#call("copyFile", [source, destination], options);
    await this.writeFile(destination, await this.readFile(source, options), { ...options, flag: options?.exclusive ? "wx" : "w" });
  }

  async realpath(path: string, options?: FsOptions): Promise<string> {
    this.#call("realpath", [path], options);
    this.#entry(path);
    return this.#resolve(path);
  }

  async access(path: string, _mode?: number, options?: FsOptions): Promise<void> {
    this.#call("access", [path], options);
    this.#entry(path);
  }

  async readlink(path: string, options?: FsOptions): Promise<string> {
    this.#call("readlink", [path], options);
    const entry = this.#entry(path, false);
    if (entry.target === undefined) throw failure("EINVAL", path);
    return entry.target;
  }

  async symlink(target: string, path: string, options?: FsOptions): Promise<void> {
    this.#call("symlink", [target, path], options);
    if (this.entries.has(path)) throw failure("EEXIST", path);
    this.entries.set(path, { type: "symlink", target, bytes: Buffer.from(target), mode: 0o777 });
  }
}
