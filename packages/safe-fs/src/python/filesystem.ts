import { parsePythonFsRequest } from "./request.js";
import { composeAbortSignals } from "../contracts/abort.js";
import { FsError } from "../contracts/errors.js";
import type { FileDescriptor, FileSystem, OpenFileOptions, MkdirOptions } from "../contracts/filesystem.js";
import { validatePath } from "../contracts/virtual-path.js";

export type PythonFsRequest =
  | { readonly op: "open"; readonly args: readonly [string, OpenFileOptions] }
  | { readonly op: "read"; readonly args: readonly [number, number, number | null] }
  | { readonly op: "write"; readonly args: readonly [number, Uint8Array, number | null] }
  | { readonly op: "fstat" | "close" | "position" | "descriptorCapabilities"; readonly args: readonly [number] }
  | { readonly op: "ftruncate"; readonly args: readonly [number, number] }
  | { readonly op: "sync"; readonly args: readonly [number, boolean] }
  | { readonly op: "stat" | "lstat" | "readdir" | "realpath" | "readlink" | "rm" | "rmdir"; readonly args: readonly [string] }
  | { readonly op: "rename" | "symlink" | "link"; readonly args: readonly [string, string] }
  | { readonly op: "mkdir"; readonly args: readonly [string, MkdirOptions?] }
  | { readonly op: "chmod" | "truncate" | "access"; readonly args: readonly [string, number] }
  | { readonly op: "utimes"; readonly args: readonly [string, number, number] };

export interface PythonFileSystemOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly maxTransferBytes?: number;
  readonly maxOpenFiles?: number;
  readonly maxDirectoryEntries?: number;
  /** Caller-owned acquisition wrapper, e.g. shell descriptor quota enrollment. */
  readonly open?: (path: string, options: OpenFileOptions) => Promise<FileDescriptor>;
}

/** Async half of a worker RPC filesystem. Never run this on an Atomics.wait-blocked interpreter thread. */
export class PythonFileSystem {
  readonly #fs: FileSystem;
  readonly #cwd: string;
  readonly #transfer: number;
  readonly #limit: number;
  readonly #directoryLimit: number;
  readonly #open: PythonFileSystemOptions["open"];
  readonly #abort = new AbortController();
  readonly #scope: ReturnType<typeof composeAbortSignals>;
  readonly #handles = new Map<number, FileDescriptor>();
  readonly #pending = new Set<Promise<unknown>>();
  #acquiring = 0;
  #next = 1;
  #closing: Promise<void> | undefined;

