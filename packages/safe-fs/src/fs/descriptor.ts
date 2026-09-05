import { FsError } from "../contracts/errors.js";
import { finishCleanup } from "../contracts/cleanup.js";
import type { FileDescriptor, FileDescriptorCapabilities, FileStat, FsOptions, OpenFileOptions } from "../contracts/filesystem.js";

export interface DescriptorOpenOptions extends OpenFileOptions {
  readonly creation: "never" | "ifMissing" | "exclusive";
  readonly truncate: boolean;
  readonly append: boolean;
  readonly mode: number;
}

export interface DescriptorBackend<Resource> {
  readonly resource: Resource;
  readonly capabilities?: FileDescriptorCapabilities;
  getPosition?(resource: Resource, options: FsOptions): Promise<number>;
  probeRead?(resource: Resource, options: FsOptions): Promise<"ready" | "blocked" | "unknown">;
  stat(resource: Resource, options: FsOptions): Promise<FileStat>;
  read(resource: Resource, buffer: Uint8Array, position: number | null, options: FsOptions): Promise<number>;
  write(resource: Resource, buffer: Uint8Array, position: number | null, options: FsOptions): Promise<number>;
  truncate(resource: Resource, length: number, options: FsOptions): Promise<void>;
  sync(resource: Resource, dataOnly: boolean, options: FsOptions): Promise<void>;
  close(resource: Resource): Promise<void>;
}

function admitCapabilities(path: string, options: OpenFileOptions, capabilities: FileDescriptorCapabilities): void {
  if (![capabilities.positionedRead, capabilities.positionedWrite, capabilities.truncate].every(value => typeof value === "boolean")
    || capabilities.position !== undefined && typeof capabilities.position !== "boolean"
    || capabilities.readObservation !== undefined && typeof capabilities.readObservation !== "boolean"
    || capabilities.openTruncate !== undefined && typeof capabilities.openTruncate !== "boolean"
    || capabilities.positionedAppendWrite !== undefined && typeof capabilities.positionedAppendWrite !== "boolean"
    || !["none", "volatile", "storage"].includes(capabilities.synchronization)) throw new FsError("EINVAL", { syscall: "open", path });
  if (options.truncate && !(capabilities.openTruncate ?? capabilities.truncate) || options.synchronization !== undefined && capabilities.synchronization === "none") {
    throw new FsError("ENOTSUP", { syscall: "open", path });
  }
}

export function forwardFileDescriptor(descriptor: FileDescriptor,
  operation: <Result>(syscall: string, options: FsOptions, action: () => Promise<Result>) => Promise<Result>,
  capabilities?: FileDescriptorCapabilities,
  snapshot: (stat: FileStat) => FileStat = stat => ({ ...stat })): DescriptorBackend<FileDescriptor> {
  const retainedCapabilities = Object.freeze({ ...descriptor.capabilities });
  const selected = Object.freeze({ ...(capabilities ?? retainedCapabilities) });
  const getPosition = selected.position === true && retainedCapabilities.position === true ? descriptor.getPosition : undefined;
  if (selected.position === true && typeof getPosition !== "function") throw new FsError("ENOTSUP", { syscall: "getPosition" });
  const probeRead = selected.readObservation === true && retainedCapabilities.readObservation === true ? descriptor.probeRead : undefined;
  if (selected.readObservation === true && typeof probeRead !== "function") throw new FsError("ENOTSUP", { syscall: "probeRead" });
  return {
    resource: descriptor, capabilities: selected,
    ...(getPosition === undefined ? {} : {
      getPosition: (retained: FileDescriptor, options: FsOptions) => operation("getPosition", options, () => getPosition.call(retained, options)),
    }),
    ...(probeRead === undefined ? {} : {
      probeRead: (retained: FileDescriptor, options: FsOptions) => operation("probeRead", options, () => probeRead.call(retained, options)),
    }),
    stat: (retained, options) => operation("fstat", options, async () => snapshot(await retained.stat(options))),
    read: (retained, buffer, position, options) => operation("read", options, () => retained.read(buffer, position, options)),
    write: (retained, buffer, position, options) => operation("write", options, () => retained.write(buffer, position, options)),
    truncate: (retained, length, options) => operation("ftruncate", options, () => retained.truncate(length, options)),
    sync: (retained, dataOnly, options) => operation(dataOnly ? "fdatasync" : "fsync", options, () => retained.sync(dataOnly, options)),
    close: retained => operation("close", {}, () => retained.close()),
  };
}

function integer(value: number, syscall: string, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new FsError("EINVAL", { syscall, path });
}

