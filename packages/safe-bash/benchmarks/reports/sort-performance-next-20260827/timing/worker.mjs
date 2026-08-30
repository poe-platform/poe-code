import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [packagePath, manifestPath, mode] = process.argv.slice(2);
const packageRoot = realpathSync(packagePath);
const packageURL = pathToFileURL(packageRoot + '/').href;
const manifest = JSON.parse(readFileSync(manifestPath));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const loads = new Map();
const inventory = () => {
  const rows = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      assert.ok(!entry.isSymbolicLink());
      if (entry.isDirectory()) walk(child);
      else rows.push({ path: relative(packageRoot, child), bytes: readFileSync(child).length, sha256: hash(readFileSync(child)) });
    }
  };
  walk(packageRoot);
  return rows;
};
assert.deepEqual(inventory(), manifest);
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    assert.ok(result.url.startsWith('node:') || result.url.startsWith(packageURL), result.url);
    return result;
  },
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith('node:')) {
      const path = fileURLToPath(url);
      assert.ok(realpathSync(path).startsWith(packageRoot + '/'));
      const name = relative(packageRoot, path);
      const expected = manifest.find(file => file.path === name);
      assert.ok(expected, name);
      const diskHash = hash(readFileSync(path));
      assert.equal(diskHash, expected.sha256);
      assert.equal(hash(result.source), diskHash);
      loads.set(name, { path: name, diskSha256: diskHash, loadedSourceSha256: hash(result.source) });
    }
    return result;
  },
});
const importStart = mode === 'cold' ? process.hrtime.bigint() : undefined;
const library = await import('virtual-bash');
const importMs = mode === 'cold' ? Number(process.hrtime.bigint() - importStart) / 1e6 : undefined;
assert.ok(loads.has('dist/index.js'));
assert.ok(loads.has('dist/commands/text.js'));
let previous;
process.send({ type: 'ready', pid: process.pid, node: process.version, packageRoot, publicImport: 'virtual-bash', modules: [...loads.values()], ...(mode === 'cold' ? { importMs } : {}) });
process.on('message', async message => {
  try {
    if (message.type === 'close') {
      assert.deepEqual(inventory(), manifest);
      process.send({ type: 'closed', packageUnchanged: true, detectsAddedEntries: true, modules: [...loads.values()] }, () => process.disconnect());
      return;
    }
    const { specimen, measured } = message;
    const fs = new library.MemoryFileSystem();
    await fs.mkdir('/work', { recursive: true });
    const input = Buffer.from(specimen.input, 'base64');
    await fs.writeFile('/work/input', input);
    let producerClosed = 0;
    if (specimen.borrowed) {
      const readStream = fs.readStream.bind(fs);
      fs.readStream = (path, options) => path !== '/work/input' ? readStream(path, options) : (async function* () {
        const backing = Buffer.alloc(12, 255);
        const view = backing.subarray(4, 6);
        try {
          for (let offset = 0; offset < input.length; offset += 2) { view.set(input.subarray(offset, offset + 2)); yield view; }
        } finally { backing.fill(0); producerClosed++; }
      })();
    }
    const shell = new library.Shell({ fs, cwd: '/work', env: { LC_ALL: 'C', TZ: 'UTC', HOME: '/home/agent', PATH: '/bin:/usr/bin', TMPDIR: '/tmp' }, limits: { maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.standardCommands());
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(new Error('frozen 5s command watchdog')), 5000);
    let result;
    let elapsedMs;
    try {
      const start = measured ? process.hrtime.bigint() : undefined;
      result = await shell.exec(specimen.script, { stdin: new Uint8Array(), signal: controller.signal });
      if (measured) elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    } finally { clearTimeout(watchdog); await shell.dispose(); }
    const files = {};
    for (const entry of await fs.readdir('/work')) files[entry.name] = Buffer.from(await fs.readFile('/work/' + entry.name)).toString('base64');
    const observation = { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, files };
    assert.deepEqual(observation, specimen.expected);
    if (specimen.borrowed) assert.equal(producerClosed, 1);
    if (previous) assert.equal(hash(previous.bytes), previous.sha256);
    previous = { bytes: result.stdoutBytes, sha256: hash(result.stdoutBytes) };
    process.send({ type: 'result', id: specimen.id, passed: true, status: result.exitCode, stdoutBytes: result.stdoutBytes.length, observationSha256: hash(JSON.stringify(observation)), producerClosed, ...(measured ? { elapsedMs } : {}) });
  } catch (error) { process.send({ type: 'failure', error: error.stack }, () => process.disconnect()); }
});
