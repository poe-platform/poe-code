import { loadPyodide } from 'pinned-pyodide-loader';
import createPyodideModule from 'pinned-pyodide-module';
import lockFileContents from 'pinned-pyodide-lock';
import trampoline from 'trampoline.wasm';
import nativeCall from 'native-call.wasm';
import statResult from 'stat-result.wasm';
import { withObjectFileDescriptors } from '@poe-code/safe-fs/core';
import { Shell } from 'qualified-shell';
import { createPythonJspiExecutor, pythonCommands } from 'qualified-python';
import { createR2StagingFixture } from './object-staging-workerd.fixture.mjs';

async function runQualification(url, env) {
  const size = Number(url.searchParams.get('size'));
  const chunkBytes = 65536;
  const backend = createR2StagingFixture(env.SCRATCH, {
    chunkBytes, delayed: url.searchParams.get('profile') === 'delayed', spill: url.searchParams.get('spill') !== '0',
  });
  const python = `import hashlib
block = bytes(range(256)) * 256
with open('/output', 'wb') as output:
 for index in range(${size / chunkBytes}):
  assert output.write(block) == len(block)
digest = hashlib.sha256()
with open('/output', 'rb') as source:
 while block := source.read(65536):
  digest.update(block)
print(digest.hexdigest())
`;
  await backend.fs.writeFile('/main.py', new TextEncoder().encode(python));
  const fs = withObjectFileDescriptors(backend.fs, backend.store, {
    chunkBytes, maxStagedBytes: chunkBytes, maxStagedPages: 1, maxFileBytes: size,
  });
  let initialWasmMemoryBytes;
  let retired = 0;
  const shell = new Shell({ fs, limits: { maxOutputBytes: size + chunkBytes, maxWallClockMs: 75000, maxCpuMs: 75000 } })
    .use(pythonCommands({ createExecutor() {
      const executor = createPythonJspiExecutor({ trampoline, nativeCall, statResult, async loadRuntime(configuration) {
        const runtime = await loadPyodide({ indexURL: 'https://safe-python.invalid/', lockFileContents,
          async createPyodideModule(settings) {
            const instantiate = settings.instantiateWasm;
            const module = await createPyodideModule({ ...settings, instantiateWasm(imports, receive) {
              configuration.bindImports(imports);
              return instantiate(imports, (instance, module) => {
                configuration.bindInstance(instance);
                receive(instance, module);
              });
            } });
            configuration.bindScheduler(module.API);
            return module;
          }, jsglobals: configuration.jsglobals, args: configuration.args, env: configuration.env,
          enableRunUntilComplete: false });
        initialWasmMemoryBytes = runtime._module.HEAPU8.byteLength;
        return runtime;
      } });
      return { ...executor, async terminate() { await executor.terminate(); retired++; } };
    } }));
  try {
    const result = await shell.exec('python /main.py');
    await shell.dispose();
    await backend.dispose();
    return Response.json({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
      size: backend.files.get('/output')?.stat.size, retired, initialWasmMemoryBytes, ...backend.events,
      interpreter: true, runtime: 'workerd static JSPI fixture', productionHost: false, deploymentAttested: false,
      backend: 'R2 private pages and streamed immutable versions; process-local namespace fixture' });
  } catch (error) {
    return Response.json({ error: String(error), stack: error.stack, ...backend.events }, { status: 500 });
  } finally {
    await shell.dispose();
  }
}

let active = false;
export default { async fetch(request, env) {
  const expires = Number(env.QUALIFICATION_EXPIRES_AT);
  if (typeof env.QUALIFICATION_TOKEN !== 'string' || env.QUALIFICATION_TOKEN.length < 32 || !Number.isSafeInteger(expires)) {
    return new Response('Qualification bindings required', { status: 503 });
  }
  if (request.headers.get('Authorization') !== `Bearer ${env.QUALIFICATION_TOKEN}`) return new Response('Unauthorized', { status: 401 });
  if (expires <= Date.now()) return new Response('Qualification expired', { status: 410 });
  if (expires - Date.now() > 3600000) return new Response('Expiry must be within one hour', { status: 503 });
  if (request.method !== 'POST') return new Response('POST required', { status: 405 });
  const url = new URL(request.url);
  if (url.pathname !== '/staging') return new Response('Not found', { status: 404 });
  if (request.headers.get('Content-Length') !== '0' || request.headers.has('Transfer-Encoding')
    || !['9437184', '104857600'].includes(url.searchParams.get('size'))
    || !['immediate', 'delayed'].includes(url.searchParams.get('profile'))
    || !['0', '1'].includes(url.searchParams.get('spill') ?? '1')
    || [...url.searchParams.keys()].some(key => !['size', 'profile', 'spill'].includes(key) || url.searchParams.getAll(key).length !== 1)) {
    return new Response('Unsupported qualification workload', { status: 400 });
  }
  if (active) return new Response('Qualification already active in this isolate', { status: 409 });
  active = true;
  try { return await runQualification(url, env); }
  finally { active = false; }
} };
