import { FsError } from '../../contracts/errors.js';
import type { FileStat, FileSystem, FsOptions, ConditionalRemoveEntryOptions } from '../../contracts/filesystem.js';
import { collectBytes } from '../../contracts/io.js';
import { dirname, normalizePath, validatePath } from '../../contracts/virtual-path.js';
import { withObjectFileDescriptors, type ObjectFileVersion, type ObjectFileDescriptorOptions } from '../object-publication/index.js';
import type { S3Transport } from './transport.js';

export interface S3NamespaceOptions extends ObjectFileDescriptorOptions {
  readonly client: S3Transport;
  readonly bucket: string;
  readonly key: string;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly maxManifestBytes?: number;
  readonly maxAttempts?: number;
}

interface NamespaceNode {
  ino: number;
  revision: number;
  type: 'file' | 'directory';
  mode: number;
  time: number;
  bytes: number[];
}

interface Namespace {
  version: 1;
  identity: string;
  nextInode: number;
  nodes: Record<string, NamespaceNode>;
}

function limit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid S3 namespace limit');
  return value;
}

export async function createS3NamespaceFileSystem(options: S3NamespaceOptions): Promise<FileSystem> {
  const client = options.client;
  if (client?.capabilities?.conditionalPut !== true || client.capabilities.streamingRead !== true || !client.getObjectStream) throw new FsError('ENOTSUP', { message: 'S3 namespaces require verified conditional PUT and bounded streaming reads' });
  if (![options.bucket, options.key].every(value => typeof value === 'string' && value.length > 0 && !value.includes('\0'))) throw new TypeError('An explicit S3 bucket and manifest key are required');
  const maxBytes = limit(options.maxBytes ?? 1048576, 67108864);
  const maxEntries = limit(options.maxEntries ?? 1024, 65536);
  const maxManifestBytes = limit(options.maxManifestBytes ?? 8388608, 268435456);
  const maxAttempts = limit(options.maxAttempts ?? 8, 64);
  const descriptorOptions = { ...options, maxFileBytes: options.maxFileBytes ?? maxBytes, maxOpenFiles: options.maxOpenFiles ?? 16 };
  for (const key of ['chunkBytes', 'maxStagedBytes', 'maxStagedPages', 'maxFileBytes', 'maxOpenFiles'] as const) {
    if (descriptorOptions[key] !== undefined) limit(descriptorOptions[key], key === 'chunkBytes' ? 1048576 : Number.MAX_SAFE_INTEGER);
  }
  const object = Object.freeze({ Bucket: options.bucket, Key: options.key });
  const scope = Object.freeze({});
  let identity: string | undefined;
  const path = (value: string) => {
    validatePath(value);
    if (!value) throw new FsError('ENOENT');
    if (value.length > 4096) throw new FsError('ENAMETOOLONG');
    return normalizePath(value);
  };
  const entryPath = (value: string) => {
    const name = path(value);
    const terminal = value.split('/').filter(Boolean).at(-1);
    if (terminal === '.' || terminal === '..') throw new FsError('EINVAL');
    return name;
  };
  const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const validate = (value: any): Namespace => {
    if (!value || value.version !== 1 || typeof value.identity !== 'string' || value.identity.length < 1 || value.identity.length > 128
      || Object.keys(value).length !== 4 || !Object.keys(value).every(key => ['version', 'identity', 'nextInode', 'nodes'].includes(key))
      || identity !== undefined && value.identity !== identity || !Number.isSafeInteger(value.nextInode) || value.nextInode < 2
      || !value.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes)) throw new FsError('EIO', { message: 'Invalid or replaced S3 namespace' });
    const entries = Object.entries(value.nodes) as [string, NamespaceNode][];
    if (entries.length > maxEntries) throw new FsError('ENOSPC');
    const inodes = new Set<number>();
    let size = 0;
    for (const [name, node] of entries) {
      if (path(name) !== name || !node || !['file', 'directory'].includes(node.type) || !Array.isArray(node.bytes)
        || Object.keys(node).length !== 6 || !Object.keys(node).every(key => ['ino', 'revision', 'type', 'mode', 'time', 'bytes'].includes(key))
        || !Number.isSafeInteger(node.ino) || node.ino < 1 || node.ino >= value.nextInode || inodes.has(node.ino)
        || !Number.isSafeInteger(node.revision) || node.revision < 1 || !Number.isSafeInteger(node.mode) || node.mode < 0 || node.mode > 0o7777
        || !Number.isFinite(node.time) || node.type === 'directory' && node.bytes.length !== 0) throw new FsError('EIO', { message: 'Invalid S3 namespace entry' });
      inodes.add(node.ino);
      size += node.bytes.length;
      if (size > maxBytes) throw new FsError('ENOSPC');
      if (node.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new FsError('EIO');
      if (name !== '/' && value.nodes[dirname(name)]?.type !== 'directory') throw new FsError('EIO', { message: 'Disconnected S3 namespace entry' });
    }
    if (value.nodes['/']?.type !== 'directory' || value.nodes['/'].ino !== 1) throw new FsError('EIO');
    return value as Namespace;
  };
  const read = async (forwarded: FsOptions = {}) => {
    forwarded.signal?.throwIfAborted();
    try {
      const response = await client.getObjectStream!(object, forwarded.signal ? { abortSignal: forwarded.signal } : {});
      const body = await collectBytes(response.Body, { ...forwarded, maxBytes: maxManifestBytes });
      if (typeof response.ETag !== 'string' || !response.ETag || response.ETag.startsWith('W/')) throw new FsError('EIO', { message: 'S3 namespace requires a strong object validator' });
      let decoded;
      try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
      catch { throw new FsError('EIO', { message: 'Invalid S3 namespace encoding' }); }
      return { value: validate(decoded), etag: response.ETag };
    } catch (error) {
      forwarded.signal?.throwIfAborted();
      if (error instanceof FsError || status(error) === 404 && identity === undefined) throw error;
      throw new FsError('EIO', { message: 'S3 namespace read failed' });
    }
  };
  const commit = async (value: Namespace, etag: string | undefined, forwarded: FsOptions) => {
    validate(value);
    let encodedBound = 256 + value.identity.length * 6;
    for (const [name, node] of Object.entries(value.nodes)) encodedBound += 256 + name.length * 6 + node.bytes.length * 4;
    if (encodedBound > maxManifestBytes) throw new FsError('EFBIG');
    const body = new TextEncoder().encode(JSON.stringify(value));
    if (body.length > maxManifestBytes) throw new FsError('EFBIG');
    forwarded.signal?.throwIfAborted();
    try {
      await client.putObject({ ...object, Body: body, ...(etag === undefined ? { IfNoneMatch: '*' as const } : { IfMatch: etag }) }, forwarded.signal ? { abortSignal: forwarded.signal } : {});
      forwarded.signal?.throwIfAborted();
      return true;
    } catch (error) {
      forwarded.signal?.throwIfAborted();
      if (status(error) === 412 || status(error) === 409) return false;
      throw new FsError('EIO', { message: 'S3 namespace commit could not be confirmed' });
    }
  };
  for (let attempt = 0; identity === undefined && attempt < maxAttempts; attempt++) {
    try { identity = (await read()).value.identity; }
    catch (error) {
      if (status(error) !== 404) throw error;
      const initial: Namespace = { version: 1, identity: crypto.randomUUID(), nextInode: 2, nodes: {
        '/': { ino: 1, revision: 1, type: 'directory', mode: 0o755, time: Date.now(), bytes: [] },
      } };
      if (await commit(initial, undefined, {})) identity = initial.identity;
    }
  }
  if (identity === undefined) throw new FsError('EAGAIN');
  const mutate = async <Value>(forwarded: FsOptions, action: (value: Namespace) => Value): Promise<Value> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const current = await read(forwarded);
      const result = action(current.value);
      if (await commit(current.value, current.etag, forwarded)) return result;
    }
    throw new FsError('EAGAIN', { message: 'S3 namespace conditional retry limit exceeded' });
  };
  const entry = (value: Namespace, name: string) => {
    const node = value.nodes[name];
    if (!node) throw new FsError('ENOENT', { path: name });
    return node;
  };
  const directory = (value: Namespace, name: string) => {
    const node = entry(value, name);
    if (node.type !== 'directory') throw new FsError('ENOTDIR', { path: name });
    return node;
  };
  const stat = (node: NamespaceNode): FileStat => Object.freeze({ type: node.type, size: node.bytes.length,
    mode: (node.type === 'file' ? 0o100000 : 0o040000) | node.mode, mtimeMs: node.time, atimeMs: node.time, ctimeMs: node.time,
    identityScope: scope, ino: node.ino, revision: node.revision });
  const create = (value: Namespace, name: string, type: NamespaceNode['type'], mode: number) => {
    directory(value, dirname(name));
    if (value.nodes[name]) throw new FsError('EEXIST', { path: name });
    if (Object.keys(value.nodes).length >= maxEntries || !Number.isSafeInteger(value.nextInode + 1)) throw new FsError('ENOSPC');
    const node = { ino: value.nextInode++, revision: 1, type, mode, time: Date.now(), bytes: [] };
    value.nodes[name] = node;
    return node;
  };
  const resolveName = (value: Namespace, input: string, allowMissing = false, newDirectory = false, parentMode?: number) => {
    path(input);
    const components = input.split('/').filter(Boolean);
    let current = '/';
    for (let index = 0; index < components.length; index++) {
      directory(value, current);
      const component = components[index]!;
      if (component === '.') continue;
      if (component === '..') { current = dirname(current); continue; }
      current = (current === '/' ? '' : current) + '/' + component;
      if (!value.nodes[current]) {
        if (index + 1 < components.length && parentMode !== undefined) create(value, current, 'directory', parentMode);
        else if (index + 1 < components.length || !allowMissing) throw new FsError('ENOENT', { path: current });
      }
    }
    if (input.endsWith('/')) {
      if (value.nodes[current]) directory(value, current);
      else if (!newDirectory) throw new FsError('ENOTDIR');
    }
    return current;
  };
  const write = (value: Namespace, name: string, data: Uint8Array, exclusive = false, mode = 0o644, append = false) => {
    let node = value.nodes[name];
    if (node && exclusive) throw new FsError('EEXIST', { path: name });
    node ??= create(value, name, 'file', mode);
    if (node.type !== 'file') throw new FsError('EISDIR', { path: name });
    const otherBytes = Object.values(value.nodes).reduce((size, current) => size + (current === node ? 0 : current.bytes.length), 0);
    if (data.length + (append ? node.bytes.length : 0) > maxBytes - otherBytes) throw new FsError('ENOSPC');
    node.bytes = append ? [...node.bytes, ...data] : Array.from(data);
    node.revision++;
    node.time = Date.now();
    return node;
  };
  const remove = (value: Namespace, name: string, recursive: boolean, required?: NamespaceNode['type']) => {
    if (name === '/') throw new FsError('EBUSY');
    const node = entry(value, name);
    if (required && node.type !== required) throw new FsError(required === 'file' ? 'EISDIR' : 'ENOTDIR');
    const children = Object.keys(value.nodes).filter(candidate => candidate.startsWith(name + '/'));
    if (children.length && !recursive) throw new FsError('ENOTEMPTY');
    for (const child of children) delete value.nodes[child];
    delete value.nodes[name];
  };
  const conditionalRemove = (input: string, forwarded: ConditionalRemoveEntryOptions, recursive: boolean) => mutate(forwarded, value => {
    const name = resolveName(value, input);
    const node = entry(value, name);
    const parent = directory(value, dirname(name));
    if (forwarded.expected?.identityScope !== scope || forwarded.parent.identityScope !== scope
      || ![forwarded.expected.ino, forwarded.parent.ino].every(Number.isSafeInteger)
      || !recursive && !Number.isSafeInteger(forwarded.expected.revision)) throw new FsError('ENOTSUP');
    if (forwarded.expected.ino !== node.ino || forwarded.expected.type !== node.type
      || forwarded.parent.ino !== parent.ino || forwarded.parent.type !== 'directory'
      || !recursive && (forwarded.expected.revision !== node.revision || forwarded.expected.size !== node.bytes.length
        || forwarded.expected.mode !== stat(node).mode || forwarded.expected.mtimeMs !== node.time || forwarded.expected.ctimeMs !== node.time)) throw new FsError('EAGAIN');
    remove(value, name, recursive, recursive ? 'directory' : undefined);
  });
  const observe = async (input: string, forwarded: FsOptions = {}) => {
    const { value } = await read(forwarded);
    return stat(entry(value, resolveName(value, input)));
  };
  const filesystem: FileSystem = {
    capabilities: Object.freeze({ read: true, write: true, append: true, stat: true, readdir: true, realpath: true, access: true,
      mkdir: true, recursiveMkdir: true, explicitDirectories: true, implicitDirectories: false, exclusiveCreate: true,
      remove: true, removeDirectory: true, recursiveRemove: true, atomicTreeRemoval: true, atomicEntryRemoval: true,
      rename: true, atomicRename: true, atomicRenameNoReplace: true, copy: true, exclusiveCopy: true,
      readOnly: false, symlinks: false, hardlinks: false, permissions: false, timestamps: false }),
    stat: observe,
    lstat: observe,
    async readFile(input, forwarded = {}) {
      const { value } = await read(forwarded);
      const node = entry(value, resolveName(value, input));
      if (node.type !== 'file') throw new FsError('EISDIR');
      if (forwarded.maxBytes !== undefined && node.bytes.length > forwarded.maxBytes) throw new FsError('EFBIG');
      return Uint8Array.from(node.bytes);
    },
    async writeFile(input, data, forwarded = {}) {
      if (!(data instanceof Uint8Array)) throw new FsError('EINVAL');
      if (data.length > maxBytes) throw new FsError('ENOSPC');
      const flag = forwarded.flag ?? 'w';
      if (!['w', 'wx', 'a', 'ax'].includes(flag)) throw new FsError('EINVAL');
      const owned = Uint8Array.from(data);
      await mutate(forwarded, value => write(value, resolveName(value, input, true), owned, flag === 'wx' || flag === 'ax', forwarded.mode, flag === 'a' || flag === 'ax'));
    },
    async appendFile(input, data, forwarded = {}) {
      if (!(data instanceof Uint8Array)) throw new FsError('EINVAL');
      if (data.length > maxBytes) throw new FsError('ENOSPC');
      const owned = Uint8Array.from(data);
      await mutate(forwarded, value => write(value, resolveName(value, input, true), owned, false, forwarded.mode, true));
    },
    async readdir(input, forwarded = {}) {
      const { value } = await read(forwarded);
      const name = resolveName(value, input);
      directory(value, name);
      const entries = Object.entries(value.nodes).filter(([candidate]) => candidate !== '/' && dirname(candidate) === name);
      if (forwarded.maxEntries !== undefined && entries.length > forwarded.maxEntries) throw new FsError('EFBIG');
      return entries.map(([candidate, node]) => ({ name: candidate.slice(candidate.lastIndexOf('/') + 1), type: node.type }));
    },
    async mkdir(input, forwarded = {}) {
      await mutate(forwarded, value => {
        const name = resolveName(value, input, true, true, forwarded.recursive ? forwarded.mode ?? 0o755 : undefined);
        if (forwarded.recursive && value.nodes[name]) directory(value, name);
        else create(value, name, 'directory', forwarded.mode ?? 0o755);
      });
    },
    async rm(input, forwarded = {}) {
      entryPath(input);
      await mutate(forwarded, value => {
        const name = resolveName(value, input, forwarded.force === true, true);
        if (!value.nodes[name] && forwarded.force) return;
        remove(value, name, forwarded.recursive === true);
      });
    },
    async unlink(input, forwarded = {}) { entryPath(input); await mutate(forwarded, value => remove(value, resolveName(value, input), false, 'file')); },
    async rmdir(input, forwarded = {}) { entryPath(input); await mutate(forwarded, value => remove(value, resolveName(value, input), false, 'directory')); },
    async removeTreeConditional(input, forwarded) { entryPath(input); return conditionalRemove(input, forwarded, true); },
    async removeEntryConditional(input, forwarded) { entryPath(input); return conditionalRemove(input, forwarded, false); },
    async rename(source, destination, forwarded = {}) {
      entryPath(source); entryPath(destination);
      await mutate(forwarded, value => {
        const from = resolveName(value, source);
        const node = entry(value, from);
        const to = resolveName(value, destination, true, node.type === 'directory');
        if (from === to) return;
        if (from === '/' || to === '/') throw new FsError('EBUSY');
        if (to.startsWith(from + '/')) throw new FsError('EINVAL');
        directory(value, dirname(to));
        if (value.nodes[to]) {
          if (forwarded.noReplace) throw new FsError('EEXIST');
          remove(value, to, false, node.type);
        }
        for (const name of Object.keys(value.nodes).filter(name => name === from || name.startsWith(from + '/'))) {
          value.nodes[to + name.slice(from.length)] = value.nodes[name]!;
          delete value.nodes[name];
        }
      });
    },
    async copyFile(source, destination, forwarded = {}) {
      await mutate(forwarded, value => {
        const from = resolveName(value, source), to = resolveName(value, destination, true);
        const node = entry(value, from);
        if (node.type !== 'file') throw new FsError('EISDIR');
        if (from === to) throw new FsError('EINVAL');
        write(value, to, Uint8Array.from(node.bytes), forwarded.exclusive, node.mode);
      });
    },
    async realpath(input, forwarded = {}) { return resolveName((await read(forwarded)).value, input); },
    async access(input, mode = 0, forwarded = {}) {
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) throw new FsError('EINVAL');
      resolveName((await read(forwarded)).value, input);
    },
  };
  const version = (node: NamespaceNode): ObjectFileVersion => {
    const bytes = Uint8Array.from(node.bytes);
    let closed = false;
    return { revision: node.ino + ':' + node.revision, stat: stat(node),
      async read(position, maxLength, forwarded = {}) {
        forwarded.signal?.throwIfAborted();
        if (closed) throw new FsError('EBADF');
        return bytes.slice(position, position + maxLength);
      },
      async close() { closed = true; },
    };
  };
  return withObjectFileDescriptors(filesystem, {
    async acquire(input, forwarded) {
      const { value } = await read(forwarded);
      const node = value.nodes[resolveName(value, input, true)];
      if (!node) return undefined;
      if (node.type !== 'file') throw new FsError('EISDIR');
      return version(node);
    },
    async publish(input, expectedRevision, source, forwarded) {
      const bytes = await collectBytes(source, { ...forwarded, maxBytes });
      if (bytes.length !== forwarded.size) throw new FsError('EIO');
      const published = await mutate(forwarded, value => {
        const name = resolveName(value, input, true), node = value.nodes[name];
        if (expectedRevision === null ? node !== undefined : !node || node.ino + ':' + node.revision !== expectedRevision) throw new FsError('EAGAIN');
        return write(value, name, bytes, false, forwarded.mode);
      });
      return version(published);
    },
  }, descriptorOptions);
}