class ManagedFileDescriptor<Resource> implements FileDescriptor {
  readonly capabilities: FileDescriptorCapabilities;
  readonly #path: string;
  readonly #access: OpenFileOptions["access"];
  readonly #append: boolean;
  #getPosition: DescriptorBackend<Resource>["getPosition"];
  #probeRead: DescriptorBackend<Resource>["probeRead"];
  #backend: DescriptorBackend<Resource> | undefined;
  #pending: Promise<void> = Promise.resolve();
  #closing: Promise<void> | undefined;

  constructor(path: string, options: DescriptorOpenOptions, capabilities: FileDescriptorCapabilities, backend: DescriptorBackend<Resource>) {
    this.#path = path;
    this.#access = options.access;
    this.#append = options.append;
    const getPosition = capabilities.position === true ? backend.getPosition : undefined;
    if (capabilities.position === true && typeof getPosition !== "function") throw new FsError("ENOTSUP", { syscall: "getPosition", path });
    this.#getPosition = getPosition?.bind(backend);
    const probeRead = capabilities.readObservation === true ? backend.probeRead : undefined;
    if (capabilities.readObservation === true && typeof probeRead !== "function") throw new FsError("ENOTSUP", { syscall: "probeRead", path });
    this.#probeRead = probeRead?.bind(backend);
    this.#backend = backend;
    const positionedAppendWrite = capabilities.positionedAppendWrite === true && capabilities.positionedWrite && options.access !== "read";
    this.capabilities = Object.freeze({
      ...(capabilities.position === undefined ? {} : { position: capabilities.position }),
      ...(capabilities.readObservation === undefined ? {} : { readObservation: capabilities.readObservation }),
      ...(capabilities.openTruncate === undefined ? {} : { openTruncate: capabilities.openTruncate }),
      positionedRead: capabilities.positionedRead && options.access !== "write",
      positionedWrite: capabilities.positionedWrite && options.access !== "read" && (!options.append || positionedAppendWrite),
      ...(capabilities.positionedAppendWrite === undefined ? {} : { positionedAppendWrite }),
      truncate: capabilities.truncate && options.access !== "read",
      synchronization: capabilities.synchronization,
    });
  }

