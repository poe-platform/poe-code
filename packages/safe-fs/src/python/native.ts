import { translatePythonOpenFlags } from './flags.js';
import { writePythonStat } from './emscripten.js';

export interface PythonNativeSyscallOptions {
  readonly runtime: any;
  readonly dispatch: (request: { op: string; args: unknown[] }) => Promise<unknown>;
  readonly signal: AbortSignal;
  readonly cwd: string;
  readonly runtimeMount: string;
  readonly maxTransferBytes: number;
  readonly original?: (name: string, args: readonly (number | bigint)[]) => number;
}

const errno: Record<string, number> = {
  EACCES: 2, EAGAIN: 6, EBADF: 8, EBUSY: 10, ECANCELED: 11, EEXIST: 20, EFBIG: 22,
  EINTR: 27, EINVAL: 28, EIO: 29, EISDIR: 31, ELOOP: 32, EMFILE: 33,
  ENAMETOOLONG: 37, ENFILE: 41, ENOENT: 44, ENOMEM: 48, ENOSPC: 51,
  ENOSYS: 52, ENOTSUP: 138, EOPNOTSUPP: 138, ENOTDIR: 54, ENOTEMPTY: 55, ENOTTY: 59,
  EOVERFLOW: 61, EPERM: 63, EPIPE: 64, ERANGE: 68, EROFS: 69, ESPIPE: 70,
  ETIMEDOUT: 73, EXDEV: 75,
};

interface NativeDescriptor {
  readonly handle: number;
  readonly path: string;
  readonly flags: number;
  readonly capabilities: Record<string, boolean>;
  readonly seekable: boolean;
  position: number;
  references: number;
}

