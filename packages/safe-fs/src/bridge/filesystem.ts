import type { FileSystem, FsOptions } from "../contracts/filesystem.js";
import { composeAbortSignals } from "../contracts/abort.js";
import { bridgeDirent, bridgeStats } from "./stats.js";
import { booleanValue, checkSignal, onlyKeys, record, withSignal } from "./values.js";
import type {
  BridgePrimitives, BufferEncodingOption, FsBridgeCodec, FsBridgeDirent, FsBridgeEncoding,
  FsBridgeFileSystem, FsBridgeStats, MakeDirectoryOptions, Mode, ObjectEncodingOptions, StatOptions
} from "./types.js";

type Encoding = FsBridgeEncoding | "buffer";
type ReadOptions = ObjectEncodingOptions & { flag?: string | number | undefined; signal?: AbortSignal | undefined };
type DirectoryOptions = { encoding?: Encoding | null | undefined; recursive?: boolean | undefined; withFileTypes?: boolean | undefined };

function fsError(code: string, syscall: string, path?: string): Error {
  return Object.assign(new Error(`${code}: ${syscall}${path === undefined ? "" : ` '${path}'`}`), {
    code,
    syscall,
    ...(path === undefined ? {} : { path }),
  });
}

function unsupported(operation: string): never {
  throw fsError("ENOTSUP", operation);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function childPath(parent: string, name: string): string {
  return `${parent.replace(/\/$/u, "")}/${name}`;
}

function optionsRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const options = value == null ? {} : typeof value === "string" ? { encoding: value } : record(value, "options");
  onlyKeys(options, allowed);
  return options;
}

function modeValue(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^[0-7]+$/u.test(value) ? Number.parseInt(value, 8) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > 0o7777) {
    throw new TypeError("Invalid file mode");
  }
  return parsed;
}

function timeValue(value: unknown): number {
  const number = value instanceof Date ? value.getTime() : Number(value) * 1000;
  if ((typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) || !Number.isFinite(number)) {
    throw new TypeError("Invalid timestamp");
  }
  return number;
}

export class FileSystemBridge<Binary extends Uint8Array> {
  readonly #fs: FsBridgeFileSystem;
  readonly #cwd: string;
  readonly #signal: AbortSignal | undefined;

  readonly #primitives: BridgePrimitives<Binary>;
  readonly #codec: FsBridgeCodec;

