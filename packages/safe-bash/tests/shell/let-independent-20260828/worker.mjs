import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const own = dirname(fileURLToPath(import.meta.url));
const manifestBytes = readFileSync(process.argv[2]);
assert.equal(hash(manifestBytes), process.argv[3]);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.kind, 'let-independent-loaded-candidate-v1');
assert.equal(manifest.baseline, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
assert.match(manifest.candidate, /^[0-9a-f]{40}$/u);
assert.ok(['source', 'moved', 'absent-reversion', 'mechanism-mutant'].includes(manifest.layout));
for (const name of ['worker.mjs', 'cases.json']) assert.equal(hash(readFileSync(join(own, name))), manifest.holdouts[name]);
assert.equal(hash(readFileSync(process.execPath)), manifest.nodeSha256);
const packageRoot = realpathSync(manifest.packageRoot);
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(name.includes('..'), false); assert.equal(name.startsWith('/'), false);
  const path = join(packageRoot, name);
  assert.equal(lstatSync(path).isSymbolicLink(), false, path);
  assert.equal(realpathSync(path), path);
  assert.equal(hash(readFileSync(path)), expected, path);
}
for (const required of ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/shell/runtime.js', 'dist/shell/arithmetic.js', 'dist/shell/cancellation.js']) assert.ok(manifest.files[required], required);
const target = join(packageRoot, 'dist/index.js');
const loaded = manifest.layout === 'moved' ? import.meta.resolve('virtual-bash') : pathToFileURL(target).href;
assert.equal(realpathSync(fileURLToPath(loaded)), target);
const { Shell, MemoryFileSystem, agentCommands } = await import(loaded);
const cases = JSON.parse(readFileSync(join(own, 'cases.json')));
const observations = [];
for (const row of cases) {
  if (manifest.caseIds && !manifest.caseIds.includes(row.id)) continue;
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: 'C', TZ: 'UTC' }, limits: { maxCommands: 64, maxSourceBytes: 32768, maxOutputBytes: 16384, maxExpansionFields: 512, maxExpansionBytes: 4096, ...row.limits } }).use(agentCommands());
  const observation = { id: row.id, family: row.family, settled: false, disposed: false };
  try {
    const result = await shell.exec(row.script);
    observation.result = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, stdoutBase64: Buffer.from(result.stdoutBytes).toString('base64'), stderrBase64: Buffer.from(result.stderrBytes).toString('base64') };
    assert.equal(result.stdout, row.stdout); assert.equal(result.stderr, row.stderr); assert.equal(result.exitCode, row.exitCode);
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(row.stdout));
    assert.deepEqual(result.stderrBytes, new TextEncoder().encode(row.stderr));
    observation.pass = true;
  } catch (error) { observation.pass = false; observation.failure = { name: error?.name, message: error?.message ?? String(error), stack: error?.stack }; }
  finally {
    observation.settled = true;
    try { await shell.dispose(); observation.disposed = true; }
    catch (error) { observation.pass = false; observation.disposalFailure = { name: error?.name, message: error?.message ?? String(error) }; }
    observations.push(observation);
    process.stdout.write(JSON.stringify({ observation }) + '\n');
  }
}
assert.equal(observations.length, manifest.caseIds?.length ?? cases.length);
for (const [name, expected] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(join(packageRoot, name))), expected, name);
process.stdout.write(JSON.stringify({ layout: manifest.layout, candidate: manifest.candidate, loaded, runtimeSha256: manifest.files['dist/shell/runtime.js'], arithmeticSha256: manifest.files['dist/shell/arithmetic.js'], cases: observations.length, pass: observations.filter(row => row.pass).length, failed: observations.filter(row => !row.pass).map(row => row.id), nativeExecutions: 0 }) + '\n');
if (observations.some(row => !row.pass)) process.exitCode = 1;
