import { translatePythonOpenFlags } from './flags.js';

// Emscripten's FS is a runtime-owned ABI, rather than a canonical FileSystem.
// Structural values here deliberately follow that external, dynamically installed ABI.
export interface PythonMountOptions {
  request: (operation: string, ...args: any[]) => any;
  cwd: string;
  runtimeMount: string;
  maxTransferBytes: number;
  errno: Record<string, number>;
  synchronizationFlags: number;
  runtimeModule: any;
}
export function mountPythonFileSystem(FS: any, options: PythonMountOptions): void {
const {request: rpc, cwd, runtimeMount, maxTransferBytes, errno, synchronizationFlags} = options;
const canonicalStat = Symbol('canonical Python stat');
const runtimeDevices = createPythonRuntimeStatMapper();
const mapRuntimeStat = (stat: any) => {
  try { return runtimeDevices(stat); }
  catch { throw new FS.ErrnoError(errno.EOVERFLOW); }
};
const originalWriteStat = options.runtimeModule.SYSCALLS.writeStat;
options.runtimeModule.SYSCALLS.writeStat = (pointer: number, stat: any) => {
  if (!stat[canonicalStat]) {
    try { return originalWriteStat(pointer, mapRuntimeStat(stat)); }
    catch { throw new FS.ErrnoError(errno.EOVERFLOW); }
  }
  try { return writePythonStat(options.runtimeModule.HEAPU8, pointer, stat); }
  catch { throw new FS.ErrnoError(errno.EOVERFLOW); }
};
function path(node: any): string { return node.parent === node ? "/" : `${path(node.parent) === '/' ? '' : path(node.parent)}/${node.name}`; }
function attr(stat: any) {
  return { [canonicalStat]: true, dev: stat.dev, ino: stat.ino, mode: stat.mode | (stat.type === 'directory' ? 16384 : stat.type === 'symlink' ? 40960 : stat.type === 'character' ? 8192 : 32768), nlink: stat.nlink, uid: stat.uid, gid: stat.gid, rdev: stat.type === 'character' ? undefined : 0, size: stat.size, atime: new Date(stat.atimeMs), mtime: new Date(stat.mtimeMs), ctime: new Date(stat.ctimeMs), atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, blksize: stat.ioBlockSize ?? stat.preferredIoBlockSize, blocks: stat.allocatedBytes === undefined ? undefined : Math.ceil(stat.allocatedBytes / 512) };
}
function node(parent: any, name: string, stat: any) {
  const value = FS.createNode(parent, name, attr(stat).mode, 0);
  value.node_ops = nodeOps; value.stream_ops = streamOps;
  return value;
}
let bootstrapMountNode: any;
const nodeOps = {
  getattr: (n: any) => attr(n === bootstrapMountNode ? { type: 'directory', mode: 365, size: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 } : rpc('lstat', path(n))),
  setattr(n: any, attributes: any) {
    if (attributes.size !== undefined) rpc('truncate', path(n), attributes.size);
    if (attributes.mode !== undefined) rpc('chmod', path(n), attributes.mode & 4095);
    if (attributes.atime !== undefined || attributes.mtime !== undefined) {
      const previous = attributes.atime === undefined || attributes.mtime === undefined ? rpc('stat', path(n)) : undefined;
      rpc('utimes', path(n), attributes.atime ?? previous.atimeMs, attributes.mtime ?? previous.mtimeMs);
    }
  },
  lookup(parent: any, name: string) {
    if (parent.parent === parent && name === runtimeMount.slice(1)) return bootstrapMountNode ??= node(parent, name, { type: 'directory', mode: 365, size: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 });
    return node(parent, name, rpc('lstat', `${path(parent)}/${name}`));
  },
  mknod(parent: any, name: string, mode: number) {
    const target = `${path(parent)}/${name}`;
    if (FS.isDir(mode)) rpc('mkdir', target, { mode: mode & 4095 });
    else { const handle = rpc('open', target, { access: 'write', creation: 'exclusive', mode: mode & 4095 }); rpc('close', handle); }
    return node(parent, name, rpc('lstat', target));
  },
  rename(n: any, parent: any, name: string) { rpc('rename', path(n), `${path(parent)}/${name}`); n.name = name; n.parent = parent; },
  unlink: (parent: any, name: string) => rpc('rm', `${path(parent)}/${name}`),
  rmdir: (parent: any, name: string) => rpc('rmdir', `${path(parent)}/${name}`),
  readdir: (n: any) => ['.', '..', ...rpc('readdir', path(n)).map((entry: any) => entry.name)],
  readlink: (n: any) => rpc('readlink', path(n)),
  symlink(parent: any, name: string, target: string) { rpc('symlink', target, `${path(parent)}/${name}`); return node(parent, name, rpc('lstat', `${path(parent)}/${name}`)); },
};
const streamOps = {
  getattr: (stream: any) => attr(stream.handle ? rpc('fstat', stream.handle) : rpc('stat', path(stream.node))),
  setattr(stream: any, attributes: any) {
    if (Object.keys(attributes).some(key => key !== 'size' && key !== 'ctime' && !(key === 'timestamp' && attributes.size !== undefined))) throw new FS.ErrnoError(errno.ENOTSUP);
    if (attributes.size !== undefined) rpc('ftruncate', stream.handle, attributes.size);
  },
  open(stream: any) {
    if (FS.isDir(stream.node.mode)) return;
    stream.retained = { references: 1 };
    stream.handle = rpc('open', path(stream.node), { access: (stream.flags & 3) === 0 ? 'read' : (stream.flags & 3) === 1 ? 'write' : 'readwrite', creation: 'never', append: Boolean(stream.flags & 1024) });
  },
  dup: (stream: any) => { if (stream.retained) stream.retained.references++; },
  close: (stream: any) => { if (stream.handle && --stream.retained.references === 0) rpc('close', stream.handle); },
  fsync: (stream: any) => { rpc('sync', stream.handle, false); return 0; },
  read(stream: any, buffer: Uint8Array, offset: number, length: number, position: number) { const data = rpc('read', stream.handle, Math.min(length, maxTransferBytes), stream.seekable ? position : null); buffer.set(data, offset); return data.length; },
  write: (stream: any, buffer: Uint8Array, offset: number, length: number, position: number) => rpc('write', stream.handle, Uint8Array.from(buffer.subarray(offset, offset + Math.min(length, maxTransferBytes))), stream.pythonExplicitPosition ?? (stream.flags & 1024 || !stream.seekable ? null : position)),
  llseek(stream: any, offset: number, whence: number) { if (![0,1,2].includes(whence) || !Number.isSafeInteger(offset)) throw new FS.ErrnoError(errno.EINVAL); const position = whence === 0 ? offset : whence === 1 ? stream.position + offset : rpc('fstat', stream.handle).size + offset; if (!Number.isSafeInteger(position) || position < 0) throw new FS.ErrnoError(28); return position; },
};
const originalLookupNode = FS.lookupNode.bind(FS);
FS.lookupNode = (parent: any, name: string) => {
  const cached = originalLookupNode(parent, name);
  return parent.node_ops === nodeOps && !cached.mounted ? nodeOps.lookup(parent, name) : cached;
};
const bootstrapRoot = FS.root;
FS.root = null;
FS.mount({ mount: () => node(null, '/', rpc('stat', '/')) }, {}, '/');
FS.mount({ mount: () => bootstrapRoot }, {}, runtimeMount);
FS.chdir(rpc('realpath', cwd));
// Intercept before Emscripten decomposes atomic exclusive/truncating open.
const originalOpen = FS.open.bind(FS);
FS.open = function (inputPath: string, flags: number | string, mode = 438) {
  if (typeof flags === 'string') {
    const modes: Record<string, number> = {r:0, 'r+':2, w:577, 'w+':578, a:1089, 'a+':1090};
    const numeric = modes[flags];
    if (numeric === undefined) throw new FS.ErrnoError(errno.EINVAL);
    flags = numeric;
  }
  if (typeof inputPath !== 'string') { if ((flags & 3) !== 0 || (flags & (64 | 512))) throw new FS.ErrnoError(errno.EROFS); return originalOpen(inputPath, flags, mode); }
  if (inputPath.length === 0) throw new FS.ErrnoError(errno.ENOENT);
  const absolute = inputPath.startsWith('/') ? inputPath : `${FS.cwd()}/${inputPath}`;
  if (absolute === runtimeMount || absolute.startsWith(runtimeMount + '/')) {
    if (absolute.split('/').includes('..')) throw new FS.ErrnoError(errno.ENOTSUP);
    if (typeof flags !== 'number' || (flags & 3) !== 0 || (flags & (64 | 512))) throw new FS.ErrnoError(errno.EROFS);
    return originalOpen(inputPath, flags, mode);
  }
  if (typeof flags !== 'number') return originalOpen(inputPath, flags, mode);
  if (flags & synchronizationFlags) throw new FS.ErrnoError(errno.ENOTSUP);
  // Atomic exclusive creation already refuses symlinks and all existing entries.
  const exclusive = (flags & 192) === 192;
  if ((flags & 131072) && !exclusive) throw new FS.ErrnoError(138);
  if (flags & 65536) throw new FS.ErrnoError(54);
  let openOptions;
  try { openOptions = translatePythonOpenFlags(flags, mode); }
  catch (error) { throw new FS.ErrnoError(errno[(error as {code: string}).code] ?? errno.EIO); }
  const handle = rpc('open', absolute, openOptions);
  try {
    // Bind the stream to the acquired identity, without re-opening its pathname.
    // A concurrent rename or unlink after acquisition must not invalidate open().
    const capabilities = rpc('descriptorCapabilities', handle);
    if ((flags & 1024) && !capabilities.position) throw new FS.ErrnoError(errno.ENOTSUP);
    const seekable = ((flags & 3) === 1 || capabilities.positionedRead) && ((flags & 3) === 0 || ((flags & 1024) ? capabilities.position : capabilities.positionedWrite));
    const retainedStat = rpc('fstat', handle);
    if (retainedStat.type === 'directory') throw new FS.ErrnoError(errno.ENOTSUP);
    const retainedNode = node(FS.root, absolute.slice(1), retainedStat);
    return FS.createStream({ node: retainedNode, path: absolute, flags: flags & ~(128 | 512), seekable, position: 0, stream_ops: streamOps, ungotten: [], error: false, handle, pythonCapabilities: capabilities, retained: { references: 1 } });
  } catch (error) { rpc('close', handle); throw error; }
};

// Pass application operands intact to the authoritative resolver. Emscripten's
// lexical dot-segment normalization must not run before canonical symlink traversal.
const absolutePath = (target: string): string => target.length === 0 || target.startsWith('/') ? target : `${FS.cwd()}/${target}`;
const bootstrapPath = (target: string): boolean => {
  const absolute = absolutePath(target);
  const bootstrap = absolute === runtimeMount || absolute.startsWith(runtimeMount + '/');
  if (bootstrap && absolute.split('/').includes('..')) throw new FS.ErrnoError(errno.ENOTSUP);
  return bootstrap;
};
for (const operation of ['stat','lstat']) {
  const original = FS[operation].bind(FS);
  FS[operation] = (target: string, ...args: any[]) => bootstrapPath(target)
    ? mapRuntimeStat(original(target, ...args)) : attr(rpc(operation, absolutePath(target)));
}
const originalFstat = FS.fstat.bind(FS);
FS.fstat = (fd: number) => {
  const value = originalFstat(fd);
  return value[canonicalStat] ? value : mapRuntimeStat(value);
};
for (const [operation, canonical] of [['unlink','rm'],['rmdir','rmdir'],['chmod','chmod'],['truncate','truncate'],['utime','utimes']] as const) {
  const original = FS[operation].bind(FS);
  FS[operation] = (target: string, ...args: any[]) => bootstrapPath(target)
    ? original(target, ...args) : rpc(canonical, absolutePath(target), ...args);
}
const originalMkdir = FS.mkdir.bind(FS);
FS.mkdir = (target: string, mode = 0o777) => {
  if (bootstrapPath(target)) return originalMkdir(target, mode);
  const absolute = absolutePath(target);
  rpc('mkdir', absolute, {mode});
  return node(FS.root, absolute.slice(1), rpc('lstat', absolute));
};
const originalRename = FS.rename.bind(FS);
FS.rename = (source: string, destination: string) => bootstrapPath(source) || bootstrapPath(destination)
  ? originalRename(source, destination) : rpc('rename', absolutePath(source), absolutePath(destination));
const originalChdir = FS.chdir.bind(FS);
FS.chdir = (target: string) => bootstrapPath(target) ? originalChdir(target) : originalChdir(rpc('realpath', absolutePath(target)));

const runtimeNode = (node: any): boolean => {
  const seen = new Set();
  while (node && !seen.has(node)) {
    if (node === bootstrapRoot || node.mount?.mountpoint === runtimeMount) return true;
    seen.add(node); node = node.parent;
  }
  return false;
};
const assertWritablePath = (target: string): void => {
  if (bootstrapPath(target)) throw new FS.ErrnoError(errno.EROFS);
};
const originalSymlink = FS.symlink.bind(FS);
FS.symlink = (source: string, destination: string) => bootstrapPath(destination)
  ? originalSymlink(source, destination) : rpc('symlink', source, absolutePath(destination));
const originalReaddir = FS.readdir.bind(FS);
FS.readdir = (target: string) => bootstrapPath(target) ? originalReaddir(target)
  : ['.','..', ...rpc('readdir', absolutePath(target)).map((entry: any) => entry.name)];
const originalReadlink = FS.readlink.bind(FS);
FS.readlink = (target: string) => bootstrapPath(target) ? originalReadlink(target) : rpc('readlink', absolutePath(target));
for (const operation of ['chown','lchown','lchmod']) {
  FS[operation] = (target: string) => {assertWritablePath(target); throw new FS.ErrnoError(errno.ENOTSUP);};
}
const originalMknod = FS.mknod.bind(FS);
FS.mknod = (target: string, mode: number, device: number) => {
  if (bootstrapPath(target)) return originalMknod(target, mode, device);
  if (!FS.isFile(mode)) throw new FS.ErrnoError(errno.ENOTSUP);
  const handle = rpc('open', absolutePath(target), {access:'write',creation:'exclusive',mode:mode & 4095});
  rpc('close', handle);
  return node(FS.root, absolutePath(target).slice(1), rpc('lstat', absolutePath(target)));
};
for (const operation of ['mkdir','mknod','unlink','rmdir','chmod','lchmod','chown','lchown','truncate','utime']) {
  if (typeof FS[operation] !== 'function') continue;
  const original = FS[operation].bind(FS);
  FS[operation] = (target: string, ...args: any[]) => {assertWritablePath(target); return original(target, ...args);};
}
for (const operation of ['rename','symlink']) {
  const original = FS[operation].bind(FS);
  FS[operation] = (source: string, destination: string, ...args: any[]) => {
    if (operation === 'rename') assertWritablePath(source);
    assertWritablePath(destination); return original(source, destination, ...args);
  };
}
for (const operation of ['fchmod','fchown','ftruncate']) {
  if (typeof FS[operation] !== 'function') continue;
  const original = FS[operation].bind(FS);
  FS[operation] = (fd: number, ...args: any[]) => {
    if (runtimeNode(FS.getStreamChecked(fd).node)) throw new FS.ErrnoError(errno.EROFS);
    return original(fd, ...args);
  };
}
const originalWrite = FS.write.bind(FS);
FS.write = (stream: any, ...args: any[]) => {
  if (stream.fd > 2 && runtimeNode(stream.node)) throw new FS.ErrnoError(errno.EROFS);
  const explicit = typeof args[3] === 'number';
  if (stream.handle && (stream.flags & 1024) && explicit && !stream.pythonCapabilities.positionedAppendWrite) throw new FS.ErrnoError(errno.EINVAL);
  const previousPosition = stream.position;
  stream.pythonExplicitPosition = explicit ? args[3] : undefined;
  let written;
  try { written = originalWrite(stream, ...args); }
  finally { stream.pythonExplicitPosition = undefined; if (explicit) stream.position = previousPosition; }
  if (stream.handle && (stream.flags & 1024) && args[3] === undefined) stream.position = rpc('position', stream.handle);
  return written;
};

}