export function createPythonNativeSyscalls(options: PythonNativeSyscallOptions): {
  invoke(name: string, args: readonly (number | bigint)[]): Promise<number>;
  metadata(path: string | number, follow: boolean): Promise<Record<string, any>>;
  close(): Promise<void>;
} {
  const { runtime, signal, maxTransferBytes, runtimeMount } = options;
  if (!Number.isSafeInteger(maxTransferBytes) || maxTransferBytes < 1) throw new RangeError('Invalid native transfer limit');
  const descriptors = new Map<number, NativeDescriptor>();
  const closedStdio = new Set<number>();
  let cwd = options.cwd;
  let closing: Promise<void> | undefined;
  let pending: Promise<unknown> | undefined;
  const fail = (code: string): never => { throw { code }; };
  const heap = (): Uint8Array => runtime.HEAPU8;
  const view = (): DataView => new DataView(heap().buffer, heap().byteOffset, heap().byteLength);
  const range = (pointer: number, length: number): void => {
    if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || pointer < 0 || length < 0 || pointer + length > heap().byteLength) fail('EINVAL');
  };
  const text = (pointer: number): string => {
    range(pointer, 1);
    const end = heap().indexOf(0, pointer);
    if (end < 0) fail('EINVAL');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(heap().subarray(pointer, end)); }
    catch { return fail('EINVAL'); }
  };
  const integer = (value: number | bigint): number => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) fail('EOVERFLOW');
    return number;
  };
  const descriptor = (fd: number): NativeDescriptor => descriptors.get(fd) ?? fail('EBADF');
  const pathAt = (fd: number, pointer: number, allowEmpty = false): string => {
    const path = text(pointer);
    if (!path && !allowEmpty) fail('ENOENT');
    if (path.startsWith('/')) return path;
    const base = fd === -100 ? cwd : descriptor(fd).path;
    if (fd !== -100 && path) fail('ENOTDIR');
    return path ? base + '/' + path : base;
  };
  const privatePath = (path: string): boolean => {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    const normalized = '/' + parts.join('/');
    const privateNamespace = normalized === runtimeMount || normalized.startsWith(runtimeMount + '/');
    if ((path === runtimeMount || path.startsWith(runtimeMount + '/')) && !privateNamespace) fail('EACCES');
    return privateNamespace;
  };
  const request = async (op: string, ...args: unknown[]): Promise<any> => {
    signal.throwIfAborted();
    const result = await options.dispatch({ op, args });
    signal.throwIfAborted();
    return result;
  };
  const original = (name: string, args: readonly (number | bigint)[]): number => options.original?.(name, args) ?? fail('ENOSYS');
  const privateDescriptor = (fd: number): boolean => {
    const stream = runtime.FS.getStream?.(fd);
    return !descriptors.has(fd) && typeof stream?.path === 'string' && privatePath(stream.path);
  };
  const allocate = (entry: NativeDescriptor): number => {
    const refuse = () => fail('ENOTSUP');
    const stream = runtime.FS.createStream({ path: entry.path, flags: entry.flags,
      seekable: entry.seekable, position: entry.position,
      node: { mode: 0o100000 }, stream_ops: { read: refuse, write: refuse, close: refuse } });
    descriptors.set(stream.fd, entry);
    return stream.fd;
  };
  const closeDescriptor = async (fd: number): Promise<void> => {
    const entry = descriptor(fd);
    descriptors.delete(fd);
    runtime.FS.closeStream(fd);
    if (--entry.references === 0) await options.dispatch({ op: 'close', args: [entry.handle] });
  };
  const project = (value: Record<string, any>): Record<string, any> => {
    const type = value.type === 'directory' ? 0o40000 : value.type === 'symlink' ? 0o120000 : value.type === 'character' ? 0o20000 : 0o100000;
    return { ...value, mode: value.mode | type, rdev: value.type === 'character' ? undefined : 0,
      blksize: value.ioBlockSize ?? value.preferredIoBlockSize,
      blocks: value.allocatedBytes === undefined ? undefined : Math.ceil(value.allocatedBytes / 512) };
  };
  const stat = (pointer: number, value: Record<string, any>): number => {
    try {
      return writePythonStat(heap(), pointer, project(value));
    } catch { return fail('EOVERFLOW'); }
  };
  const transfer = async (name: string, args: readonly (number | bigint)[]): Promise<number> => {
    const [fd, vectors, count] = args.map(integer) as [number, number, number];
    const positioned = name === 'fd_pread' || name === 'fd_pwrite';
    const output = integer(args[positioned ? 4 : 3]!);
    const writing = name === 'fd_write' || name === 'fd_pwrite';
    let position = positioned ? integer(args[3]!) : null;
    range(vectors, count * 8);
    range(output, 4);
    if (position !== null && position < 0) fail('EINVAL');
    const entry = fd > 2 ? descriptor(fd) : undefined;
    if (closedStdio.has(fd)) fail('EBADF');
    if (!entry && (fd < 0 || positioned || (writing ? fd === 0 : fd !== 0))) fail('EBADF');
    if (entry && (entry.flags & 3) === (writing ? 0 : 1)) fail('EBADF');
    if (entry && !positioned && (writing ? entry.capabilities.positionedWrite && !(entry.flags & 1024) : entry.capabilities.positionedRead)) position = entry.position;
    let total = 0;
    for (let index = 0; index < count; index++) {
      const pointer = view().getUint32(vectors + index * 8, true);
      const length = view().getUint32(vectors + index * 8 + 4, true);
      range(pointer, length);
      let offset = 0;
      while (offset < length) {
        const size = Math.min(length - offset, maxTransferBytes);
        let transferred: number;
        try {
          if (writing) {
            const bytes = Uint8Array.from(heap().subarray(pointer + offset, pointer + offset + size));
            transferred = entry ? await request('write', entry.handle, bytes, position)
              : (await request(fd === 1 ? 'stdout' : 'stderr', Array.from(bytes)), size);
          } else {
            const bytes = entry ? await request('read', entry.handle, size, position) : await request('stdin', size);
            if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes) || bytes.length > size) fail('EIO');
            heap().set(bytes, pointer + offset);
            transferred = bytes.length;
          }
          if (!Number.isSafeInteger(transferred) || transferred < 0 || transferred > size) fail('EIO');
        } catch (error) {
          if (!total) throw error;
          view().setUint32(output, total, true);
          return 0;
        }
        total += transferred;
        offset += transferred;
        if (position !== null) position += transferred;
        if (entry && !positioned) entry.position = writing && entry.flags & 1024
          ? await request('position', entry.handle) : entry.position + transferred;
        if (transferred < size || !writing) {
          view().setUint32(output, total, true);
          return 0;
        }
      }
    }
    view().setUint32(output, total, true);
    return 0;
  };
  const execute = async (name: string, args: readonly (number | bigint)[]): Promise<number> => {
    signal.throwIfAborted();
    const first = integer(args[0] ?? 0);
    const second = integer(args[1] ?? 0);
    const third = integer(args[2] ?? 0);
    const fourth = integer(args[3] ?? 0);
    if (name.startsWith('fd_') && privateDescriptor(first)) {
      if (name === 'fd_write' || name === 'fd_pwrite') fail('EROFS');
      return original(name, args);
    }
    switch (name) {
      case '__syscall_openat': {
        const path = pathAt(first, second);
        if (privatePath(path)) {
          if ((third & 3) !== 0 || (third & (64 | 512))) fail('EROFS');
          return original(name, args);
        }
        if (fourth) range(fourth, 4);
        const openOptions = translatePythonOpenFlags(third, fourth ? view().getUint32(fourth, true) : 0o666);
        const handle = await options.dispatch({op:'open', args:[path, openOptions]}) as number;
        try {
          signal.throwIfAborted();
          const capabilities = await request('descriptorCapabilities', handle);
          if ((third & 1024) && !capabilities.position) fail('ENOTSUP');
          const access = third & 3;
          const seekable = (access === 1 || capabilities.positionedRead === true)
            && (access === 0 || ((third & 1024) ? capabilities.position === true : capabilities.positionedWrite === true));
          return allocate({handle, path, flags: third, capabilities, seekable, position: 0, references: 1});
        } catch (error) {
          await options.dispatch({op:'close', args:[handle]}).catch(() => {});
          throw error;
        }
      }
      case 'fd_read': case 'fd_pread': case 'fd_write': case 'fd_pwrite': return transfer(name, args);
      case 'fd_close':
        if (first <= 2) {
          if (first < 0 || closedStdio.has(first)) fail('EBADF');
          const status = options.original?.(name, args) ?? 0;
          if (status === 0) closedStdio.add(first);
          return status;
        }
        await closeDescriptor(first); return 0;
      case 'fd_seek': {
        if (first < 0 || closedStdio.has(first)) fail('EBADF');
        if (first <= 2) fail('ESPIPE');
        const entry = descriptor(first);
        if (!entry.seekable) fail('ESPIPE');
        if (third < 0 || third > 2) fail('EINVAL');
        const position = second + (third === 0 ? 0 : third === 1 ? entry.position : (await request('fstat', entry.handle)).size);
        if (!Number.isSafeInteger(position) || position < 0) fail('EINVAL');
        range(fourth, 8);
        entry.position = position;
        view().setBigInt64(fourth, BigInt(position), true);
        return 0;
      }
      case 'fd_sync': case '__syscall_fdatasync':
        await request('sync', descriptor(first).handle, name === '__syscall_fdatasync'); return 0;
      case '__syscall_fstat64':
        if (first < 0 || closedStdio.has(first)) fail('EBADF');
        if (first <= 2 || privateDescriptor(first)) return original(name, args);
        return stat(second, await request('fstat', descriptor(first).handle));
      case '__syscall_stat64': case '__syscall_lstat64': {
        const path = pathAt(-100, first);
        if (privatePath(path)) return original(name, args);
        return stat(second, await request(name === '__syscall_stat64' ? 'stat' : 'lstat', path));
      }
      case '__syscall_newfstatat': {
        if (fourth & ~(256 | 4096)) fail('EINVAL');
        const path = pathAt(first, second, Boolean(fourth & 4096));
        if (privatePath(path)) return original(name, args);
        return stat(third, await request(fourth & 256 ? 'lstat' : 'stat', path));
      }
      case '__syscall_getcwd': {
        const bytes = new TextEncoder().encode(cwd + '\0');
        if (!second) fail('EINVAL');
        if (bytes.length > second) fail('ERANGE');
        range(first, bytes.length); heap().set(bytes, first); return bytes.length;
      }
      case '__syscall_chdir': {
        const path = pathAt(-100, first);
        if (privatePath(path)) fail('ENOTSUP');
        const resolved = await request('realpath', path);
        if ((await request('stat', resolved)).type !== 'directory') fail('ENOTDIR');
        cwd = resolved;
        runtime.FS.currentPath = cwd;
        return 0;
      }
      case '__syscall_ioctl':
        if (first < 0 || closedStdio.has(first)) fail('EBADF');
        if (first > 2 && !privateDescriptor(first)) descriptor(first);
        return fail('ENOTTY');
      case '__syscall_fcntl64': {
        if (first < 0 || closedStdio.has(first)) fail('EBADF');
        if (first <= 2 || privateDescriptor(first)) return original(name, args);
        const entry = descriptor(first);
        if (second === 1 || second === 2) return 0;
        if (second === 3) return entry.flags;
        return fail('ENOTSUP');
      }
      case '__syscall_dup': {
        const entry = descriptor(first);
        const fd = allocate(entry); entry.references++; return fd;
      }
      case '__syscall_ftruncate64':
        await request('ftruncate', descriptor(first).handle, second); return 0;
      case '__syscall_getdents64':
        if (privateDescriptor(first)) return original(name, args);
        descriptor(first); return fail('ENOTSUP');
      case '__syscall_faccessat': {
        if (fourth !== 0) fail('ENOTSUP');
        const path = pathAt(first, second);
        if (privatePath(path)) return third & 2 ? fail('EROFS') : original(name, args);
        await request('access', path, third); return 0;
      }
      case '__syscall_mkdirat': case '__syscall_unlinkat': {
        const path = pathAt(first, second);
        if (privatePath(path)) fail('EROFS');
        if (name === '__syscall_mkdirat') await request('mkdir', path, {mode:third & 0o7777});
        else {
          if (third !== 0 && third !== 512) fail('EINVAL');
          await request(third === 512 ? 'rmdir' : 'rm', path);
        }
        return 0;
      }
      case '__syscall_rmdir': case '__syscall_chmod': case '__syscall_truncate64': {
        const path = pathAt(-100, first);
        if (privatePath(path)) fail('EROFS');
        if (name === '__syscall_rmdir') await request('rmdir', path);
        else await request(name === '__syscall_chmod' ? 'chmod' : 'truncate', path, second);
        return 0;
      }
      case '__syscall_renameat': {
        const source = pathAt(first, second);
        const destination = pathAt(third, fourth);
        if (privatePath(source) || privatePath(destination)) fail('EROFS');
        await request('rename', source, destination); return 0;
      }
      case '__syscall_symlinkat': {
        const destination = pathAt(second, third);
        if (privatePath(destination)) fail('EROFS');
        await request('symlink', text(first), destination); return 0;
      }
      case '__syscall_readlinkat': {
        const path = pathAt(first, second);
        if (privatePath(path)) return original(name, args);
        if (fourth < 1) fail('EINVAL');
        range(third, fourth);
        const bytes = new TextEncoder().encode(await request('readlink', path)).subarray(0, fourth);
        heap().set(bytes, third); return bytes.length;
      }
      default: return fail('ENOSYS');
    }
  };
  return {
    async metadata(path, follow) {
      if (closing || pending) fail('EBUSY');
      const operation = (async () => {
        signal.throwIfAborted();
        if (path === '') fail('ENOENT');
        if (typeof path === 'number' && (path < 0 || closedStdio.has(path))) fail('EBADF');
        if (typeof path === 'number' && (path <= 2 || privateDescriptor(path)) || typeof path === 'string' && privatePath(path.startsWith('/') ? path : cwd + '/' + path)) {
          const value = typeof path === 'number' ? runtime.FS.fstat(path) : follow ? runtime.FS.stat(path) : runtime.FS.lstat(path);
          return {...value, atimeMs:value.atime.getTime(), mtimeMs:value.mtime.getTime(), ctimeMs:value.ctime.getTime()};
        }
        const value = typeof path === 'number' ? await request('fstat', descriptor(path).handle)
          : await request(follow ? 'stat' : 'lstat', path.startsWith('/') ? path : cwd + '/' + path);
        return project(value);
      })();
      pending = operation;
      try { return await operation; }
      finally { pending = undefined; }
    },
    invoke(name, args) {
      if (closing || pending) return Promise.resolve((name.startsWith('fd_') ? 1 : -1) * errno.EBUSY!);
      const operation = execute(name, args).catch(error => {
        const code = signal.aborted ? errno.ECANCELED! : errno[(error as {code?: string})?.code ?? ''] ?? errno.EIO!;
        return (name.startsWith('fd_') ? 1 : -1) * code;
      });
      pending = operation;
      void operation.then(() => { pending = undefined; });
      return operation;
    },
    close() {
      closing ??= (async () => {
        await pending?.catch(() => {});
        const failures: unknown[] = [];
        for (const fd of [...descriptors.keys()]) {
          try { await closeDescriptor(fd); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'Native Python descriptor cleanup failed');
      })();
      return closing;
    },
  };
}
