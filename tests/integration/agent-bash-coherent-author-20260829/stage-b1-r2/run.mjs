import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { read, sha, streamed, inventory, json, supervisor, safe, reasonRecord } from '../stage-b0-r3/owner.mjs';

const root = '/Users/kjopek/Workspace/safe-bash';
const base = path.dirname(import.meta.dirname);
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
function closure(directory, members) {
  assert.deepEqual(inventory(directory), members.slice().sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))));
  const directories = new Set(['']);
  for (const entry of members) { let name = path.posix.dirname(entry.path); while (name !== '.') { directories.add(name); name = path.posix.dirname(name); } }
  const walk = (relative = '') => { for (const item of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) if (item.isDirectory()) { const child = relative ? `${relative}/${item.name}` : item.name; assert.ok(directories.has(child)); walk(child); } };
  walk();
}
function decodeArchive(body, compressed, inflated) {
  const gzip = Buffer.from(body.toString('ascii').trim(), 'base64');
  assert.ok(gzip.length <= compressed);
  const output = gunzipSync(gzip, { maxOutputLength: inflated, info: true });
  assert.equal(output.engine.bytesWritten, gzip.length);
  assert.ok(body.length + gzip.length + output.buffer.length <= 33554432);
  return JSON.parse(output.buffer);
}
export async function main(seal, started) {
  assert.equal(process.env.B1_ROOT_GO, 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION');
  const b0 = JSON.parse(read(path.join(root, seal.b0.path), 1048576, seal.b0));
  const inputs = JSON.parse(read(path.join(root, seal.authenticatedInputs.path), 1048576, seal.authenticatedInputs));
  await streamed(node, b0.node);
  for (const entry of seal.files) read(path.join(root, entry.path), 4194304, entry);
  const producer = '/private/tmp/safe-bash-coherent-stage-a-20260829-r2', work = seal.workRoot;
  assert.equal(fs.existsSync(work), false); fs.mkdirSync(work); assert.equal(fs.realpathSync(work), work);
  for (const name of ['capture', 'home', 'cache', 'input', 'source-built']) fs.mkdirSync(path.join(work, name));
  const manager = supervisor(path.join(work, 'capture'), 1620, 67108864, { started });
  try {
    const stage = JSON.parse(read(path.join(base, 'stage-b0-r2/stageAProducerPreseal.json'), 65536, b0.stageAProducerPreseal));
    const get = name => { const entry = b0.producerRecords.find(row => row.path === name); assert.ok(entry); return JSON.parse(read(path.join(base, 'stage-a-r2/evidence', name), 2097152, entry)); };
    const members = get('PACKAGE-MEMBERS.json'), emits = get('EMITTED.json'), tools = get('TOOLS-BEFORE.json');
    const source = JSON.parse(read(stage.source.path, 262144, stage.source));
    assert.equal(source.inputs.length, 309); assert.equal(members.length, 1014); assert.equal(emits.length, 1012);
    const links = Object.fromEntries(stage.links.map(entry => [entry.package + '/' + entry.path, entry.target]));
    const verifyRetained = () => {
      for (const entry of source.inputs) read(path.join(producer, 'source', safe(entry.path)), 33554432, entry);
      for (const entry of emits) read(path.join(producer, 'source/dist', safe(entry.path)), 33554432, entry);
      assert.deepEqual(inventory(path.join(producer, 'tools'), links), tools);
    };
    verifyRetained();
    const archiveOrigin = path.join(base, 'stage-a-r2/evidence/package/virtual-bash-0.0.0.tgz');
    const raw = read(archiveOrigin, 1048576, b0.package);
    const archive = path.join(work, 'input/product.tgz'); fs.writeFileSync(archive, raw, { flag: 'wx' });
    const sourcePackage = path.join(work, 'source-built/node_modules/virtual-bash'); fs.mkdirSync(sourcePackage, { recursive: true });
    for (const entry of members) {
      const body = read(path.join(producer, 'source', safe(entry.path)), 16777216, entry), target = path.join(sourcePackage, safe(entry.path));
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body, { mode: entry.mode, flag: 'wx' });
    }
    closure(sourcePackage, members);
    const metadata = JSON.parse(read(path.join(sourcePackage, 'package.json'), 1048576, members.find(entry => entry.path === 'package.json')));
    assert.deepEqual(metadata.dependencies ?? {}, {});
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(metadata.scripts?.[key], undefined);
    const admitted = new Map(inputs.inputs.map(entry => [path.basename(entry.path), entry]));
    const engineEntry = admitted.get('INPUTS-v1.json.gz.base64'), receiptEntry = admitted.get('PUBLIC-ENGINE-RECEIPT.json');
    const engine = decodeArchive(read(engineEntry.absolute, 2097152, engineEntry), 2097152, 16777216);
    const receiptBody = read(receiptEntry.absolute, 131072, receiptEntry), receipt = JSON.parse(receiptBody);
    assert.equal(engine.engine.length, 96); assert.equal(receipt.engine.length, 96);
    const engineBodies = engine.engine.map(entry => {
      const relative = safe(entry.target.slice('compiled/'.length));
      assert.ok(entry.target.startsWith('compiled/engine/') || entry.target === 'compiled/support/errors.js');
      const expected = receipt.engine.find(row => row.archiveTarget === entry.target); assert.ok(expected);
      const body = Buffer.from(entry.body, 'base64'); assert.equal(body.length, expected.bytes); assert.equal(sha(body), expected.sha256);
      return { relative, body, bytes: expected.bytes, sha256: expected.sha256 };
    });
    fs.writeFileSync(path.join(work, 'home/user.npmrc'), ''); fs.writeFileSync(path.join(work, 'home/global.npmrc'), '');
    const env = { PATH: path.dirname(node), HOME: path.join(work, 'home'), TMPDIR: work, TMP: work, TEMP: work, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '', NPM_CONFIG_USERCONFIG: path.join(work, 'home/user.npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(work, 'home/global.npmrc'), NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false', NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
    const install = path.join(work, 'installed'); fs.mkdirSync(install); fs.writeFileSync(path.join(install, 'package.json'), '{"private":true,"type":"module"}\n');
    const npm = path.join(producer, 'tools/npm/bin/npm-cli.js');
    await manager.run('offline-install', node, ['--experimental-permission', '--allow-fs-read=' + work, '--allow-fs-read=' + path.join(producer, 'tools'), '--allow-fs-read=' + node, '--allow-fs-write=' + install, '--allow-fs-write=' + path.join(work, 'cache'), '--allow-fs-write=' + path.join(work, 'home'), npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', path.join(work, 'cache'), '--prefix', install, archive], { cwd: install, env, seconds: 120 });
    closure(path.join(install, 'node_modules/virtual-bash'), members);
    const aggregate = [];
    for (const layout of ['source-built', 'installed', 'physically-moved']) {
      manager.remaining(); const consumer = path.join(work, layout); if (layout === 'physically-moved') fs.renameSync(install, consumer);
      const packageRoot = path.join(consumer, 'node_modules/virtual-bash'); closure(packageRoot, members);
      const harness = path.join(consumer, 'harness'), scripts = path.join(harness, 'node'); fs.mkdirSync(scripts, { recursive: true });
      for (const entry of seal.stageFiles) { const body = read(path.join(root, entry.source), 4194304, entry); fs.writeFileSync(path.join(scripts, entry.target), body); }
      for (const entry of engineBodies) { const target = path.join(scripts, entry.relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, entry.body); }
      const engineBefore = inventory(scripts);
      const moduleFiles = [];
      for (const directory of [path.join(packageRoot, 'dist'), scripts]) for (const entry of inventory(directory)) if (/\.(?:js|mjs)$/.test(entry.path)) {
        const filename = path.join(directory, entry.path), body = read(filename, 262144, entry).toString();
        const builtins = [...new Set([...body.matchAll(/(?:from\s*|import\s*)["'](node:[^"']+)["']/gu)].map(match => match[1]))].sort();
        moduleFiles.push({ ...entry, path: filename, builtins });
      }
      json(path.join(harness, 'load-manifest.json'), { files: moduleFiles, aliases: { 'virtual-bash': path.join(packageRoot, 'dist/index.js'), 'virtual-bash/commands/node': path.join(packageRoot, 'dist/commands/node/index.js') } });
      const log = path.join(consumer, layout + '-workers.jsonl'); fs.writeFileSync(log, '');
      const adapter = admitted.get('engine-adapter-v1.mjs');
      json(path.join(harness, 'node-policy.json'), { log, maximum: 5, workerEntry: path.join(packageRoot, 'dist/commands/node/worker-main.js'), adapters: [pathToFileURL(path.join(scripts, 'engine-adapter-v1.mjs')).href] });
      const membership = path.join(consumer, layout + '-members.json'), fixture = path.join(scripts, 'neutral.json'), receiptPath = path.join(consumer, layout + '-engine-receipt.json');
      json(membership, members); fs.writeFileSync(receiptPath, receiptBody);
      const descriptor = filename => { const body = read(filename, 2097152); return { path: filename, bytes: body.length, sha256: sha(body) }; };
      const request = { action: 'ROOT_RUN_COHERENT_B1_PUBLIC15', sourceTree: seal.sourceTree, packageSha256: b0.package.sha256, layout, ids: seal.ids, packageRoot, engineRoot: scripts, membership: descriptor(membership), fixture: descriptor(fixture), engineReceipt: descriptor(receiptPath), adapter: { ...adapter, path: path.join(scripts, 'engine-adapter-v1.mjs') } };
      const requestPath = path.join(consumer, layout + '-request.json'); json(requestPath, request); const requestIdentity = descriptor(requestPath);
      const setupInputs = [path.join(harness, 'node-policy.json'), path.join(harness, 'load-manifest.json'), membership, receiptPath, requestPath].map(descriptor);
      const output = await manager.run('workflow-' + layout, node, ['--experimental-permission', '--allow-fs-read=' + consumer, '--allow-fs-read=' + node, '--allow-fs-write=' + consumer, '--allow-worker', '--import', path.join(scripts, 'node-policy.mjs'), '--import', path.join(scripts, 'node-load-guard.mjs'), path.join(scripts, 'consumer.mjs'), '--run', requestPath, requestIdentity.sha256, String(requestIdentity.bytes)], { cwd: consumer, env, seconds: 300 });
      const report = JSON.parse(read(output.stdout, 8388608)); assert.equal(report.schema, 'coherent-b1-public15-result-v1'); assert.equal(report.layout, layout); assert.deepEqual(report.rows.map(row => row.id), seal.ids);
      const events = read(log, 1048576).toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const created = events.filter(event => event.kind === 'node-worker-create'), exited = events.filter(event => event.kind === 'node-worker-exit');
      assert.ok(created.length <= 5); assert.deepEqual(created.map(event => event.id).sort(), exited.map(event => event.id).sort());
      let live = 0, peak = 0;
      for (const event of events) { if (event.kind === 'node-worker-create') { live++; peak = Math.max(peak, live); } else if (event.kind === 'node-worker-exit') live--; assert.ok(live >= 0); }
      assert.equal(live, 0); closure(packageRoot, members); assert.deepEqual(inventory(scripts), engineBefore);
      for (const entry of setupInputs) read(entry.path, 2097152, entry);
      aggregate.push({ layout, report, guestWorkerCreates: created.length, guestWorkerExits: exited.length, guestWorkerPeak: peak, regexWorkers: 0, internalLoaderThreads: 0, events, pid: output.pid });
    }
    verifyRetained(); read(archive, 1048576, b0.package);
    for (const entry of seal.files) read(path.join(root, entry.path), 4194304, entry);
    const workBytes = inventory(work).reduce((sum, entry) => sum + entry.bytes, 0); assert.ok(workBytes <= 805306368);
    const retirement = manager.finish();
    manager.publish(path.join(work, 'RESULT.json'), { status: aggregate.some(entry => entry.report.failed) ? 'ASSERTION_FAILURE' : 'PASS', sourceTree: seal.sourceTree, package: b0.package, aggregate, retirement, workBytes, B2: 'UNRUN', coherentAcceptance: false });
    process.exitCode = aggregate.some(entry => entry.report.failed) ? 1 : 0;
  } catch (reason) {
    const retirement = manager.abort(reason);
    try { manager.publish(path.join(work, 'STOP.json'), { primaryPresent: true, primary: reasonRecord(reason), retirement, automaticRetry: false }); }
    catch (publication) { console.error(JSON.stringify({ terminalPersistence: false, primary: reasonRecord(reason), publication: reasonRecord(publication) })); }
    process.exitCode = 78; throw reason;
  }
}
