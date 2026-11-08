import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { admitFile } from './admission.mjs';
import { runWorkflow, engineFreeIds, engineIds } from './workflows.mjs';

export async function main(args) {
  assert.equal(args.length, 4);
  assert.equal(args[0], '--run');
  const request = JSON.parse(admitFile(args[1], { bytes: Number(args[3]), sha256: args[2] }, 1048576));
  assert.equal(request.action, 'ROOT_RUN_COHERENT_STAGE_B');
  assert.equal(request.sourceTree, '3adc676a0ab638c9788ef007e465931d65d2c6fe');
  assert.equal(request.packageSha256, '2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
  assert.ok(['engine-free', 'PUBLIC95'].includes(request.profile));
  const ids = request.profile === 'engine-free' ? engineFreeIds : engineIds;
  assert.deepEqual(request.ids, ids);
  assert.ok(['source-built', 'installed', 'physically-moved'].includes(request.layout));
  assert.equal(request.independentGrantRequired, true);
  assert.ok(typeof request.rootAuthorization === 'string' && request.rootAuthorization.length > 0);
  const packageRoot = fs.realpathSync(request.packageRoot);
  assert.equal(packageRoot, request.packageRoot);
  const membership = JSON.parse(admitFile(request.membership.path, request.membership, 1048576));
  assert.equal(membership.length, 1014);
  const expected = new Map(membership.map(row => [row.path, row]));
  assert.equal(expected.size, 1014);
  function verifyMembership() {
    const observed = [];
    function walk(directory, prefix = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix ? prefix + '/' + entry.name : entry.name;
        const filename = path.join(directory, entry.name);
        assert.ok(entry.name !== 'AGENTS.md' && !entry.isSymbolicLink());
        if (entry.isDirectory()) walk(filename, relative);
        else {
          assert.ok(entry.isFile());
          const row = expected.get(relative);
          assert.ok(row, relative);
          admitFile(filename, row, 16777216);
          observed.push(relative);
        }
      }
    }
    walk(packageRoot);
    assert.deepEqual(observed.sort(), [...expected.keys()].sort());
  }
  verifyMembership();
  const metadata = JSON.parse(admitFile(path.join(packageRoot, 'package.json'), expected.get('package.json'), 1048576));
  assert.equal(metadata.name, 'virtual-bash');
  assert.deepEqual(metadata.dependencies ?? {}, {});
  const rootUrl = import.meta.resolve('virtual-bash');
  const nodeUrl = import.meta.resolve('virtual-bash/commands/node');
  assert.equal(rootUrl, pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
  assert.equal(nodeUrl, pathToFileURL(path.join(packageRoot, 'dist/commands/node/index.js')).href);
  await assert.rejects(import('virtual-bash/commands/node/host'));
  const fixture = JSON.parse(admitFile(request.fixture.path, request.fixture, 1048576));
  const api = await import(rootUrl);
  const nodeApi = await import(nodeUrl);
  const observations = [];
  let engine;
  if (request.profile === 'PUBLIC95') {
    const receipt = JSON.parse(admitFile(request.engineReceipt.path, request.engineReceipt, 131072));
    assert.equal(request.engineReceipt.sha256, 'a4d3614d6d944660aaddc1fd95c8fe6ebef1d92fc0dd8607400578d9a82254de');
    assert.equal(receipt.productWorker.sha256, '2ef280342b55c028c8e35e0f6cc98c9bf45c580134c9f0ada078815da1b3820d');
    assert.equal(fs.realpathSync(request.adapter.path), request.adapter.path);
    assert.equal(request.adapter.sha256, '2108bf2e7eee28ecd16c7e644c0684518cbfd68219c2971d2df67b155bf4e80d');
    admitFile(request.adapter.path, request.adapter, 16384);
    engine = {
      role: 'SEPARATELY_AUTHENTICATED_PUBLIC_ENGINE',
      createProvider() {
        return nodeApi.createNodeWorkerProvider({
          entry: pathToFileURL(request.adapter.path).href,
          identity: 'author-public-bb23-node-adapter-v1',
          observe(event) { assert.ok(observations.length < 512); observations.push(event); },
        });
      },
    };
  } else {
    assert.equal(Object.hasOwn(request, 'engineReceipt'), false);
    assert.equal(Object.hasOwn(request, 'adapter'), false);
  }
  const rows = [];
  for (const id of ids) {
    const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
    try { rows.push(await runWorkflow(id, { api, nodeApi, fixture, engine })); }
    catch (error) {
      rows.push({ id, status: 'FAIL', detail: String(error?.stack ?? error), facts: error?.facts });
      if (error?.facts?.cleanupFailure) throw error;
    } finally { clearTimeout(timer); }
  }
  assert.equal(rows.length, ids.length);
  assert.equal(new Set(rows.map(row => row.id)).size, ids.length);
  verifyMembership();
  console.log(JSON.stringify({ layout: request.layout, profile: request.profile, rows, observations }));
  process.exitCode = rows.some(row => row.status !== 'PASS') ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
