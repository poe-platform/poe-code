import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
const output = mkdtempSync(join(state.work, 'binding-controls-')), rows = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const id of ['positive', 'tampered-root', 'missing-root', 'archive-source', 'symlink-source', 'unexported-runtime', 'missing-package']) {
  const consumer = join(output, id); mkdirSync(consumer);
  cpSync(join(state.consumer, 'node_modules'), join(consumer, 'node_modules'), { recursive: true });
  cpSync(join(own, 'audit-loader.mjs'), join(consumer, 'loader.mjs'));
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}');
  let source = "import assert from 'node:assert/strict';import {createOutputOperation} from 'virtual-bash';assert.equal(typeof createOutputOperation,'function');console.log('LOADED_EXACT_PACKAGE');";
  const packageRoot = join(consumer, 'node_modules/virtual-bash'), index = join(packageRoot, 'dist/index.js');
  if (id === 'tampered-root') writeFileSync(index, readFileSync(index, 'utf8') + "\nconsole.log('UNAUTHENTICATED_SENTINEL_EXECUTED');\n");
  if (id === 'missing-root') renameSync(index, index + '.absent');
  if (id === 'archive-source') source = 'await import(' + JSON.stringify(pathToFileURL(join(state.product, 'src/index.ts')).href) + ');';
  if (id === 'symlink-source') { symlinkSync(join(state.product, 'src/index.ts'), join(consumer, 'alias.ts')); source = "await import('./alias.ts');"; }
  if (id === 'unexported-runtime') source = "await import('virtual-bash/shell/runtime');";
  if (id === 'missing-package') renameSync(packageRoot, join(consumer, 'absent-package'));
  writeFileSync(join(consumer, 'entry.mjs'), source);
  writeFileSync(join(consumer, 'STATE.json'), JSON.stringify({ ...state, consumer }));
  const child = spawnSync(state.node, ['--experimental-loader', join(consumer, 'loader.mjs'), join(consumer, 'entry.mjs')], {
    cwd: consumer, env: { ...process.env, NODE_OPTIONS: '', REVIEW_STATE: join(consumer, 'STATE.json'), REVIEW_TRACE: join(consumer, 'imports.jsonl') }, encoding: 'utf8', timeout: 15000,
  });
  writeFileSync(join(consumer, 'stdout'), child.stdout ?? ''); writeFileSync(join(consumer, 'stderr'), child.stderr ?? '');
  assert.equal(child.signal, null); assert.equal(child.status, id === 'positive' ? 0 : 1);
  const expected = { positive: 'LOADED_EXACT_PACKAGE', 'tampered-root': 'REVIEW_PACKAGE_TAMPER', 'missing-root': 'ERR_MODULE_NOT_FOUND', 'archive-source': 'REVIEW_SOURCE_FALLBACK_DENIED', 'symlink-source': 'REVIEW_SOURCE_FALLBACK_DENIED', 'unexported-runtime': 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'missing-package': 'ERR_MODULE_NOT_FOUND' }[id];
  assert((child.stdout + child.stderr).includes(expected), id); assert(!child.stdout.includes('UNAUTHENTICATED_SENTINEL_EXECUTED'));
  rows.push({ family: 'package', id, status: child.status, expected, sourceSHA256: hash(source) });
}
const actual = join(state.work, 'safejs-6Mzt26', 'surface');
for (const id of ['engine-positive', 'engine-tampered', 'engine-missing', 'forbidden-private-fs']) {
  const root = join(output, id); cpSync(actual, root, { recursive: true });
  const binding = JSON.parse(readFileSync(join(root, 'BINDING.json'))), engine = join(root, 'engine/src/run.ts');
  const source = id === 'forbidden-private-fs'
    ? "import {readFileSync} from 'node:fs';readFileSync('/Users/kjopek/Workspace/poe-code/package.json');console.log('PRIVATE_READ_OCCURRED');"
    : "import assert from 'node:assert/strict';import {run} from '../engine/src/run.ts';assert.equal(typeof run,'function');console.log('ACTUAL_COPIED_ENGINE');";
  writeFileSync(join(root, 'consumer/guard.mjs'), source); binding.files['consumer/guard.mjs'] = hash(source);
  if (id === 'engine-tampered') { assert(lstatSync(engine).isFile()); assert(!lstatSync(engine).isSymbolicLink()); chmodSync(engine, 0o600); writeFileSync(engine, readFileSync(engine, 'utf8') + "\nconsole.log('ENGINE_SENTINEL_EXECUTED');\n"); }
  if (id === 'engine-missing') renameSync(engine, engine + '.absent');
  writeFileSync(join(root, 'BINDING.json'), JSON.stringify(binding));
  const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
  const child = spawnSync(node, ['--permission', '--allow-fs-read=' + root, '--allow-fs-write=' + join(root, 'logs'), '--import', join(root, 'loader.mjs'), join(root, 'consumer/guard.mjs')], {
    cwd: root, env: { PATH: dirname(node) + ':/usr/bin:/bin', SURFACE_ROOT: root, SURFACE_IMPORTS: join(root, 'logs/guard.imports') }, encoding: 'utf8', timeout: 20000,
  });
  writeFileSync(join(root, 'logs/guard.stdout'), child.stdout ?? ''); writeFileSync(join(root, 'logs/guard.stderr'), child.stderr ?? '');
  assert.equal(child.signal, null); assert.equal(child.status, id === 'engine-positive' ? 0 : 1);
  const expected = { 'engine-positive': 'ACTUAL_COPIED_ENGINE', 'engine-tampered': 'Changed current import: engine/src/run.ts', 'engine-missing': 'ERR_MODULE_NOT_FOUND', 'forbidden-private-fs': 'ERR_ACCESS_DENIED' }[id];
  assert((child.stdout + child.stderr).includes(expected), id); assert(!child.stdout.includes('ENGINE_SENTINEL_EXECUTED')); assert(!child.stdout.includes('PRIVATE_READ_OCCURRED'));
  rows.push({ family: 'engine', id, status: child.status, expected, node, nodeSHA256: hash(readFileSync(node)), sourceSHA256: hash(source) });
}
writeFileSync(join(output, 'REPORT.json'), JSON.stringify({ candidate: state.candidate, packageSHA256: state.packageSHA256, rows }, null, 2)); console.log('BINDING CONTROLS', output);