  constructor(fs: FileSystem, options: { readonly cwd?: string; readonly signal?: AbortSignal }, primitives: BridgePrimitives<Binary>) {
    if (fs === undefined) throw new TypeError("An explicit filesystem is required");
    const cwd = options.cwd ?? "/";
    if (!primitives.paths.isAbsolute(cwd) || cwd.includes("\0")) throw new TypeError("cwd must be an absolute virtual path");
    const codec = primitives.codec;
    if (codec === undefined || codec === null || typeof codec.isEncoding !== "function" || typeof codec.encode !== "function" || typeof codec.decode !== "function") {
      throw new TypeError("An explicit filesystem codec is required");
    }
    this.#primitives = primitives;
    this.#codec = Object.freeze({
      isEncoding: codec.isEncoding.bind(codec),
      encode: codec.encode.bind(codec),
      decode: codec.decode.bind(codec)
    });
    this.#fs = fs;
    this.#cwd = cwd;
    this.#signal = options.signal;
  }

  #encoding(value: unknown, fallback: Encoding, names = false): string {
    const selected = value == null ? fallback : value;
    if (typeof selected !== "string" || (selected !== "buffer" && !this.#codec.isEncoding(selected)) || (names && !this.#codec.isEncoding("utf8"))) {
      throw new TypeError("Invalid encoding");
    }
    return selected;
  }

  #textBytes(value: string): Binary {
    return this.#primitives.copyBytes(this.#codec.encode(value, "utf8"));
  }

  #path(value: unknown): string {
    const path = this.#primitives.pathValue === undefined ? value : this.#primitives.pathValue(value);
    if (typeof path !== "string" || path.includes("\0")) throw new TypeError("Expected a path without NUL bytes; file handles are unsupported");
    if (path.length === 0) throw fsError("ENOENT", "path", path);
    return this.#primitives.paths.isAbsolute(path) ? path : childPath(this.#cwd, path);
  }

  async #call<Value>(operation: (options: FsOptions) => Promise<Value>, signal?: unknown): Promise<Value> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError("Invalid AbortSignal");
    const signalScope = signal !== undefined && this.#signal !== undefined && signal !== this.#signal
      ? composeAbortSignals([signal, this.#signal]) : undefined;
    const combined = signalScope?.signal ?? signal ?? this.#signal;
    try {
      checkSignal(combined);
      const options = combined === undefined ? {} : { signal: combined };
      return await withSignal(combined, () => operation(options));
    } finally {
      signalScope?.dispose();
    }
  }

  readFile(path: unknown, options?: { encoding?: null | undefined; flag?: string | number | undefined; signal?: AbortSignal | undefined } | null): Promise<Binary>;
  readFile(path: unknown, options: FsBridgeEncoding | (ReadOptions & { encoding: FsBridgeEncoding })): Promise<string>;
  readFile(path: unknown, options?: ReadOptions | FsBridgeEncoding | null): Promise<string | Binary>;
  async readFile(path: unknown, value?: unknown): Promise<string | Binary> {
    const options = optionsRecord(value, ["encoding", "flag", "signal"]);
    if (options.flag !== undefined && options.flag !== "r") unsupported("readFile flag");
    if (options.encoding === "buffer") throw new TypeError("Invalid read encoding");
    const codec = this.#encoding(options.encoding, "buffer");
    const bytes = await this.#call((signal) => this.#fs.readFile(this.#path(path), signal), options.signal);
    const buffer = this.#primitives.copyBytes(bytes);
    return codec === "buffer" ? buffer : this.#codec.decode(buffer, codec);
  }

  async #write(path: unknown, data: unknown, value: unknown, fallback: "w" | "a"): Promise<void> {
    const options = optionsRecord(value, ["encoding", "flag", "mode", "flush", "signal"]);
    if (booleanValue(options.flush)) unsupported("writeFile flush");
    const codec = this.#encoding(options.encoding, "utf8");
    if (codec === "buffer") throw new TypeError("Invalid write encoding");
    const flag = options.flag ?? fallback;
    if (flag !== "w" && flag !== "wx" && flag !== "a" && flag !== "ax") unsupported("writeFile flag");
    const mode = modeValue(options.mode, 0o666);
    let bytes: Uint8Array;
    if (typeof data === "string") bytes = this.#primitives.copyBytes(this.#codec.encode(data, codec));
    else if (ArrayBuffer.isView(data)) bytes = this.#primitives.copyBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else throw new TypeError("writeFile accepts a string or ArrayBuffer view; streams and file handles are unsupported");
    await this.#call((signal) => this.#fs.writeFile(this.#path(path), bytes, { ...signal, flag, mode }), options.signal);
  }

  async writeFile(path: unknown, data: unknown, options?: unknown): Promise<void> {
    await this.#write(path, data, options, "w");
  }

  async appendFile(path: unknown, data: unknown, options?: unknown): Promise<void> {
    await this.#write(path, data, options, "a");
  }

  stat(path: unknown, options?: StatOptions & { bigint?: false | undefined }): Promise<FsBridgeStats>;
  stat(path: unknown, options: StatOptions & { bigint: true }): Promise<never>;
  stat(path: unknown, options?: StatOptions): Promise<FsBridgeStats>;
  async stat(path: unknown, value?: unknown): Promise<FsBridgeStats> {
    const options = optionsRecord(value, ["bigint"]);
    if (booleanValue(options.bigint)) unsupported("stat bigint");
    return bridgeStats(await this.#call((signal) => this.#fs.stat(this.#path(path), signal)));
  }

  lstat(path: unknown, options?: StatOptions & { bigint?: false | undefined }): Promise<FsBridgeStats>;
  lstat(path: unknown, options: StatOptions & { bigint: true }): Promise<never>;
  lstat(path: unknown, options?: StatOptions): Promise<FsBridgeStats>;
  async lstat(path: unknown, value?: unknown): Promise<FsBridgeStats> {
    const options = optionsRecord(value, ["bigint"]);
    if (booleanValue(options.bigint)) unsupported("lstat bigint");
    return bridgeStats(await this.#call((signal) => this.#fs.lstat(this.#path(path), signal)));
  }

  readdir(path: unknown, options?: FsBridgeEncoding | (ObjectEncodingOptions & { withFileTypes?: false | undefined; recursive?: boolean | undefined }) | null): Promise<string[]>;
  readdir(path: unknown, options: "buffer" | (DirectoryOptions & { encoding: "buffer"; withFileTypes?: false | undefined })): Promise<Binary[]>;
  readdir(path: unknown, options: ObjectEncodingOptions & { withFileTypes: true; recursive?: boolean | undefined }): Promise<FsBridgeDirent[]>;
  readdir(path: unknown, options: DirectoryOptions & { encoding: "buffer"; withFileTypes: true }): Promise<FsBridgeDirent<Binary>[]>;
  async readdir(path: unknown, value?: unknown): Promise<string[] | Binary[] | FsBridgeDirent[] | FsBridgeDirent<Binary>[]> {
    const options = optionsRecord(value, ["encoding", "withFileTypes", "recursive"]);
    const codec = this.#encoding(options.encoding, "utf8", true);
    const withFileTypes = booleanValue(options.withFileTypes);
    const recursive = booleanValue(options.recursive);
    const root = this.#path(path);
    const entries: { name: string; parentPath: string; relative: string; type: "file" | "directory" | "symlink" }[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.shift();
      if (directory === undefined) break;
      for (const entry of await this.#call((signal) => this.#fs.readdir(directory, signal))) {
        if (entry.name === "" || entry.name === "." || entry.name === ".." || entry.name.includes("/") || entry.name.includes("\0")) {
          throw new TypeError("Invalid directory entry from filesystem");
        }
        const fullPath = childPath(directory, entry.name);
        entries.push({ ...entry, parentPath: directory, relative: this.#primitives.paths.relative(root, fullPath) });
        if (recursive && entry.type === "directory") pending.push(fullPath);
      }
    }
    if (withFileTypes) {
      return codec === "buffer"
        ? entries.map((entry) => bridgeDirent(this.#textBytes(entry.name), entry.parentPath, entry.type))
        : entries.map((entry) => bridgeDirent(this.#codec.decode(this.#textBytes(entry.name), codec), entry.parentPath, entry.type));
    }
    return codec === "buffer"
      ? entries.map((entry) => this.#textBytes(entry.relative))
      : entries.map((entry) => this.#codec.decode(this.#textBytes(entry.relative), codec));
  }

  mkdir(path: unknown, options: MakeDirectoryOptions & { recursive: true }): Promise<string | undefined>;
  mkdir(path: unknown, options?: Mode | (MakeDirectoryOptions & { recursive?: false | undefined }) | null): Promise<void>;
  mkdir(path: unknown, options?: Mode | MakeDirectoryOptions | null): Promise<string | undefined>;
  async mkdir(path: unknown, value?: unknown): Promise<string | void> {
    const options = typeof value === "number" || typeof value === "string" ? { mode: value } : optionsRecord(value, ["mode", "recursive"]);
    const mode = modeValue(options.mode, 0o777);
    const recursive = booleanValue(options.recursive);
    const target = this.#path(path);
    let firstCreated: string | undefined;
    if (recursive) {
      let candidate = target;
      while (true) {
        try {
          await this.#call((signal) => this.#fs.stat(candidate, signal));
          break;
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
          firstCreated = candidate;
          const parent = this.#primitives.paths.dirname(candidate);
          if (parent === candidate) break;
          candidate = parent;
        }
      }
    }
    await this.#call((signal) => this.#fs.mkdir(target, { ...signal, mode, recursive }));
    return firstCreated;
  }

  async access(path: unknown, mode = 0): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new TypeError("Invalid access mode");
    await this.#call((signal) => this.#fs.access(this.#path(path), mode, signal));
  }

  async rm(path: unknown, value?: unknown): Promise<void> {
    const options = optionsRecord(value, ["force", "recursive", "maxRetries", "retryDelay"]);
    if (options.maxRetries !== undefined && options.maxRetries !== 0) unsupported("rm retries");
    if (options.retryDelay !== undefined) unsupported("rm retryDelay");
    const recursive = booleanValue(options.recursive);
    const force = booleanValue(options.force);
    await this.#call((signal) => this.#fs.rm(this.#path(path), { ...signal, recursive, force }));
  }

  async rmdir(path: unknown, value?: unknown): Promise<void> {
    const options = optionsRecord(value, ["recursive", "maxRetries", "retryDelay"]);
    const stat = await this.lstat(path);
    if (!stat.isDirectory()) throw fsError("ENOTDIR", "rmdir", this.#path(path));
    if (!booleanValue(options.recursive)) {
      if ((await this.readdir(path)).length > 0) throw fsError("ENOTEMPTY", "rmdir", this.#path(path));
      if (options.maxRetries !== undefined && options.maxRetries !== 0) unsupported("rmdir retries");
      if (options.retryDelay !== undefined) unsupported("rmdir retryDelay");
      const method = this.#fs.rmdir;
      if (method === undefined) unsupported("atomic rmdir");
      await this.#call((signal) => method.call(this.#fs, this.#path(path), signal));
    } else await this.rm(path, options);
  }

  async rename(source: unknown, destination: unknown): Promise<void> {
    await this.#call((signal) => this.#fs.rename(this.#path(source), this.#path(destination), signal));
  }

  async copyFile(source: unknown, destination: unknown, mode = 0): Promise<void> {
    if (mode !== 0 && mode !== 1) unsupported("copyFile mode");
    await this.#call((signal) => this.#fs.copyFile(this.#path(source), this.#path(destination), { ...signal, exclusive: mode === 1 }));
  }

  async cp(source: unknown, destination: unknown, value?: unknown): Promise<void> {
    const options = optionsRecord(value, ["recursive", "force", "errorOnExist", "mode", "dereference", "preserveTimestamps", "verbatimSymlinks"]);
    if (booleanValue(options.dereference) || booleanValue(options.preserveTimestamps) || booleanValue(options.verbatimSymlinks)) unsupported("cp options");
    const recursive = booleanValue(options.recursive);
    const force = booleanValue(options.force, true);
    const errorOnExist = booleanValue(options.errorOnExist);
    if (options.mode !== undefined && options.mode !== 0 && options.mode !== 1) unsupported("cp mode");
    const from = this.#path(source);
    const to = this.#path(destination);
    const canonicalFrom = await this.realpath(from);
    let ancestor = this.#primitives.paths.dirname(to);
    let canonicalAncestor: string;
    while (true) {
      try {
        canonicalAncestor = await this.realpath(ancestor);
        break;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        const parent = this.#primitives.paths.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    const canonicalTo = this.#primitives.paths.resolve(canonicalAncestor, this.#primitives.paths.relative(ancestor, to));
    if (canonicalFrom === "/" || canonicalTo === canonicalFrom || canonicalTo.startsWith(`${canonicalFrom}/`)) throw fsError("EINVAL", "cp", to);
    const copy = async (current: string, target: string): Promise<void> => {
      const sourceStat = await this.lstat(current);
      if (sourceStat.isSymbolicLink()) unsupported("cp symlink");
      let destinationStat: FsBridgeStats | undefined;
      try {
        destinationStat = await this.lstat(target);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      if (destinationStat?.isSymbolicLink()) unsupported("cp destination symlink");
      if (sourceStat.isDirectory()) {
        if (!recursive) throw fsError("EISDIR", "cp", current);
        if (destinationStat !== undefined && !destinationStat.isDirectory()) throw fsError("ENOTDIR", "cp", target);
        await this.mkdir(target, { recursive: true, mode: sourceStat.mode & 0o7777 });
        for (const entry of await this.readdir(current)) await copy(childPath(current, entry), childPath(target, entry));
      } else {
        if (destinationStat?.isDirectory()) throw fsError("EISDIR", "cp", target);
        if (destinationStat !== undefined && !force) {
          if (errorOnExist) throw fsError("EEXIST", "cp", target);
          return;
        }
        await this.mkdir(this.#primitives.paths.dirname(target), { recursive: true });
        await this.copyFile(current, target, options.mode === 1 || !force ? 1 : 0);
      }
    };
    await copy(from, to);
  }

  readlink(path: unknown, options?: ObjectEncodingOptions | FsBridgeEncoding | null): Promise<string>;
  readlink(path: unknown, options: BufferEncodingOption): Promise<Binary>;
  readlink(path: unknown, options?: ObjectEncodingOptions | BufferEncodingOption | string | null): Promise<string | Binary>;
  async readlink(path: unknown, value?: unknown): Promise<string | Binary> {
    const codec = this.#encoding(optionsRecord(value, ["encoding"]).encoding, "utf8", true);
    const method = this.#fs.readlink;
    if (method === undefined) unsupported("readlink");
    const target = await this.#call((signal) => method.call(this.#fs, this.#path(path), signal));
    return codec === "buffer" ? this.#textBytes(target) : this.#codec.decode(this.#textBytes(target), codec);
  }

  realpath(path: unknown, options?: ObjectEncodingOptions | FsBridgeEncoding | null): Promise<string>;
  realpath(path: unknown, options: BufferEncodingOption): Promise<Binary>;
  realpath(path: unknown, options?: ObjectEncodingOptions | BufferEncodingOption | string | null): Promise<string | Binary>;
  async realpath(path: unknown, value?: unknown): Promise<string | Binary> {
    const codec = this.#encoding(optionsRecord(value, ["encoding"]).encoding, "utf8", true);
    const target = await this.#call((signal) => this.#fs.realpath(this.#path(path), signal));
    return codec === "buffer" ? this.#textBytes(target) : this.#codec.decode(this.#textBytes(target), codec);
  }

  mkdtemp(prefix: string, options?: ObjectEncodingOptions | FsBridgeEncoding | null): Promise<string>;
  mkdtemp(prefix: string, options: BufferEncodingOption): Promise<Binary>;
  mkdtemp(prefix: string, options?: ObjectEncodingOptions | BufferEncodingOption | string | null): Promise<string | Binary>;
  async mkdtemp(prefix: string, value?: unknown): Promise<string | Binary> {
    if (typeof prefix !== "string" || prefix.includes("\0")) throw new TypeError("Invalid mkdtemp prefix");
    const codec = this.#encoding(optionsRecord(value, ["encoding"]).encoding, "utf8", true);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const path = prefix + this.#primitives.randomSuffix();
      try {
        await this.mkdir(path, { mode: 0o700 });
        return codec === "buffer" ? this.#textBytes(path) : this.#codec.decode(this.#textBytes(path), codec);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    }
    throw fsError("EEXIST", "mkdtemp", prefix);
  }

  async symlink(target: unknown, path: unknown, type?: unknown): Promise<void> {
    if (type !== undefined && type !== null && type !== "file" && type !== "dir") unsupported("symlink type");
    const linkTarget = this.#primitives.pathValue === undefined ? target : this.#primitives.pathValue(target);
    if (typeof linkTarget !== "string" || linkTarget.includes("\0")) throw new TypeError("Invalid symlink target");
    const method = this.#fs.symlink;
    if (method === undefined) unsupported("symlink");
    await this.#call((signal) => method.call(this.#fs, linkTarget, this.#path(path), signal));
  }

  async link(existing: unknown, path: unknown): Promise<void> {
    const method = this.#fs.link;
    if (method === undefined) unsupported("link");
    await this.#call((signal) => method.call(this.#fs, this.#path(existing), this.#path(path), signal));
  }

  async chmod(path: unknown, value: unknown): Promise<void> {
    const mode = modeValue(value, 0);
    const method = this.#fs.chmod;
    if (method === undefined) unsupported("chmod");
    await this.#call((signal) => method.call(this.#fs, this.#path(path), mode, signal));
  }

  async utimes(path: unknown, atime: unknown, mtime: unknown): Promise<void> {
    const accessTime = timeValue(atime);
    const modificationTime = timeValue(mtime);
    const method = this.#fs.utimes;
    if (method === undefined) unsupported("utimes");
    await this.#call((signal) => method.call(this.#fs, this.#path(path), accessTime, modificationTime, signal));
  }

  async truncate(path: unknown, length = 0): Promise<void> {
    if (!Number.isInteger(length)) throw new TypeError("Invalid truncate length");
    const method = this.#fs.truncate;
    if (method === undefined) unsupported("truncate");
    await this.#call((signal) => method.call(this.#fs, this.#path(path), Math.max(0, length), signal));
  }
}
