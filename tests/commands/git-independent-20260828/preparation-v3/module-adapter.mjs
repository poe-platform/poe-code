import assert from 'node:assert/strict';
import { posix } from 'node:path';
import vm from 'node:vm';
import { authorizeThenLoad, sha256, requireReady } from './binding.mjs';
import { authenticateFixture } from './fixture-data.mjs';

export async function loadClosedModule(packet, files) {
  requireReady(typeof vm.SourceTextModule === 'function', 'future bound Node needs --experimental-vm-modules');
  const context = vm.createContext({ Uint8Array, Buffer, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, URL, setTimeout, clearTimeout });
  const modules = new Map();
  for (const [path, edges] of Object.entries(packet.imports)) {
    const module = new vm.SourceTextModule(files.get(path).toString('utf8'), {
      context, identifier: path,
      importModuleDynamically() { throw new Error('dynamic imports not admitted'); },
    });
    assert.deepEqual([...module.dependencySpecifiers].sort(), [...new Set(edges.map(edge => edge.specifier))].sort(), `exact imports ${path}`);
    assert.equal(edges.length, new Set(edges.map(edge => edge.specifier)).size, 'duplicate edge');
    modules.set(path, module);
  }
  for (const name of packet.builtins) {
    const namespace = await import(name);
    modules.set(name, new vm.SyntheticModule(Object.keys(namespace), function () {
      for (const key of Object.keys(namespace)) this.setExport(key, namespace[key]);
    }, { context, identifier: name }));
  }
  const entry = modules.get(packet.entry);
  await entry.link((specifier, parent) => {
    const edge = packet.imports[parent.identifier]?.find(item => item.specifier === specifier);
    requireReady(edge && modules.has(edge.to), `unapproved import ${specifier}`);
    return modules.get(edge.to);
  });
  await entry.evaluate({ timeout: 2000 });
  return entry.namespace;
}
export function makeFixtureVfs(records) {
  const entries = new Map(records.files.map(file => [`/repo/${file.path}`, { ...file, data: Buffer.from(file.base64, 'base64') }]));
  for (const directory of records.directories) entries.set(`/repo/${directory.path}`, { ...directory });
  entries.set('/', { type: 'directory', mode: 0o755 });
  entries.set('/repo', { type: 'directory', mode: 0o755 });
  const calls = [], mutations = [];
  const fail = (code, path) => { const error = new Error(`${code}: ${path}`); error.code = code; error.path = path; throw error; };
  const lookup = (path, options) => {
    options?.signal?.throwIfAborted();
    assert.equal(typeof path, 'string');
    const normalized = posix.normalize(path);
    assert.ok(normalized === '/' || normalized === '/repo' || normalized.startsWith('/repo/'), 'no outside VFS access');
    calls.push(normalized);
    return entries.get(normalized) ?? fail('ENOENT', normalized);
  };
  const fs = {
    capabilities: { readOnly: true, symlinks: false, hardlinks: false, permissions: true, timestamps: true, streamingRead: true },
    async readFile(path, options) {
      const file = lookup(path, options);
      if (file.type !== 'file') fail('EISDIR', path);
      if (options?.maxBytes !== undefined && file.data.length > options.maxBytes) fail('EFBIG', path);
      return Buffer.from(file.data);
    },
    async stat(path, options) {
      const entry = lookup(path, options);
      return { type: entry.type, mode: entry.mode, size: entry.data?.length ?? 0, mtimeMs: 946684800000, atimeMs: 946684800000, ctimeMs: 946684800000 };
    },
    async lstat(path, options) { return fs.stat(path, options); },
    async readdir(path, options) {
      const entry = lookup(path, options);
      if (entry.type !== 'directory') fail('ENOTDIR', path);
      return [...entries].filter(([name]) => name !== '/' && posix.dirname(name) === posix.normalize(path)).map(([name, item]) => ({ name: posix.basename(name), type: item.type }));
    },
    async realpath(path, options) { lookup(path, options); return posix.normalize(path); },
    async access(path, mode = 0, options) { lookup(path, options); if (mode & 2) fail('EROFS', path); },
    async readlink(path, options) { lookup(path, options); fail('EINVAL', path); },
    async *readStream(path, options) {
      const bytes = await fs.readFile(path, options);
      const end = Math.min(bytes.length, options?.endExclusive ?? bytes.length);
      const width = options?.chunkSize ?? 17;
      assert.ok(Number.isSafeInteger(width) && width > 0);
      for (let offset = options?.start ?? 0; offset < end; offset += width) {
        options?.signal?.throwIfAborted();
        yield Buffer.from(bytes.subarray(offset, Math.min(offset + width, end)));
      }
    },
  };
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'symlink', 'link', 'chmod', 'utimes', 'truncate', 'writeStream']) fs[name] = async (...args) => { mutations.push({ name, args }); fail('EROFS', args[0]); };
  return { fs, calls, mutations, snapshot: () => [...entries].filter(([path]) => path !== '/' && path !== '/repo').map(([path, file]) => ({ path: path.slice(6), type: file.type, mode: file.mode, ...(file.type === 'file' ? { bytes: file.data.length, sha256: sha256(file.data) } : {}) })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) };
}
export function compareObservation(row, actual, tree) {
  assert.equal(actual.exitCode, row.exitCode, `${row.id} status`);
  assert.deepEqual(Buffer.from(actual.stdout), Buffer.from(row.stdoutBase64, 'base64'), `${row.id} stdout bytes`);
  assert.deepEqual(Buffer.from(actual.stderr), Buffer.from(row.stderrBase64, 'base64'), `${row.id} stderr bytes`);
  assert.deepEqual(actual.tree, tree, `${row.id} complete namespace/content/mode effects`);
  assert.deepEqual(actual.cwd, row.cwd, `${row.id} cwd`);
  assert.deepEqual(actual.env, row.env, `${row.id} env`);
}
export async function exerciseSix(namespace, records) {
  const family = namespace.createGitCommands();
  assert.equal(Array.isArray(family), true);
  assert.deepEqual(Array.from(family, command => command.name), ['git']);
  const registered = [];
  const plugin = namespace.gitCommands();
  assert.equal(typeof plugin.name, 'string');
  await plugin.setup({ commands: { register(command) { registered.push(command); return this; } }, use() { throw new Error('unexpected middleware'); }, registerFileSystem() { throw new Error('unexpected filesystem'); } });
  assert.deepEqual(registered.map(command => command.name), ['git']);
  const observations = [];
  try {
    for (const row of records.workflows) {
      const fixture = makeFixtureVfs(records), cleanup = [], stdout = [], stderr = [];
      let outputBytes = 0, stdinReads = 0, invocations = 0;
      const sink = list => ({ async write(chunk) {
        assert.ok(chunk instanceof Uint8Array);
        outputBytes += chunk.byteLength;
        assert.ok(outputBytes <= 65536, 'combined output cap');
        list.push(Buffer.from(chunk));
      } });
      const context = {
        command: 'git', args: [...row.args], cwd: row.cwd, env: {}, fs: fixture.fs,
        signal: new AbortController().signal, stdout: sink(stdout), stderr: sink(stderr), stdinIsDefault: true,
        stdin: { [Symbol.asyncIterator]() { stdinReads++; throw new Error('Git must not read stdin'); } },
        invoke() { invocations++; throw new Error('Git must not invoke other commands'); },
        registerCleanup(callback) { cleanup.push(callback); },
      };
      let result, primary, failed = false;
      const command = namespace.createGitCommand();
      assert.equal(command.name, 'git');
      try { result = await command.execute(context); } catch (error) { primary = error; failed = true; }
      const cleanupResults = await Promise.allSettled(cleanup.map(callback => Promise.resolve().then(callback)));
      if (failed) throw primary;
      const rejected = cleanupResults.find(item => item.status === 'rejected');
      if (rejected) throw rejected.reason;
      assert.equal(stdinReads, 0); assert.equal(invocations, 0); assert.deepEqual(fixture.mutations, []);
      const actual = { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), tree: fixture.snapshot(), cwd: context.cwd, env: context.env };
      compareObservation(row, actual, records.tree);
      observations.push({ id: row.id, exitCode: actual.exitCode, stdoutBase64: actual.stdout.toString('base64'), stderrBase64: actual.stderr.toString('base64'), treeSha256: sha256(JSON.stringify(actual.tree)), vfsReads: fixture.calls.length });
    }
  } finally { await plugin.dispose?.(); }
  return observations;
}
export async function runCandidate(packetBytes, go, files, preparationSha256, records) {
  authenticateFixture(records);
  const { namespace } = await authorizeThenLoad(packetBytes, go, files, preparationSha256, loadClosedModule);
  return exerciseSix(namespace, records);
}
