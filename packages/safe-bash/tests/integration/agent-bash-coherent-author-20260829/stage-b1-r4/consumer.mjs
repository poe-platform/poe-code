import fs from 'node:fs';
import { captureFailure } from './failure.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { admitFile } from './admission.mjs';
import { runWorkflow, engineIds } from './workflows.mjs';

export async function main(args) {
  assert.equal(args.length, 4); assert.equal(args[0], '--run');
  const request = JSON.parse(admitFile(args[1], { bytes: Number(args[3]), sha256: args[2] }, 1048576));
  assert.equal(request.action, 'ROOT_RUN_COHERENT_B1_PUBLIC15');
  assert.equal(request.sourceTree, '3adc676a0ab638c9788ef007e465931d65d2c6fe');
  assert.equal(request.packageSha256, '2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
  assert.deepEqual(request.ids, engineIds);
  const packageRoot = fs.realpathSync(request.packageRoot); assert.equal(packageRoot, request.packageRoot);
  const members = JSON.parse(admitFile(request.membership.path, request.membership, 1048576));
  assert.equal(members.length, 1014);
  const expected = new Map(members.map(entry => [entry.path, entry]));
  const verify = () => {
    const observed = [];
    const walk = (directory, prefix = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        assert.ok(!entry.isSymbolicLink() && entry.name !== 'AGENTS.md');
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
        else { assert.ok(entry.isFile() && expected.has(relative)); admitFile(path.join(packageRoot, relative), expected.get(relative), 16777216); observed.push(relative); }
      }
    };
    walk(packageRoot); assert.deepEqual(observed.sort(), [...expected.keys()].sort());
  };
  verify();
  const rootURL = import.meta.resolve('virtual-bash'), nodeURL = import.meta.resolve('virtual-bash/commands/node');
  assert.equal(rootURL, pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
  assert.equal(nodeURL, pathToFileURL(path.join(packageRoot, 'dist/commands/node/index.js')).href);
  await assert.rejects(import('virtual-bash/commands/node/host'));
  const receipt = JSON.parse(admitFile(request.engineReceipt.path, request.engineReceipt, 131072));
  assert.equal(request.engineReceipt.sha256, 'a4d3614d6d944660aaddc1fd95c8fe6ebef1d92fc0dd8607400578d9a82254de');
  for (const entry of receipt.engine) admitFile(path.join(request.engineRoot, entry.stagedRelativePath), entry, 262144);
  admitFile(request.adapter.path, request.adapter, 16384);
  const api = await import(rootURL), nodeApi = await import(nodeURL);
  const fixture = JSON.parse(admitFile(request.fixture.path, request.fixture, 1048576));
  const observations = [], rows = [];
  const engine = {
    role: 'SEPARATELY_AUTHENTICATED_PUBLIC_ENGINE',
    createProvider() {
      return nodeApi.createNodeWorkerProvider({ entry: pathToFileURL(request.adapter.path).href, identity: 'author-public-bb23-node-adapter-v1', observe(event) { assert.ok(observations.length < 512); observations.push(event); } });
    },
  };
  for (const id of engineIds) {
    const deadline = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
    try { rows.push(await runWorkflow(id, { api, nodeApi, fixture, engine })); }
    catch (reason) {
      if (reason?.facts?.cleanupFailure) throw reason;
      rows.push({ id, status: 'FAIL', ...captureFailure(reason, reason?.facts?.phase), facts: reason?.facts });
    } finally { clearTimeout(deadline); }
  }
  verify();
  console.log(JSON.stringify({ schema: 'coherent-b1-public15-result-v1', layout: request.layout, rows, observations, passed: rows.filter(row => row.status === 'PASS').length, failed: rows.filter(row => row.status !== 'PASS').length }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