  #run<Result>(syscall: string, options: FsOptions,
    action: (backend: DescriptorBackend<Resource>, options: FsOptions) => Promise<Result>): Promise<Result> {
    const signal = options.signal;
    try {
      signal?.throwIfAborted();
      if (this.#closing || !this.#backend) throw new FsError("EBADF", { syscall, path: this.#path });
    } catch (error) { return Promise.reject(error); }
    const forwarded = signal === undefined ? {} : { signal };
    const operation = this.#pending.then(async () => {
      signal?.throwIfAborted();
      try {
        const result = await action(this.#backend!, forwarded);
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        throw error;
      }
    });
    this.#pending = operation.then(() => {}, () => {});
    return operation;
  }

  #position(buffer: Uint8Array, position: number | null, syscall: "read" | "write"): void {
    if (!(buffer instanceof Uint8Array)) throw new FsError("EINVAL", { syscall, path: this.#path });
    if (position !== null) {
      integer(position, syscall, this.#path);
      if (syscall === "write" && this.#append && this.capabilities.positionedAppendWrite !== true) throw new FsError("EINVAL", { syscall, path: this.#path });
      if (!(syscall === "read" ? this.capabilities.positionedRead : this.capabilities.positionedWrite)) {
        throw new FsError("ESPIPE", { syscall, path: this.#path });
      }
    }
  }

  stat(options: FsOptions = {}): Promise<FileStat> {
    return this.#run("fstat", options, (backend, forwarded) => backend.stat(backend.resource, forwarded));
  }

  getPosition(options: FsOptions = {}): Promise<number> {
    return this.#run("getPosition", options, async (backend, forwarded) => {
      if (!this.capabilities.position || !this.#getPosition) throw new FsError("ENOTSUP", { syscall: "getPosition", path: this.#path });
      const position = await this.#getPosition(backend.resource, forwarded);
      if (!Number.isSafeInteger(position) || position < 0) throw new FsError("EIO", { syscall: "getPosition", path: this.#path });
      return position;
    });
  }

  probeRead(options: FsOptions = {}): Promise<"ready" | "blocked" | "unknown"> {
    return this.#run("probeRead", options, async (backend, forwarded) => {
      if (!this.capabilities.readObservation || !this.#probeRead) throw new FsError("ENOTSUP", { syscall: "probeRead", path: this.#path });
      const readiness = await this.#probeRead(backend.resource, forwarded);
      if (readiness !== "ready" && readiness !== "blocked" && readiness !== "unknown") throw new FsError("EIO", { syscall: "probeRead", path: this.#path });
      return readiness;
    });
  }

  read(buffer: Uint8Array, position: number | null, options: FsOptions = {}): Promise<number> {
    return this.#run("read", options, async (backend, forwarded) => {
      if (this.#access === "write") throw new FsError("EBADF", { syscall: "read", path: this.#path });
      this.#position(buffer, position, "read");
      if (buffer.byteLength === 0) return 0;
      const count = await backend.read(backend.resource, buffer, position, forwarded);
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.byteLength) throw new FsError("EIO", { syscall: "read", path: this.#path });
      return count;
    });
  }

  write(buffer: Uint8Array, position: number | null, options: FsOptions = {}): Promise<number> {
    return this.#run("write", options, async (backend, forwarded) => {
      if (this.#access === "read") throw new FsError("EBADF", { syscall: "write", path: this.#path });
      this.#position(buffer, position, "write");
      if (buffer.byteLength === 0) return 0;
      const count = await backend.write(backend.resource, buffer, position, forwarded);
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.byteLength) throw new FsError("EIO", { syscall: "write", path: this.#path });
      return count;
    });
  }

  truncate(length: number, options: FsOptions = {}): Promise<void> {
    return this.#run("ftruncate", options, async (backend, forwarded) => {
      if (this.#access === "read") throw new FsError("EBADF", { syscall: "ftruncate", path: this.#path });
      integer(length, "ftruncate", this.#path);
      if (!this.capabilities.truncate) throw new FsError("ENOTSUP", { syscall: "ftruncate", path: this.#path });
      await backend.truncate(backend.resource, length, forwarded);
    });
  }

  sync(dataOnly: boolean, options: FsOptions = {}): Promise<void> {
    return this.#run(dataOnly ? "fdatasync" : "fsync", options, async (backend, forwarded) => {
      if (typeof dataOnly !== "boolean") throw new FsError("EINVAL", { syscall: "fsync", path: this.#path });
      if (this.capabilities.synchronization === "none") throw new FsError("ENOTSUP", { syscall: dataOnly ? "fdatasync" : "fsync", path: this.#path });
      await backend.sync(backend.resource, dataOnly, forwarded);
    });
  }

  close(): Promise<void> {
    this.#closing ??= this.#pending.then(async () => {
      try { await this.#backend!.close(this.#backend!.resource); }
      finally {
        this.#backend = undefined;
        this.#getPosition = undefined;
        this.#probeRead = undefined;
        this.#pending = Promise.resolve();
      }
    });
    return this.#closing;
  }
}

export async function openFileDescriptor<Resource>(path: string, options: OpenFileOptions,
  capabilities: FileDescriptorCapabilities,
  acquire: (options: DescriptorOpenOptions) => Promise<DescriptorBackend<Resource>>): Promise<FileDescriptor> {
  if (!options || typeof options !== "object") throw new FsError("EINVAL", { syscall: "open", path });
  const signal = options.signal;
  signal?.throwIfAborted();
  const keys = ["access", "creation", "truncate", "append", "mode", "synchronization", "signal"];
  const { access, creation = "never", truncate = false, append = false, mode = 0o666, synchronization } = options;
  if (Object.keys(options).some(key => !keys.includes(key))
    || !["read", "write", "readwrite"].includes(access)
    || !["never", "ifMissing", "exclusive"].includes(creation)
    || typeof truncate !== "boolean" || typeof append !== "boolean"
    || access === "read" && (truncate || append)
    || synchronization !== undefined && !["data", "all"].includes(synchronization)
    || !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new FsError("EINVAL", { syscall: "open", path });
  }
  const admitted: DescriptorOpenOptions = Object.freeze({ access, creation, truncate, append, mode,
    ...(signal === undefined ? {} : { signal }), ...(synchronization === undefined ? {} : { synchronization }) });
  const admittedCapabilities = Object.freeze({ ...capabilities });
  admitCapabilities(path, admitted, admittedCapabilities);
  let backend: DescriptorBackend<Resource>;
  try { backend = await acquire(admitted); }
  catch (error) { signal?.throwIfAborted(); throw error; }
  try {
    signal?.throwIfAborted();
    const selected = Object.freeze({ ...(backend.capabilities ?? admittedCapabilities) });
    signal?.throwIfAborted();
    admitCapabilities(path, admitted, selected);
    const descriptor = new ManagedFileDescriptor(path, admitted, selected, backend);
    signal?.throwIfAborted();
    return descriptor;
  } catch (error) {
    await finishCleanup(() => backend.close(backend.resource), true);
    signal?.throwIfAborted();
    throw error;
  }
}
