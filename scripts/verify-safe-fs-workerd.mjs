import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { inflateRawSync } from 'node:zlib';

async function within(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function verifySafeFsWorkerd(consumerDirectory) {
  // Keep a hung runtime or dispose operation from retaining the publication host.
  const processGroup = process.platform !== 'win32';
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), resolve(consumerDirectory), '--run-fixture'], {
    detached: processGroup, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stopped = false;
  const stop = () => {
    if (!child.pid || stopped) return;
    stopped = true;
    if (!processGroup) { child.kill('SIGKILL'); return; }
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stdout = [], stderr = [], failures = [];
  let bytes = 0;
  let outputFailure;
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
    bytes += chunk.byteLength;
    if (bytes > 1_048_576) {
      outputFailure ??= new Error('Installed Worker verifier output exceeds 1 MiB');
      try { stop(); } catch (error) { failures.push(error); }
    } else chunks.push(chunk);
  });
  const closed = new Promise(accept => {
    child.once('error', error => failures.push(error));
    child.once('close', (code, signal) => accept({ code, signal }));
  });
  try {
    const result = await within(closed, 60_000, 'Installed Worker filesystem verification');
    if (outputFailure) throw outputFailure;
    assert.equal(result.code, 0, `Installed Worker filesystem failed (${result.signal ?? result.code}):\n${Buffer.concat(stderr).toString()}${Buffer.concat(stdout).toString()}`);
  } catch (error) { failures.push(error); }
  finally {
    try { stop(); } catch (error) { failures.push(error); }
    try { await within(closed, 5_000, 'Worker verifier child close'); }
    catch (error) { failures.push(error); }
    if (processGroup && child.pid) {
      const exists = () => {
        try { process.kill(-child.pid, 0); return true; }
        catch (error) { if (error.code === 'ESRCH') return false; throw error; }
      };
      try {
        for (let attempt = 0; attempt < 80 && exists(); attempt++) await new Promise(accept => setTimeout(accept, 25));
        assert.ok(!exists(), 'Worker verifier process group did not exit');
      } catch (error) { failures.push(error); }
    }
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  if (failures.length > 1) throw new AggregateError(failures, 'Installed Worker filesystem verification and cleanup failed');
  if (failures.length) throw failures[0];
  process.stdout.write(Buffer.concat(stdout));
  process.stderr.write(Buffer.concat(stderr));
}

