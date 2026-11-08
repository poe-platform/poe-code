import { parentPort, workerData } from 'node:worker_threads';
import { loadPyodide } from './node_modules/pyodide/pyodide.mjs';
const pyodide = await loadPyodide({ indexURL: new URL('./node_modules/pyodide/', import.meta.url).pathname });
const FS = pyodide.FS;
const rootMount = workerData.rootMount === true;
const mountPath = rootMount ? '/' : '/work';
const control = new Int32Array(workerData.shared, 0, 2);
const bytes = new Uint8Array(workerData.shared, 8);
const errno = JSON.parse(pyodide.runPython("__import__('json').dumps({name: value for name, value in vars(__import__('errno')).items() if name.startswith('E') and isinstance(value, int)})"));
const synchronizationFlags = pyodide.runPython("__import__('os').O_SYNC | __import__('os').O_DSYNC");
function rpc(op, ...args) {
  Atomics.store(control, 0, 0);
  parentPort.postMessage({ op, args });
  Atomics.wait(control, 0, 0);
  const result = JSON.parse(new TextDecoder().decode(bytes.slice(0, Atomics.load(control, 1))));
  if (Atomics.load(control, 0) === 2) throw new FS.ErrnoError(errno[result.code] ?? 29);
  return result;
}
function path(node) { return node.parent === node ? mountPath : `${path(node.parent) === '/' ? '' : path(node.parent)}/${node.name}`; }
function attr(stat) {
  return { dev: stat.dev ?? 0, ino: stat.ino ?? 0, mode: stat.mode | (stat.type === 'directory' ? 16384 : stat.type === 'symlink' ? 40960 : 32768), nlink: stat.nlink ?? 1, uid: stat.uid ?? 0, gid: stat.gid ?? 0, rdev: 0, size: stat.size, atime: new Date(stat.atimeMs), mtime: new Date(stat.mtimeMs), ctime: new Date(stat.ctimeMs), blksize: 4096, blocks: Math.ceil(stat.size / 512) };
}
function node(parent, name, stat) {
  const value = FS.createNode(parent, name, attr(stat).mode, 0);
  value.node_ops = nodeOps; value.stream_ops = streamOps;
  return value;
}
let bootstrapMountNode;
const nodeOps = {
  getattr: n => attr(rpc('lstat', path(n))),
  setattr(n, attributes) {
    if (attributes.size !== undefined) rpc('truncate', path(n), attributes.size);
    if (attributes.mode !== undefined) rpc('chmod', path(n), attributes.mode & 4095);
    if (attributes.atime !== undefined || attributes.mtime !== undefined) {
      const previous = attributes.atime === undefined || attributes.mtime === undefined ? rpc('stat', path(n)) : undefined;
      rpc('utimes', path(n), attributes.atime ?? previous.atimeMs, attributes.mtime ?? previous.mtimeMs);
    }
  },
  lookup(parent, name) {
    if (rootMount && parent.parent === parent && name === '.pyodide-runtime') return bootstrapMountNode ??= node(parent, name, rpc('lstat', '/.pyodide-runtime'));
    return node(parent, name, rpc('lstat', `${path(parent)}/${name}`));
  },
  mknod(parent, name, mode) {
    const target = `${path(parent)}/${name}`;
    if (FS.isDir(mode)) rpc('mkdir', target, { mode: mode & 4095 });
    else rpc('writeFile', target, [], { flag: 'wx', mode: mode & 4095 });
    return node(parent, name, rpc('lstat', target));
  },
  rename(n, parent, name) { rpc('rename', path(n), `${path(parent)}/${name}`); n.name = name; n.parent = parent; },
  unlink: (parent, name) => rpc('rm', `${path(parent)}/${name}`),
  rmdir: (parent, name) => rpc('rmdir', `${path(parent)}/${name}`),
  readdir: n => ['.', '..', ...rpc('readdir', path(n)).map(entry => entry.name)],
  readlink: n => rpc('readlink', path(n)),
  symlink(parent, name, target) { rpc('symlink', target, `${path(parent)}/${name}`); return node(parent, name, rpc('lstat', `${path(parent)}/${name}`)); },
};
const streamOps = {
  getattr: stream => attr(stream.handle ? rpc('fstat', stream.handle) : rpc('stat', path(stream.node))),
  setattr(stream, attributes) {
    if (attributes.size !== undefined) rpc('ftruncate', stream.handle, attributes.size);
    if (attributes.mode !== undefined) throw new FS.ErrnoError(138);
  },
  open(stream) {
    if (FS.isDir(stream.node.mode)) return;
    stream.retained = { references: 1 };
    stream.handle = rpc('open', path(stream.node), { access: (stream.flags & 3) === 0 ? 'read' : (stream.flags & 3) === 1 ? 'write' : 'readwrite', creation: 'never', append: Boolean(stream.flags & 1024) });
  },
  dup: stream => { if (stream.retained) stream.retained.references++; },
  close: stream => { if (stream.handle && --stream.retained.references === 0) rpc('close', stream.handle); },
  fsync: stream => { rpc('sync', stream.handle, false); return 0; },
  read(stream, buffer, offset, length, position) { const data = rpc('read', stream.handle, Math.min(length, 65536), position); buffer.set(data, offset); return data.length; },
  write: (stream, buffer, offset, length, position) => rpc('write', stream.handle, [...buffer.subarray(offset, offset + Math.min(length, 65536))], stream.flags & 1024 ? null : position),
  llseek(stream, offset, whence) { const position = whence === 0 ? offset : whence === 1 ? stream.position + offset : rpc('fstat', stream.handle).size + offset; if (position < 0) throw new FS.ErrnoError(28); return position; },
};
const originalLookupNode = FS.lookupNode.bind(FS);
FS.lookupNode = (parent, name) => {
  const cached = originalLookupNode(parent, name);
  return parent.node_ops === nodeOps && !cached.mounted ? nodeOps.lookup(parent, name) : cached;
};
if (rootMount) {
  const bootstrapRoot = FS.root;
  FS.root = null;
  FS.mount({ mount: () => node(null, '/', rpc('stat', '/')) }, {}, '/');
  FS.mount({ mount: () => bootstrapRoot }, {}, '/.pyodide-runtime');
  FS.chdir('/work');
  pyodide.runPython("import sys; sys.path[:] = ['/.pyodide-runtime' + p if p.startswith('/lib') else p for p in sys.path]");
} else {
  FS.mkdir('/work');
  FS.mount({ mount: () => node(null, '/', rpc('stat', '/work')) }, {}, '/work');
}
FS.chdir('/work');
// Experimental pinned-runtime interception: preserve canonical atomic open.
// Routing is deliberately limited to the proof mount, not production root coverage.
const originalOpen = FS.open.bind(FS);
FS.open = function (inputPath, flags, mode = 438) {
  if (typeof inputPath !== 'string') return originalOpen(inputPath, flags, mode);
  const absolute = inputPath.startsWith('/') ? inputPath : `${FS.cwd()}/${inputPath}`;
  if (rootMount ? absolute.startsWith('/.pyodide-runtime/') : !(absolute === '/work' || absolute.startsWith('/work/'))) return originalOpen(inputPath, flags, mode);
  if (typeof flags !== 'number') return originalOpen(inputPath, flags, mode);
  if (flags & synchronizationFlags) throw new FS.ErrnoError(errno.ENOTSUP);
  // Atomic exclusive creation already refuses symlinks and all existing entries.
  const exclusive = (flags & 192) === 192;
  if ((flags & 131072) && !exclusive) throw new FS.ErrnoError(138);
  if (!exclusive) try {
    const targetStat = rpc('stat', absolute);
    if (targetStat.type === 'directory') return originalOpen(inputPath, flags, mode);
  } catch (error) { if (error.errno !== 44) throw error; }
  if (flags & 65536) throw new FS.ErrnoError(54);
  const handle = rpc('open', absolute, {
    access: (flags & 3) === 0 ? 'read' : (flags & 3) === 1 ? 'write' : 'readwrite',
    creation: flags & 64 ? flags & 128 ? 'exclusive' : 'ifMissing' : 'never',
    truncate: Boolean(flags & 512), append: Boolean(flags & 1024), mode,
  });
  try {
    const lookup = FS.lookupPath(inputPath, { follow: true });
    return FS.createStream({ node: lookup.node, path: absolute, flags: flags & ~(128 | 512), seekable: true, position: 0, stream_ops: streamOps, ungotten: [], error: false, handle, retained: { references: 1 } });
  } catch (error) { rpc('close', handle); throw error; }
};

pyodide.runPython(workerData.script ?? "import runpy; runpy.run_path('/work/ordinary.py', run_name='__main__')");
parentPort.postMessage({ op: 'done', version: pyodide.version, python: pyodide.runPython('__import__("sys").version'), assertions: ['open','pathlib','os','zipfile','seek/tell','tempfile','imports','read-after-write','retained-after-rename'] });
