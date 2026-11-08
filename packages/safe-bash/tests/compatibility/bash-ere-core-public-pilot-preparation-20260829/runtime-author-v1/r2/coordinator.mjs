import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureBudget, writer, schedule, judgeCell, validateGrant, describe, ledger } from './core.mjs';
import { ownChild } from '../process-owner.mjs';
import { finalizeInvocation } from './finalization.mjs';
import { read, hash, bind, archiveAdmission, census, verifyPackage, copyRows } from '../data.mjs';

export const retainedInvocations = new Set();

export async function main(argv) {
  const outerCapture = captureBudget(1048576);
  const startup = writer({ maximum: 524288, aggregate: outerCapture, write: (bytes, offset, count) => fs.writeSync(1, bytes, offset, count) });
  startup.bytes(Buffer.from(JSON.stringify({ event: 'coordinator-startup', pid: process.pid, execPath: process.execPath }) + '\n'));
  const [profilePath, profileHash, grantPath, grantHash, startText] = argv;
  const started = Number(startText);
  const now = () => Number(process.hrtime.bigint() / 1000000n);
  assert(Number.isSafeInteger(started) && started >= 0 && started <= now());
  const profileBytes = read(profilePath);
  assert.equal(hash(profileBytes), profileHash);
  const profile = JSON.parse(profileBytes);
  const grantBytes = read(grantPath, 16384);
  assert.equal(hash(grantBytes), grantHash);
  const grant = JSON.parse(grantBytes);
  validateGrant(grant, profileHash, started, Date.now());
  assert.equal(process.execPath, profile.node.path);
  assert(!fs.existsSync(profile.root), 'fresh future root required');
  for (const row of profile.assets) bind(row);
  for (const row of profile.tools) bind(row);
  bind(profile.archive);
  archiveAdmission(profile.archive, read(profile.archive.path, 909885));
  fs.mkdirSync(profile.root, { recursive: false });
  const descriptors = [];
  const ownership = [];
  const ownerRoot = { ownership };
  retainedInvocations.add(ownerRoot);
  let emergencyJournal;
  return await finalizeInvocation({
    descriptors, ownership, retained: retainedInvocations, ownerRoot, close: fs.closeSync,
    emergency: row => { assert(emergencyJournal, 'journal unavailable'); return emergencyJournal(row); },
    report: row => startup.bytes(Buffer.from(JSON.stringify(row) + '\n')),
    run: async failures => {
  const aggregate = captureBudget(56 * 1024 * 1024);
  const journalDescriptor = fs.openSync(path.join(profile.root, 'EMERGENCY.jsonl'), 'wx', 0o600);
  descriptors.push(journalDescriptor);
  const normalJournal = writer({ maximum: 524288, aggregate, write: (bytes, offset, count) => fs.writeSync(journalDescriptor, bytes, offset, count) });
  const emergency = writer({ maximum: 524288, aggregate, write: (bytes, offset, count) => fs.writeSync(journalDescriptor, bytes, offset, count) });
  const journal = row => normalJournal.bytes(Buffer.from(JSON.stringify(row) + '\n'));
  emergencyJournal = row => emergency.bytes(Buffer.from(JSON.stringify(row) + '\n'));
  const native = { open: file => fs.openSync(file, 'wx', 0o600), close: descriptor => fs.closeSync(descriptor), write: fs.writeSync, spawn, later: setTimeout, cancel: clearTimeout };
  let childStarts = 0;
  let live = false;
  let immutable = null;
  const configRows = [];
  const boundRuntime = () => { for (const row of profile.assets) bind(row); for (const row of configRows) bind(row); for (const layout of profile.layouts) verifyPackage(layout.packageRoot, layout.shipping); };
  const sample = () => {
    assert(!live && ownership.every(row => row.receipt.retired), 'no census during UNKNOWN/native ownership');
    assert(Date.now() < Date.parse(grant.expiresAt), 'grant expired');
    const snapshot = census(profile.root);
    assert(snapshot.bytes + profile.retainedInputBytes <= 256 * 1024 * 1024, 'observed logical excess STOP');
    if (immutable) {
      const actual = snapshot.rows.filter(row => !row.path.startsWith('captures/') && row.path !== 'captures' && !['EMERGENCY.jsonl', 'FINAL.json'].includes(row.path));
      assert.deepEqual(actual, immutable, 'quiescent tree changed');
      boundRuntime();
    }
    return snapshot;
  };
  const runNative = async spec => {
    assert(!live && childStarts < 26);
    childStarts++; live = true;
    let receipt;
    try { receipt = await ownChild(spec, native, ownership, aggregate); } finally { live = false; }
    journal({ event: 'native-receipt', ...receipt });
    return receipt;
  };
  const result = await schedule(profile, {
      failures, started, now, sample,
      prepare: async timer => {
        fs.mkdirSync(path.join(profile.root, 'captures'));
        fs.writeFileSync(path.join(profile.root, 'user.npmrc'), '', { flag: 'wx' });
        fs.writeFileSync(path.join(profile.root, 'global.npmrc'), '', { flag: 'wx' });
        for (const layout of profile.layouts) {
          assert(timer.admit(layout.name === 'source-built' ? 10000 : 60000));
          fs.mkdirSync(layout.origin, { recursive: true });
          fs.writeFileSync(path.join(layout.origin, 'package.json'), layout.consumerManifest, { flag: 'wx', mode: 0o600 });
          if (layout.name === 'source-built') copyRows(layout.source, path.join(layout.origin, 'node_modules/virtual-bash'), layout.shipping);
          else {
            for (const name of ['cache', 'tmp', 'home']) fs.mkdirSync(path.join(layout.nativeRoot, name), { recursive: true });
            bind(profile.archive); archiveAdmission(profile.archive, read(profile.archive.path, 909885));
            const spec = { id: `install-${layout.name}`, executable: profile.node.path, argv: [profile.npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false', '--package-lock=false', `--userconfig=${path.join(profile.root, 'user.npmrc')}`, `--globalconfig=${path.join(profile.root, 'global.npmrc')}`], cwd: layout.origin, env: { PATH: path.dirname(profile.node.path), HOME: path.join(layout.nativeRoot, 'home'), TMPDIR: path.join(layout.nativeRoot, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: path.join(layout.nativeRoot, 'cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false' }, milliseconds: 60000, capture: 1048576, stdout: path.join(profile.root, 'captures', `install-${layout.name}.stdout`), stderr: path.join(profile.root, 'captures', `install-${layout.name}.stderr`) };
            const receipt = await runNative(spec);
            assert(receipt.retired && !receipt.failure.present && receipt.code === 0 && receipt.signal === null, 'installer incomplete');
            assert(census(layout.nativeRoot).bytes <= 33554432, 'observed native mutable reservation exceeded');
            sample();
          }
          if (layout.name === 'moved') { assert(!fs.existsSync(layout.app)); fs.renameSync(layout.origin, layout.app); assert(!fs.existsSync(layout.origin)); }
          configRows.push({ path: path.join(layout.app, 'package.json'), size: Buffer.byteLength(layout.consumerManifest), mode: 0o600, sha256: hash(Buffer.from(layout.consumerManifest)) });
          for (const row of profile.cellAssets) { const target = path.join(layout.app, path.basename(row.path)); fs.copyFileSync(row.path, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, row.mode); configRows.push({ ...row, path: target }); }
          fs.mkdirSync(path.join(layout.app, 'cells'));
          for (const cell of profile.cells.filter(row => row.layout === layout.name)) {
            const spec = { id: cell.id, definition: cell.definition, limits: cell.inheritedLimits, node: profile.node.path, modulePath: path.join(layout.packageRoot, cell.publicEntry), workerPath: path.join(layout.packageRoot, 'dist/commands/regex-execution/ere/transport/worker-entry.js') };
            const bytes = Buffer.from(JSON.stringify(spec) + '\n');
            assert.equal(hash(bytes), cell.configSha256, 'presealed future config bytes');
            fs.writeFileSync(cell.config, bytes, { flag: 'wx', mode: 0o600 });
            configRows.push({ path: cell.config, size: bytes.length, mode: 0o600, sha256: hash(bytes) });
          }
          verifyPackage(layout.packageRoot, layout.shipping);
        }
        bind(profile.archive);
        immutable = sample().rows.filter(row => !row.path.startsWith('captures/') && row.path !== 'captures' && !['EMERGENCY.jsonl', 'FINAL.json'].includes(row.path));
        boundRuntime();
      },
      run: async (cell, timer) => {
        assert(timer.admit(10000));
        const config = configRows.find(row => row.path === cell.config);
        const spec = { id: cell.id, executable: profile.node.path, argv: ['--permission', `--allow-fs-read=${cell.app}`, '--allow-worker', path.join(cell.app, 'cell.mjs'), cell.config, config.sha256], cwd: cell.app, env: { PATH: path.dirname(profile.node.path), HOME: cell.app, TMPDIR: cell.app, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, milliseconds: 10000, capture: 65536, stdout: cell.stdout, stderr: cell.stderr };
        const receipt = await runNative(spec);
        if (!receipt.retired) return { id: cell.id, status: 'UNKNOWN', receipt };
        try { const rows = read(cell.stdout, 65536).toString('utf8').trimEnd().split('\n').map(JSON.parse); const outcome = judgeCell(cell, receipt, rows); return outcome; }
        catch (reason) { return { id: cell.id, status: 'FAIL', receipt, failure: { present: true, reason: describe(reason) }, qualification: 'no Worker retirement inferred from process closure' }; }
      },
      publish: async value => {
        for (const row of profile.tools) bind(row);
        const bytes = Buffer.from(JSON.stringify({ ...value, childStarts, capture: aggregate.snapshot(), sampledLogical: sample().bytes, qualification: 'sampled/quiescent, non-atomic, not OS quota or peak proof' }, null, 2) + '\n');
        assert(bytes.length <= 1048576); aggregate.reserve(bytes.length);
        fs.writeFileSync(path.join(profile.root, 'FINAL.json'), bytes, { flag: 'wx', mode: 0o600 });
        sample(); startup.bytes(Buffer.from(JSON.stringify({ event: 'complete', complete: value.complete, childStarts }) + '\n'));
      },
      emergency: async value => emergencyJournal({ event: 'partial-final', ...value }),
    });
  process.exitCode = result.complete ? 0 : 1;
  return { result, ownership };
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(reason => { process.exitCode = 1; const bytes = Buffer.from(JSON.stringify({ event: 'bootstrap-or-owner-failure', present: true, reason: describe(reason) }) + '\n'); const failures = ledger(); failures.add(reason, 'bootstrap'); try { fs.writeSync(2, bytes); } catch (secondary) { failures.add(secondary, 'bootstrap-failure-publication'); } });
}