/** Encode the pinned wasm32 musl stat layout without truncating canonical values. */
export function writePythonStat(heap: Uint8Array, pointer: number, stat: Record<string, any>): number {
  const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
  const integer = (key: string, max: number): number => {
    const value = stat[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('EOVERFLOW');
    return value;
  };
  const values = {
    dev: integer('dev', 0xffffffff), mode: integer('mode', 0xffffffff),
    nlink: integer('nlink', 0xffffffff), uid: integer('uid', 0xffffffff),
    gid: integer('gid', 0xffffffff), rdev: integer('rdev', 0xffffffff),
    size: integer('size', Number.MAX_SAFE_INTEGER), ino: integer('ino', Number.MAX_SAFE_INTEGER),
    blksize: integer('blksize', 0x7fffffff), blocks: integer('blocks', 0x7fffffff),
  };
  const times = ['atime', 'mtime', 'ctime'].map(key => {
    const time = stat[key + 'Ms'] ?? stat[key]?.getTime();
    if (!Number.isFinite(time)) throw new Error('EOVERFLOW');
    let seconds = Math.floor(time / 1000);
    let nanoseconds = Math.round((time - seconds * 1000) * 1000000);
    if (nanoseconds === 1000000000) { seconds++; nanoseconds = 0; }
    if (!Number.isSafeInteger(seconds) || nanoseconds < 0 || nanoseconds >= 1000000000) throw new Error('EOVERFLOW');
    return {seconds, nanoseconds};
  });
  if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer + 96 > heap.byteLength) throw new Error('EOVERFLOW');
  for (const [index,key] of ['dev','mode','nlink','uid','gid','rdev'].entries()) view.setUint32(pointer + index * 4, values[key as keyof typeof values], true);
  view.setBigInt64(pointer+24,BigInt(values.size),true);
  view.setInt32(pointer+32,values.blksize,true);
  view.setInt32(pointer+36,values.blocks,true);
  times.forEach((time,index)=>{view.setBigInt64(pointer+40+index*16,BigInt(time.seconds),true);view.setUint32(pointer+48+index*16,time.nanoseconds,true);});
  view.setBigInt64(pointer+88,BigInt(values.ino),true);
  return 0;
}

/** Runtime storage and application storage occupy disjoint guest device ranges. */
export function createPythonRuntimeStatMapper(maxDevices = 1024): (stat: Record<string | symbol, any>) => Record<string | symbol, any> {
  if (!Number.isSafeInteger(maxDevices) || maxDevices < 1 || maxDevices > 1024) throw new RangeError('Invalid runtime device limit');
  const mapped = Symbol('mapped Python runtime device');
  const devices = new Map<number, number>();
  return stat => {
    if (stat[mapped]) return stat;
    if (!Number.isSafeInteger(stat.dev) || stat.dev < 0 || stat.dev > 0xffffffff) throw new Error('EOVERFLOW');
    let device = devices.get(stat.dev);
    if (device === undefined) {
      if (devices.size >= maxDevices) throw new Error('EOVERFLOW');
      device = 0x80000000 + devices.size;
      devices.set(stat.dev, device);
    }
    return {...stat, dev:device, [mapped]:true};
  };
}
