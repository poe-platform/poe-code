import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runHost } from './hosts-v1.mjs';
import { runProductRow } from './product-row-v1.mjs';

const request = JSON.parse(readFileSync(0, 'utf8'));
const packageRoot = realpathSync(process.env.CONSUMER_PACKAGE_ROOT);
const loaded = {}; const forbidden = [];
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { forbidden.push(name); throw new Error('Product host process forbidden'); };
globalThis.fetch = async () => { forbidden.push('fetch'); throw new Error('Product network forbidden'); };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(url));
    assert.ok(path.startsWith(resolve(packageRoot, 'dist') + '/') && path.endsWith('.js'), 'Installed JavaScript only: ' + path);
    loaded[relative(packageRoot, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return nextLoad(url, context);
} });
const resolved = { root: import.meta.resolve('virtual-bash'), contracts: import.meta.resolve('virtual-bash/contracts') };
assert.equal(resolved.root, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
assert.equal(resolved.contracts, pathToFileURL(resolve(packageRoot, 'dist/contracts/index.js')).href);
const api = await import('virtual-bash');
const contracts = await import('virtual-bash/contracts');
assert.equal(api.FsError, contracts.FsError);
let result; let failure;
try {
  result = request.kind === 'host' ? await runHost(async () => api, request.id) : await runProductRow(async () => api, request.row);
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
assert.deepEqual(forbidden, []);
console.log(JSON.stringify({ id: request.id, kind: request.kind, resolved, loaded, forbidden, result, failure }));
