import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const inputs = JSON.parse(fs.readFileSync(path.join(home, 'INPUTS.json')));
const root = inputs.root;
const work = path.join(home, 'work');
const evidence = path.join(home, 'novel-evidence');
fs.mkdirSync(evidence);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const { supervise } = await import(pathToFileURL(path.join(root, 'supervisor.mjs')));
const { createQueryWindow, importWithWindow, authenticateBootstrap, profile } = await import(pathToFileURL(path.join(root, 'bootstrap.mjs')));
const { assessTerminal } = await import(pathToFileURL(path.join(root, 'report.mjs')));
const rows = [];
let unsafe = false;
const check = async (id, body) => {
  try { const detail = await body(); rows.push({ id, pass: true, detail }); }
  catch (error) { rows.push({ id, pass: false, code: error.code, message: error.message }); }
};
for (const value of ['node:module', new String('module'), null]) {
  await check(`Q-invalid-${typeof value}-${String(value)}`, async () => {
    const emitted = [], window = createQueryWindow(row => emitted.push(row));
    let delegation = 0;
    const denial = () => { delegation++; throw Error('NATIVE_DELEGATION'); };
    const host = { getBuiltinModule: denial };
    await assert.rejects(importWithWindow({ host, window, load: async () => {
      try { host.getBuiltinModule(value); } catch {}
      return 'caught-success';
    } }), { code: 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION' });
    assert.equal(host.getBuiltinModule, denial);
    assert.equal(delegation, 0);
    assert.equal(window.snapshot().revoked, true);
    assert.equal(emitted[0].code, 'BOOTSTRAP_QUERY');
    return window.snapshot();
  });
}
for (const primary of [undefined, null, 0]) {
  await check(`Q-primary-${String(primary)}`, async () => {
    const window = createQueryWindow(() => {});
    const denial = () => { throw Error('RESTORED_DENIAL'); };
    const host = { getBuiltinModule: denial };
    let alias, caught = false;
    try {
      await importWithWindow({ host, window, load: async () => {
        alias = host.getBuiltinModule;
        assert.equal(alias('module'), undefined);
        throw primary;
      } });
    } catch (error) { caught = true; assert.equal(error, primary); }
    assert.equal(caught, true);
    assert.equal(host.getBuiltinModule, denial);
    assert.throws(() => alias('worker_threads'), { code: 'BOOTSTRAP_REVOKED' });
    return { primarySelected: true, primaryUndefined: primary === undefined, restored: true };
  });
}
await check('Q-success-revoked-before-afterRevoke', async () => {
  const window = createQueryWindow(() => {}), denial = () => undefined;
  const host = { getBuiltinModule: denial };
  let alias, after = false;
  const result = await importWithWindow({ host, window, load: async () => {
    alias = host.getBuiltinModule;
    assert.equal(alias('module'), undefined);
    assert.equal(alias('worker_threads'), undefined);
    return 71;
  }, afterRevoke: () => { after = true; assert.equal(host.getBuiltinModule, denial); assert.equal(window.snapshot().revoked, true); } });
  assert.equal(result, 71); assert.equal(after, true);
  assert.throws(() => alias('module'), { code: 'BOOTSTRAP_REVOKED' });
  return { result, restoredBeforeCallback: true, capturedAliasRevoked: true };
});
await check('B-authentication-before-file-access', async () => {
  const view = { engine: 'just-bash', name: 'baseline-installed', consumerPath: profile.consumerPath, files: [] };
  assert.throws(() => authenticateBootstrap(view, 'file:///wrong', 'file:///expected', { baseline: { version: '3.4.2' } }), { code: 'BOOTSTRAP_PARENT' });
  assert.throws(() => authenticateBootstrap(view, 'file:///expected', 'file:///expected', { baseline: { version: '3.4.2' } }), { code: 'BOOTSTRAP_CONSUMER' });
  return { wrongParentAndMissingConsumerRejected: true };
});
const extras = JSON.parse(fs.readFileSync(path.join(work, 'EXTRAS.json')));
const workers = [];
for (const fixture of extras) {
  if (unsafe) { rows.push({ id: fixture.specimen.id, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  const receipt = await supervise(fixture.node, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'observer.mjs'), path.join(fixture.home, 'worker.mjs'), fixture.configPath, fixture.configSha256], fixture.output);
  save(fixture.specimen.id + '-RAW.json', receipt);
  workers.push(receipt);
  if (!receipt.reaped || !receipt.exit || !receipt.close || receipt.failures.length || receipt.signals.length) {
    unsafe = true; rows.push({ id: fixture.specimen.id, status: 'UNSAFE_STOP' }); continue;
  }
  await check(fixture.specimen.id, async () => {
    assert.equal(receipt.exit.code, 1); assert.equal(receipt.close.code, 1);
    for (const [name, encoded] of [['stdout', 'stdout'], ['stderr', 'stderr'], ['records', 'rawRecords']]) assert.equal(Buffer.from(receipt[encoded], 'base64').length, receipt.captureBytes[name]);
    const final = receipt.records.at(-1);
    assert.equal(final.kind, 'final'); assert.deepEqual(final.late, []);
    assert.equal(final.authorityMetadata.length, 2);
    assert.ok(final.authorityMetadata.every(row => row.reaped && row.status === 0));
    const kinds = receipt.records.map(row => row.kind);
    const observer = JSON.parse(fs.readFileSync(path.join(fixture.output, 'OBSERVER.json')));
    assert.deepEqual(observer.denied, []);
    assert.ok(observer.loaded.some(row => row.path === path.join(fixture.home, 'worker.mjs') && row.sha256 === fixture.bodySha256));
    if (fixture.specimen.id === 'X01') {
      assert.equal(final.fatal.code, 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
      assert.equal(kinds.includes('consumer-evaluated'), false);
      assert.ok(receipt.records.some(row => row.kind === 'bootstrap-denied' && row.code === 'BOOTSTRAP_REVOKED'));
    } else if (fixture.specimen.id === 'X02') {
      assert.ok(kinds.indexOf('consumer-evaluated') < kinds.indexOf('bootstrap-denied'));
      assert.ok(final.cleanupErrors.some(row => row.phase === 'bootstrap-close'));
    } else {
      assert.equal(final.fatal.message, 'STUB_GUARD_NOT_ACTIVE');
      assert.equal(kinds.includes('worker-offline-installed'), false);
      assert.ok(kinds.includes('nextLoad'));
    }
    return { bodySha256: fixture.bodySha256, loaded: observer.loaded.length, guardedLoads: receipt.records.filter(row => row.kind === 'nextLoad').length, kinds, authority: final.authorityMetadata };
  });
}
for (const count of [65536, 65537]) {
  if (unsafe) { rows.push({ id: `T-${count}`, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  const descriptors = Object.fromEntries(['stdout', 'stderr', 'records'].map(name => [name, fs.openSync(path.join(evidence, `T-${count}-${name}.raw`), 'wx')]));
  const outer = { stdout: 0, stderr: 0, records: 0 };
  let outerOver = false;
  const receipt = await supervise(inputs.node, [path.join(home, 'capture-child.mjs'), String(count)], evidence, { onSpawn(child) {
    for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'records']]) child.stdio[index].on('data', bytes => {
      outer[name] += bytes.length;
      if (outer[name] > 131072) { outerOver = true; child.kill('SIGKILL'); return; }
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(descriptors[name], bytes, offset, bytes.length - offset);
    });
  } });
  for (const descriptor of Object.values(descriptors)) { fs.fsyncSync(descriptor); fs.closeSync(descriptor); }
  save(`T-${count}-RAW.json`, { receipt, outer });
  if (outerOver || !receipt.reaped || !receipt.exit || !receipt.close) { unsafe = true; rows.push({ id: `T-${count}`, status: 'UNSAFE_STOP' }); continue; }
  await check(`T-${count}`, async () => {
    assert.equal(outer.stdout, count); assert.equal(outer.stdout, receipt.captureBytes.stdout);
    assert.equal(Buffer.from(receipt.stdout, 'base64').length, 65536);
    if (count === 65536) { assert.deepEqual(receipt.failures, []); assert.equal(receipt.natural, true); assert.equal(receipt.exit.code, 0); }
    else { assert.ok(receipt.failures.some(row => row.code === 'CAPTURE_LIMIT')); assert.equal(receipt.natural, false); assert.equal(assessTerminal(receipt, evidence), false); }
    return { innerObserved: receipt.captureBytes, innerRetained: 65536, outerRetained: outer, exactChildClosed: true, resultNotQualifiedByTruncation: count === 65537 };
  });
}
const result = { rows, workers: workers.map(row => ({ pid: row.pid, exit: row.exit, close: row.close, reaped: row.reaped })), pass: rows.filter(row => row.pass === true).length, fail: rows.filter(row => row.pass === false).length, unsafe, sourceOnlyBudgetClaimsRemainQualified: true };
save('RESULT.json', result);
process.stdout.write(JSON.stringify({ pass: result.pass, fail: result.fail, unsafe }) + '\n');
process.exitCode = unsafe || result.fail ? 1 : 0;
