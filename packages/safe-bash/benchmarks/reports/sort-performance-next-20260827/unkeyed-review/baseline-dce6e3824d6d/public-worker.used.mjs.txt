import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [packagePath, inputsPath, expectedPath, packageManifestPath] = process.argv.slice(2);
const packageRoot = realpathSync(packagePath);
const packageURL = pathToFileURL(packageRoot + '/').href;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputsBefore = [inputsPath, expectedPath, packageManifestPath].map(path => ({ path, sha256: hash(readFileSync(path)) }));
const manifest = JSON.parse(readFileSync(packageManifestPath));
const moduleLoads = new Map();
function verifyPackage() {
  for (const file of manifest) assert.equal(hash(readFileSync(packageRoot + '/' + file.path)), file.sha256, file.path);
}
verifyPackage();
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    assert.ok(result.url.startsWith('node:') || result.url.startsWith(packageURL), `non-isolated import: ${result.url}`);
    return result;
  },
  load(url, context, next) {
    if (!url.startsWith('node:')) {
      assert.ok(url.startsWith(packageURL));
      const path = fileURLToPath(url);
      assert.ok(realpathSync(path).startsWith(packageRoot + '/'));
      const relative = path.slice(packageRoot.length + 1);
      const expected = manifest.find(file => file.path === relative);
      assert.ok(expected, relative);
      const before = hash(readFileSync(path));
      assert.equal(before, expected.sha256);
      moduleLoads.set(relative, { path: relative, before });
    }
    return next(url, context);
  },
});
const library = await import('virtual-bash');
const acceptance = JSON.parse(readFileSync(inputsPath)).specimens;
const independent = JSON.parse(readFileSync(expectedPath)).specimens;
const env = { LC_ALL: 'C', HOME: '/home/agent', PATH: '/bin:/usr/bin', TMPDIR: '/tmp' };
const rows = [];
let shellsDisposed = 0;
for (const [cohort, cases] of [['acceptance21', acceptance], ['independent33', independent]]) {
  for (const specimen of cases) {
    const fs = library.createMemoryFileSystem();
    await fs.mkdir('/work', { recursive: true });
    await fs.mkdir('/tmp', { recursive: true });
    for (const [name, bytes] of Object.entries(specimen.files)) await fs.writeFile('/work/' + name, Buffer.from(bytes, 'base64'));
    const controller = new AbortController();
    const reason = Object.freeze({ independentSortCancellation: true });
    let producerClosed = 0;
    let producerPulls = 0;
    const original = fs.readStream.bind(fs);
    if (specimen.borrowed || specimen.borrowedWidth || specimen.streamEffect) {
      const input = Buffer.from(specimen.files.input, 'base64');
      fs.readStream = (path, options) => path !== '/work/input' ? original(path, options) : (async function* () {
        try {
          if (specimen.streamEffect) {
            producerPulls++;
            yield input;
            if (specimen.streamEffect === 'error') throw new Error('review injected EIO');
            controller.abort(reason);
            yield Buffer.from('0\n');
            throw new Error('pulled after cancellation');
          }
          const width = specimen.borrowedWidth ?? 2;
          const allocation = Buffer.alloc(width + 10, 255);
          const view = allocation.subarray(5, 5 + width);
          for (let offset = 0; offset < input.length; offset += width) {
            producerPulls++;
            view.set(input.subarray(offset, offset + width));
            yield specimen.borrowed ? view : view.subarray(0, Math.min(width, input.length - offset));
          }
          allocation.fill(0);
        } finally { producerClosed++; }
      })();
    }
    const shell = new library.Shell({ fs, cwd: '/work', env, limits: { maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.agentCommands());
    const timer = setTimeout(() => controller.abort(new Error('independent sort 5s watchdog')), 5000);
    let result;
    let rejection;
    try { result = await shell.exec(specimen.script, { stdin: Buffer.from(specimen.stdin, 'base64'), signal: controller.signal }); }
    catch (error) { rejection = error; }
    finally { clearTimeout(timer); await shell.dispose(); shellsDisposed++; }
    const files = {};
    for (const entry of await fs.readdir('/work')) files[entry.name] = Buffer.from(await fs.readFile('/work/' + entry.name)).toString('base64');
    const observation = result ? { stdout: Buffer.from(result.stdoutBytes).toString('base64'), stderr: Buffer.from(result.stderrBytes).toString('base64'), status: result.exitCode, files } : { files };
    let failure;
    try {
      if (specimen.rejectsReason) assert.equal(rejection, reason);
      else assert.equal(rejection, undefined);
      assert.deepEqual(observation, specimen.expected);
      if (specimen.borrowed || specimen.borrowedWidth || specimen.streamEffect) assert.equal(producerClosed, 1);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } catch (error) { failure = error.message; }
    rows.push({ id: specimen.id, cohort, passed: failure === undefined, observationHash: hash(JSON.stringify(observation)), stdoutBytes: result?.stdoutBytes.length ?? 0, status: result?.exitCode, producerClosed, producerPulls, ...(failure ? { failure, observation, expected: specimen.expected, rejection: String(rejection) } : {}) });
  }
}
verifyPackage();
for (const file of inputsBefore) assert.equal(hash(readFileSync(file.path)), file.sha256);
const modules = [...moduleLoads.values()].map(file => {
  const after = hash(readFileSync(packageRoot + '/' + file.path));
  assert.equal(after, file.before);
  return { ...file, after };
});
assert.ok(modules.some(file => file.path === 'dist/index.js'));
assert.ok(modules.some(file => file.path === 'dist/commands/text.js'));
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, packageRoot, publicImport: 'virtual-bash', rows, modules, inputsBefore, shellsDisposed, packageBeforeAfterEqual: true, allInputsBeforeAfterEqual: true, workerAssets: manifest.filter(file => /worker\.(?:js|d\.ts)$/u.test(file.path)), workerQualification: 'Asset hashes only; this sort cohort does not exercise worker execution.', completed: true }));