async function runFixture(consumerDirectory) {
  const consumer = resolve(consumerDirectory);
  const installed = resolve(consumer, 'node_modules/@poe-platform/safe-fs');
  const manifest = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@poe-platform/safe-fs');
  const entry = manifest.exports['./fs/real'];
  assert.equal(entry.workerd, entry.import);
  assert.equal(typeof entry.workerd, 'string');
  assert.equal(entry.types.workerd, entry.types.default);
  assert.equal(typeof entry.types.workerd, 'string');
  assert.equal(entry.browser, null);
  assert.deepEqual(Object.keys(entry), ['types', 'workerd', 'browser', 'import']);
  assert.deepEqual(Object.keys(entry.types), ['workerd', 'browser', 'default']);
  assert.deepEqual(manifest.imports['#safe-fs-native-seek'], {
    types: './dist/safe-fs/native/fs-seek/loader.d.ts',
    workerd: './dist/safe-fs/node/native-seek-unavailable.js', browser: null,
    default: './dist/safe-fs/native/fs-seek/loader.mjs',
  });
  assert.deepEqual(manifest.imports['#safe-fs-platform'], {
    types: { workerd: './dist/safe-fs/platform/browser.d.ts', browser: './dist/safe-fs/platform/browser.d.ts', default: './dist/safe-fs/platform/node.d.ts' },
    workerd: './dist/safe-fs/platform/browser.js', browser: './dist/safe-fs/platform/browser.js', default: './dist/safe-fs/platform/node.js',
  });
  for (const fixture of ['safe-packages-fs-workerd.mjs', 'safe-packages-trace-workerd.mjs']) {
    const archive = fixture === 'safe-packages-trace-workerd.mjs';
    const contents = await readFile(new URL('./fixtures/' + fixture, import.meta.url), 'utf8');
    const options = {
      absWorkingDir: consumer, stdin: { contents, resolveDir: consumer, sourcefile: fixture },
      bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
      tsconfigRaw: { compilerOptions: {} }, external: ['node:*', 'cloudflare:*', 'browser-user-code.js'], write: false, logLevel: 'silent',
    };
    if (!archive) await assert.rejects(build({ ...options, conditions: ['browser'] }), error =>
      Array.isArray(error.errors) && error.errors.some(diagnostic =>
        diagnostic.text.includes('@poe-platform/safe-fs/fs/real') &&
        diagnostic.notes?.some(note => note.text.includes('explicitly disabled'))));
    const built = await build({ ...options, conditions: ['workerd', 'worker', 'browser'], metafile: true });
    for (const input of Object.keys(built.metafile.inputs)) {
      assert.ok(!input.endsWith('/native/fs-seek/loader.mjs') && !input.endsWith('.node'), 'Worker bundle includes native addon code');
      assert.ok(!input.endsWith('/safe-fs/platform/node.js'), 'Worker bundle includes the Node authority profile');
    }
    assert.ok(Object.keys(built.metafile.inputs).some(input => input.endsWith('/safe-fs/platform/browser.js')), 'Worker authority profile missing');
    for (const output of Object.values(built.metafile.outputs)) {
      assert.ok(output.imports.every(item => item.path !== '#safe-fs-native-seek'), 'Worker bundle retains an unresolved native seek import');
    }
    if (!archive) {
      const workerdOnly = await build({ ...options, platform: 'neutral', conditions: ['workerd'], metafile: true });
      assert.ok(Object.keys(workerdOnly.metafile.inputs).some(input => input.endsWith('/safe-fs/platform/browser.js')), 'workerd-only resolution lost the restricted authority profile');
      assert.ok(!Object.keys(workerdOnly.metafile.inputs).some(input => input.endsWith('/safe-fs/platform/node.js')), 'workerd-only resolution selected Node authority');
    }
    const script = built.outputFiles[0]?.text;
    assert.ok(script, 'Packaged Worker fixture bundle missing');
    const worker = new Miniflare({ modules: true, script,
      compatibilityDate: '2026-07-08', compatibilityFlags: ['nodejs_compat'],
      ...(archive ? { browserRendering: { binding: 'BROWSER' }, durableObjects: { ARCHIVE_PROOF: 'ArchiveProof' } } : {}),
    });
    const controller = new AbortController();
    const failures = [];
    try {
      await within(worker.ready, 10_000, 'Worker readiness');
      const routes = archive ? ['/start', '/navigate', '/stop', '/overflow-start', '/overflow-navigate', '/overflow-stop', '/failed-producer', '/dispose'] : ['/'];
      for (const [index, route] of routes.entries()) {
        const response = await within(worker.dispatchFetch('http://fixture' + route, { signal: controller.signal }), archive ? 30_000 : 10_000, 'Worker request ' + route);
        const body = await within(response.text(), 10_000, 'Worker response body ' + route);
        assert.equal(response.status, 200, body);
        const result = JSON.parse(body);
        if (archive) {
          assert.equal(result.sequence, index + 1, 'Requests did not reach the same retained Durable Object');
          if (route === '/stop') verifyTraceArchive(result);
          else assert.deepEqual(result, { ok: true, sequence: index + 1 });
          console.log('Separate retained-DO request verified: ' + route);
        } else assert.deepEqual(result, { ok: true });
      }
    } catch (error) { failures.push(error); }
    finally {
      controller.abort();
      try { await within(worker.dispose(), 10_000, 'Worker disposal'); }
      catch (error) { failures.push(error); }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'Worker fixture and disposal failed');
    if (failures.length) throw failures[0];
  }
  console.log('Installed safe-fs Workerd profile, unknown identity, retained bytes, cancellation, unsupported seek, close, and cleanup verified');
  console.log('Installed Cloudflare standard tracing-start/navigation/stop across separate retained-DO requests produced a native ZIP with recorded action content; compressed-byte refusal and producer failure retired private artifacts');
}

function verifyTraceArchive(result) {
  assert.equal(result.ok, true);
  assert.equal(typeof result.archive, 'string');
  const archive = Buffer.from(result.archive, 'base64');
  assert.ok(archive.length > 22 && archive.length <= 256 * 1024);
  // Inspect this bounded producer ZIP's central directory and exact recorded content.
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  assert.ok(count > 0 && count <= 256);
  let cursor = archive.readUInt32LE(end + 16);
  const entries = new Map();
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const method = archive.readUInt16LE(cursor + 10);
    const size = archive.readUInt32LE(cursor + 20);
    const length = archive.readUInt16LE(cursor + 28);
    const name = archive.subarray(cursor + 46, cursor + 46 + length).toString();
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const compressed = archive.subarray(start, start + size);
    assert.ok(method === 0 || method === 8);
    const bytes = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 });
    expanded += bytes.length;
    assert.ok(expanded <= 2 * 1024 * 1024);
    assert.equal(bytes.length, archive.readUInt32LE(cursor + 24));
    assert.ok(!entries.has(name));
    entries.set(name, bytes);
    cursor += 46 + length + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  assert.ok(entries.has('trace.trace'));
  assert.ok(entries.has('trace.network'));
  const trace = entries.get('trace.trace').toString();
  assert.ok(trace.includes('archive-proof') && trace.includes('click'), 'Native trace action content missing');
  console.log('Native archive entries verified: ' + [...entries.keys()].join(', '));

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || process.argv.length > 4 || process.argv[3] !== undefined && process.argv[3] !== '--run-fixture') {
    throw new Error('Usage: node scripts/verify-safe-fs-workerd.mjs <installed-consumer-directory>');
  }
  if (process.argv[3] === '--run-fixture') await runFixture(process.argv[2]);
  else await verifySafeFsWorkerd(process.argv[2]);
}
