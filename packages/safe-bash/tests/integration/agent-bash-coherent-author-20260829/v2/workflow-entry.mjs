import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { admitFile } from './admission.mjs';
import { runWorkflow, engineFreeIds } from './workflows.mjs';

export async function main(args) {
  assert.equal(args.length, 4); assert.equal(args[0], '--run');
  const requestBytes = admitFile(args[1], { bytes: Number(args[3]), sha256: args[2] }, 1048576);
  const request = JSON.parse(requestBytes);
  assert.equal(request.action, 'ROOT_RUN_COHERENT_ENGINE_FREE'); assert.equal(request.sourceTree, '3adc676a0ab638c9788ef007e465931d65d2c6fe');
  assert.equal(request.profile, 'engine-free'); assert.deepEqual(request.ids, engineFreeIds);
  assert.ok(['source-built','installed','physically-moved'].includes(request.layout));
  assert.equal(request.independentGrantRequired, true); assert.ok(typeof request.rootAuthorization === 'string' && request.rootAuthorization.length > 0);
  const packageRoot = fs.realpathSync(request.packageRoot), membership = JSON.parse(admitFile(request.membership.path, request.membership, 1048576));
  assert.equal(membership.length, 1014); assert.equal(new Set(membership.map(row => row.path)).size, 1014);
  const expected = new Map(membership.map(row => [row.path, row])); const observed = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name, filename = path.join(directory, entry.name);
      assert.ok(entry.name !== 'AGENTS.md' && !entry.isSymbolicLink());
      if (entry.isDirectory()) walk(filename, relative);
      else { assert.ok(entry.isFile()); const row = expected.get(relative); assert.ok(row, relative); admitFile(filename, row, 16777216); observed.push(relative); }
    }
  }
  walk(packageRoot); assert.deepEqual(observed.sort(), [...expected.keys()].sort());
  const metadata = JSON.parse(admitFile(path.join(packageRoot, 'package.json'), expected.get('package.json'), 1048576));
  assert.equal(metadata.name, 'virtual-bash'); assert.deepEqual(metadata.dependencies ?? {}, {});
  const rootUrl = import.meta.resolve('virtual-bash'), nodeUrl = import.meta.resolve('virtual-bash/commands/node');
  assert.equal(rootUrl, pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
  assert.equal(nodeUrl, pathToFileURL(path.join(packageRoot, 'dist/commands/node/index.js')).href);
  await assert.rejects(import('virtual-bash/commands/node/host'));
  const fixture = JSON.parse(admitFile(request.fixture.path, request.fixture, 1048576));
  const api = await import(rootUrl), nodeApi = await import(nodeUrl);
  const rows = [];
  for (const id of request.ids) {
    const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exitCode = 78; }, 30000);
    try { rows.push(await runWorkflow(id, { api, nodeApi, fixture })); }
    catch (error) { rows.push({ id, status: 'FAIL', detail: String(error?.stack ?? error), facts: error?.facts }); if (error?.facts?.cleanupFailure) throw error; }
    finally { clearTimeout(timer); }
  }
  assert.equal(rows.length, 13); assert.equal(new Set(rows.map(row => row.id)).size, 13);
  for (const row of membership) admitFile(path.join(packageRoot, row.path), row, 16777216);
  console.log(JSON.stringify({ layout: request.layout, rows, engineExecutions: 0 }));
  process.exitCode = rows.some(row => row.status !== 'PASS') ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