  constructor(fs: FileSystem, options: PythonFileSystemOptions) {
    this.#fs = fs;
    validatePath(options.cwd);
    if (!options.cwd.startsWith("/")) throw new FsError("EINVAL", { syscall: "python filesystem", path: options.cwd, message: "cwd must be absolute" });
    this.#cwd = options.cwd;
    this.#transfer = options.maxTransferBytes ?? 65536;
    this.#limit = options.maxOpenFiles ?? 256;
    this.#directoryLimit = options.maxDirectoryEntries ?? 65536;
    for (const limit of [this.#transfer, this.#limit, this.#directoryLimit]) if (!Number.isSafeInteger(limit) || limit < 1) throw new FsError("EINVAL", { syscall: "python filesystem" });
    this.#open = options.open;
    this.#scope = composeAbortSignals([...(options.signal === undefined ? [] : [options.signal]), this.#abort.signal]);
  }

  dispatch(value: unknown): Promise<unknown> {
    if (this.#closing) return Promise.reject(new FsError("EBADF"));
    let request: PythonFsRequest;
    try {
      this.#scope.signal.throwIfAborted();
      request = parsePythonFsRequest(value, this.#transfer);
    } catch (error) { return Promise.reject(error); }
    const operation = this.#execute(request);
    this.#pending.add(operation);
    void operation.then(() => this.#pending.delete(operation), () => this.#pending.delete(operation));
    return operation;
  }

  #path(path: string): string {
    validatePath(path);
    if (path.length === 0) throw new FsError("ENOENT", { syscall: "resolve", path });
    return path.startsWith("/") ? path : `${this.#cwd === "/" ? "" : this.#cwd}/${path}`;
  }

  #handle(id: number): FileDescriptor {
    const handle = this.#handles.get(id);
    if (!handle) throw new FsError("EBADF");
    return handle;
  }

  #size(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) throw new FsError("EINVAL");
    if (size > this.#transfer) throw new FsError("EFBIG", { message: "Python filesystem transfer exceeds configured limit" });
  }

  async #execute(request: PythonFsRequest): Promise<unknown> {
    const signal = this.#scope.signal;
    signal.throwIfAborted();
    const options = { signal };
    const fs = this.#fs;
    switch (request.op) {
      case "open": {
        const [path, supplied] = request.args;
        if (this.#handles.size + this.#acquiring >= this.#limit || !Number.isSafeInteger(this.#next)) throw new FsError("EMFILE", { syscall: "open" });
        if (!this.#open && !fs.open) throw new FsError("ENOTSUP", { syscall: "open", path });
        this.#acquiring++;
        let handle: FileDescriptor | undefined;
        try {
          // A following capability query cannot preflight exclusive final-entry acquisition.
          // The canonical open remains authoritative for selected-path policy and atomic refusal.
          const capabilities = supplied.creation !== "exclusive" && fs.capabilitiesFor ? await fs.capabilitiesFor(this.#path(path), { signal, ...(supplied.creation === "ifMissing" ? { create: true } : {}) }) : fs.capabilities;
          if (capabilities.readOnly === true && (supplied.access === "write" || supplied.access === "readwrite" || supplied.creation === "ifMissing" || supplied.creation === "exclusive" || supplied.truncate === true || supplied.append === true)) throw new FsError("EROFS", { syscall: "open", path });
          if (capabilities.open === false) throw new FsError("ENOTSUP", { syscall: "open", path });
          signal.throwIfAborted();
          const open = this.#open ?? fs.open!.bind(fs);
          handle = await open(this.#path(path), { ...supplied, signal });
          signal.throwIfAborted();
          const id = this.#next++;
          this.#handles.set(id, handle);
          return id;
        } catch (error) {
          if (handle) try { await handle.close(); } catch { /* Preserve the acquisition failure. */ }
          signal.throwIfAborted();
          throw error;
        } finally { this.#acquiring--; }
      }
      case "close": {
        const [id] = request.args;
        const handle = this.#handle(id);
        this.#handles.delete(id);
        await handle.close();
        return;
      }
      case "descriptorCapabilities": return { ...this.#handle(request.args[0]).capabilities };
      case "fstat": return this.#handle(request.args[0]).stat(options);
      case "position": {
        const handle = this.#handle(request.args[0]);
        if (handle.capabilities.position !== true || !handle.getPosition) throw new FsError("ENOTSUP");
        return handle.getPosition(options);
      }
      case "read": {
        const [id, length, position] = request.args;
        this.#size(length);
        const buffer = new Uint8Array(length);
        const count = await this.#handle(id).read(buffer, position, options);
        if (!Number.isSafeInteger(count) || count < 0 || count > length) throw new FsError("EIO");
        return buffer.slice(0, count);
      }
      case "write": {
        const [id, data, position] = request.args;
        if (!(data instanceof Uint8Array)) throw new FsError("EINVAL");
        this.#size(data.byteLength);
        // The request may outlive its transport's shared reply/request slot.
        const owned = data.slice();
        const count = await this.#handle(id).write(owned, position, options);
        if (!Number.isSafeInteger(count) || count < 0 || count > owned.byteLength) throw new FsError("EIO");
        return count;
      }
      case "ftruncate": return this.#handle(request.args[0]).truncate(request.args[1], options);
      case "sync": return this.#handle(request.args[0]).sync(request.args[1], options);
      case "stat": return fs.stat(this.#path(request.args[0]), options);
      case "lstat": return fs.lstat(this.#path(request.args[0]), options);
      case "realpath": return fs.realpath(this.#path(request.args[0]), options);
      case "readdir": return fs.readdir(this.#path(request.args[0]), { ...options, maxEntries: this.#directoryLimit });
      case "access": return fs.access(this.#path(request.args[0]), request.args[1], options);
      case "mkdir": return fs.mkdir(this.#path(request.args[0]), { ...request.args[1], ...options });
      case "rm": {
        const path = this.#path(request.args[0]);
        if (!fs.unlink) throw new FsError("ENOTSUP", { syscall: "unlink", path });
        return fs.unlink(path, options);
      }
      case "rmdir": {
        const path = this.#path(request.args[0]);
        const capabilities = fs.capabilitiesFor ? await fs.capabilitiesFor(path, options) : fs.capabilities;
        signal.throwIfAborted();
        if (capabilities.readOnly === true) throw new FsError("EROFS", { syscall: "rmdir", path });
        if (!fs.rmdir || capabilities.removeDirectory === false || capabilities.snapshotRmdir === true) throw new FsError("ENOTSUP", { syscall: "rmdir", path });
        return fs.rmdir(path, options);
      }
      case "rename": return fs.rename(this.#path(request.args[0]), this.#path(request.args[1]), options);
      case "readlink": if (fs.readlink) return fs.readlink(this.#path(request.args[0]), options); break;
      case "symlink": if (fs.symlink) return fs.symlink(request.args[0], this.#path(request.args[1]), options); break;
      case "link": if (fs.link) return fs.link(this.#path(request.args[0]), this.#path(request.args[1]), options); break;
      case "chmod": if (fs.chmod) return fs.chmod(this.#path(request.args[0]), request.args[1], options); break;
      case "truncate": if (fs.truncate) return fs.truncate(this.#path(request.args[0]), request.args[1], options); break;
      case "utimes": if (fs.utimes) return fs.utimes(this.#path(request.args[0]), request.args[1], request.args[2], options); break;
    }
    throw new FsError("ENOTSUP", { syscall: request.op });
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.#closing = Promise.resolve().then(async () => {
        await Promise.allSettled([...this.#pending]);
        const handles = [...this.#handles.values()];
        this.#handles.clear();
        const results = await Promise.allSettled(handles.map(handle => handle.close()));
        this.#scope.dispose();
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      });
      this.#abort.abort(new FsError("ECANCELED", { syscall: "python filesystem close" }));
    }
    return this.#closing;
  }
}
