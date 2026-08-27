import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chownSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = '/Users/kjopek/Workspace/safe-bash';
const owned = dirname(fileURLToPath(import.meta.url));
const commit = process.argv[2];
const output = resolve(process.argv[3] ?? '');
assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
assert.ok(output.startsWith('/tmp/safe-bash-stream-five-public-verifier.') || output.startsWith('/private/tmp/safe-bash-stream-five-public-verifier.'));
assert.equal(existsSync(output), false);
const gate = readFileSync('/tmp/safe-bash-stream-five-public-review.ready', 'utf8');
assert.ok(gate.includes(commit));
assert.match(gate, /2919/u);
assert.match(gate, /CLOSED/u);
assert.match(gate, /root/iu);
mkdirSync(output, { recursive: true });
const nativeReferenceGid = statSync(join(repository, 'tests/commands/metadata-stress')).gid;
assert.ok(process.getgroups().includes(nativeReferenceGid), 'native reference group must belong to the executing user');
const inheritedOutputGid = statSync(output).gid;
chownSync(output, process.getuid(), nativeReferenceGid);
const hash = data => createHash('sha256').update(data).digest('hex');
const node = realpathSync(process.execPath);
const npm = realpathSync(join(dirname(process.execPath), 'npm'));
const home = join(output, 'home');
mkdirSync(home);
const env = { PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: home, TMPDIR: output, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', npm_config_userconfig: join(home, 'user.npmrc'), npm_config_globalconfig: join(home, 'global.npmrc'), npm_config_cache: join(output, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
writeFileSync(env.npm_config_userconfig, '');
writeFileSync(env.npm_config_globalconfig, '');
const report = { started: new Date().toISOString(), commit, gate, gateSha256: hash(gate), node: process.version, nodeSha256: hash(readFileSync(node)), npm, npmSha256: hash(readFileSync(npm)), environment: env, steps: [], cases: [], failures: [] };
report.directoryGroupProfile = { uid: process.getuid(), gid: process.getgid(), groups: process.getgroups(), inheritedOutputGid, nativeReferenceGid, actualOutputGid: statSync(output).gid, scope: 'new owned isolated output directory only; original artifacts unchanged' };
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const profile = join(output, 'release-offline.sb');
const absoluteStat = '/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat';
writeFileSync(profile, `(version 1) (allow default) (deny network*) (deny file-write* (subpath ${JSON.stringify(repository)}) (subpath ${JSON.stringify(dirname(absoluteStat))}))\n`);
function run(label, executable, args, cwd = output, expected = 0, sandbox = true, timeout = 240000) {
  const result = spawnSync(sandbox ? '/usr/bin/sandbox-exec' : executable, sandbox ? ['-f', profile, executable, ...args] : args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const ordinal = String(report.steps.length + 1).padStart(2, '0');
  writeFileSync(join(output, `${ordinal}.stdout.log`), result.stdout ?? '');
  writeFileSync(join(output, `${ordinal}.stderr.log`), result.stderr ?? '');
  const record = { label, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, expected, stdout: `${ordinal}.stdout.log`, stderr: `${ordinal}.stderr.log` };
  report.steps.push(record);
  save('report.json', report);
  if (expected !== null) assert.equal(result.status, expected, `${label}: ${result.stderr}\n${result.stdout}`);
  return { ...record, output: result.stdout ?? '', errors: result.stderr ?? '' };
}
function manifest(root) {
  const entries = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else entries.push({ path: relative(root, filename), sha256: hash(readFileSync(filename)) });
    }
  };
  walk(root);
  return { sha256: hash(JSON.stringify(entries)), entries };
}
try {
  assert.equal(run('authenticate release source', '/usr/bin/git', ['--no-replace-objects', 'rev-parse', `${commit}^{commit}`], repository, 0, false).output.trim(), commit);
  report.harnessCommit = run('release harness HEAD', '/usr/bin/git', ['rev-parse', 'HEAD'], repository, 0, false).output.trim();
  const harnessPath = 'tests/integration/stream-five-public/verify-release.mjs';
  const committedHarness = run('authenticate exact outer-command verifier', '/usr/bin/git', ['show', `${report.harnessCommit}:${harnessPath}`], repository, 0, false).output;
  assert.equal(hash(committedHarness), hash(readFileSync(join(owned, 'verify-release.mjs'))));
  report.harnessSha256 = hash(committedHarness);
  const archive = join(output, 'source.tar');
  run('archive exact gated source', '/usr/bin/git', ['--no-replace-objects', 'archive', '--format=tar', `--output=${archive}`, commit], repository, 0, false);
  report.archiveSha256 = hash(readFileSync(archive));
  const authenticated = join(output, 'authenticated-workspace');
  mkdirSync(authenticated);
  run('extract authenticated workspace', '/usr/bin/tar', ['-xf', archive, '-C', authenticated]);
  assert.equal(statSync(join(authenticated, 'tests/commands/metadata-stress')).gid, nativeReferenceGid);
  const gitDirectory = join(authenticated, '.git');
  mkdirSync(join(gitDirectory, 'refs'), { recursive: true });
  cpSync(join(repository, '.git/objects'), join(gitDirectory, 'objects'), { recursive: true, dereference: true });
  writeFileSync(join(gitDirectory, 'HEAD'), commit + '\n');
  writeFileSync(join(gitDirectory, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
  run('authenticate detached isolated HEAD', '/usr/bin/git', ['rev-parse', 'HEAD'], authenticated);
  run('populate isolated index only', '/usr/bin/git', ['read-tree', commit], authenticated);
  report.authenticatedTrackedStatus = run('isolated committed files clean', '/usr/bin/git', ['status', '--short', '--untracked-files=no'], authenticated).output;
  assert.equal(report.authenticatedTrackedStatus, '');
  cpSync(join(repository, 'node_modules'), join(authenticated, 'node_modules'), { recursive: true, dereference: true });
  report.tooling = manifest(join(authenticated, 'node_modules'));
  save('tooling-manifest.json', report.tooling);
  const packageManifest = JSON.parse(readFileSync(join(authenticated, 'package.json')));
  assert.equal(packageManifest.scripts['verify:release:qualified'], 'node scripts/verify-qualified-release.mjs');
  for (const hook of ['preverify:release:qualified', 'postverify:release:qualified', 'prepack', 'prepare', 'postpack', 'preinstall', 'install', 'postinstall']) assert.equal(packageManifest.scripts[hook], undefined, `unexpected executable hook ${hook}`);
  report.packageSha256 = hash(readFileSync(join(authenticated, 'package.json')));
  report.authorHarness = manifest(join(authenticated, 'tests/plugins/stream-five-public'));
  report.releaseScriptSha256 = hash(readFileSync(join(authenticated, 'scripts/verify-qualified-release.mjs')));
  report.historical = manifest(join(authenticated, 'tests/commands/stream-next-stress/frozen'));
  report.historicalReleaseSha256 = hash(readFileSync(join(authenticated, 'tests/commands/stream-next-stress/evidence/final/release.json')));
  const canonical = await import(new URL(`file://${join(authenticated, 'tests/commands/metadata-stress/canonical-env/runner.mjs')}`));
  const originalPrimary = join(repository, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
  const assets = canonical.assets(originalPrimary);
  assert.equal(assets.length, 15);
  const copiedAssets = assets.filter(asset => asset.path !== absoluteStat);
  assert.equal(copiedAssets.length, 14);
  report.nativeAssets = assets.map(asset => ({ ...asset, exists: existsSync(asset.path), actualSha256: existsSync(asset.path) ? hash(readFileSync(asset.path)) : null }));
  save('native-assets.json', report.nativeAssets);
  const absent = report.nativeAssets.filter(asset => asset.actualSha256 !== asset.sha256);
  if (absent.length) {
    report.setupUnavailable = absent;
    throw new Error('NATIVE_SETUP_UNAVAILABLE: no qualification or product-pass count');
  }
  const beforeOriginals = report.nativeAssets.map(asset => ({ path: asset.path, sha256: asset.actualSha256 }));
  const omittedAsset = copiedAssets.find(asset => asset.path.endsWith('/src/chmod'));
  assert.ok(omittedAsset);
  for (const label of ['missing', 'wrong', 'positive']) {
    const overlay = join(output, label, 'oracle');
    const primary = join(overlay, 'coreutils-9.7');
    mkdirSync(primary, { recursive: true });
    for (const asset of copiedAssets) {
      const destination = join(overlay, relative(dirname(originalPrimary), asset.path));
      if (label === 'missing' && asset.path === omittedAsset.path) continue;
      mkdirSync(dirname(destination), { recursive: true });
      if (label === 'wrong' && asset.path === omittedAsset.path) writeFileSync(destination, 'INERT_WRONG_PIN_NOT_EXECUTABLE\n');
      else {
        copyFileSync(asset.path, destination);
        assert.equal(hash(readFileSync(destination)), asset.sha256);
        assert.equal(statSync(destination).mode & 0o111, statSync(asset.path).mode & 0o111);
      }
    }
    const args = [npm, 'run', 'verify:release:qualified', '--', '--source-commit', commit, '--native-assets-from', primary];
    const outer = run(`EXACT committed npm qualified release ${label}`, node, args, authenticated, null, false, 900000);
    const records = outer.output.split('\n').filter(line => line.startsWith('{')).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const runDirectory = records.find(record => record.directory)?.directory;
    assert.ok(runDirectory?.startsWith(join(realpathSync(authenticated), 'tests/plugins/stream-five-public/.runs/')));
    const releaseResult = JSON.parse(readFileSync(join(runDirectory, 'result.json')));
    const entry = { label, outer, directory: runDirectory, result: releaseResult };
    report.cases.push(entry);
    save(`${label}-result.json`, entry);
    for (const filename of readdirSync(runDirectory).filter(filename => filename.endsWith('.json'))) copyFileSync(join(runDirectory, filename), join(output, `${label}-${filename}`));
    assert.equal(releaseResult.sourceCommit, commit);
    assert.equal(releaseResult.sourceUnchanged, true);
    if (label !== 'positive') {
      assert.equal(outer.status, 78, `${label}: outer npm must propagate 78`);
      assert.equal(releaseResult.exitCode, 78);
      assert.equal(releaseResult.setup.executedTests, 0);
      assert.equal(releaseResult.steps.length, 0);
      assert.equal(releaseResult.metadata, undefined);
      assert.equal(releaseResult.stream, undefined);
      assert.ok(releaseResult.setup.issues.some(issue => issue.kind === (label === 'missing' ? 'unavailable' : 'identity-mismatch') && issue.path === join(primary, 'src/chmod')));
    } else {
      assert.equal(outer.status, 0, outer.errors + outer.output);
      assert.equal(releaseResult.exitCode, 0);
      assert.equal(releaseResult.canonicalSetup.assets.length, 15);
      assert.equal(releaseResult.nativeOverlay.length, 14);
      assert.deepEqual(releaseResult.metadata.counts, { tests: 318, pass: 318, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
      assert.equal(releaseResult.metadata.nativeRowsPassed, 22);
      assert.equal(releaseResult.stream.summary.distinctPrimaryInputs, 82);
      assert.equal(releaseResult.stream.summary.primary.executions, 164);
      assert.equal(releaseResult.stream.diagnosticSummary.strengthened, 164);
      assert.equal(releaseResult.stream.diagnosticSummary.strict, 124);
      report.currentStreamSummary = releaseResult.stream;
    }
  }
  assert.deepEqual(beforeOriginals, report.nativeAssets.map(asset => ({ path: asset.path, sha256: hash(readFileSync(asset.path)) })));
  assert.equal(hash(readFileSync(join(authenticated, 'tests/commands/stream-next-stress/evidence/final/release.json'))), report.historicalReleaseSha256);
  assert.equal(manifest(join(authenticated, 'tests/commands/stream-next-stress/frozen')).sha256, report.historical.sha256);
  report.status = 'qualified-positive-and-two-negative-controls-pass';
} catch (error) {
  report.status = report.setupUnavailable ? 'setup-unavailable-not-pass' : 'fail';
  report.failures.push({ message: error.message, stack: error.stack });
} finally {
  report.finished = new Date().toISOString();
  save('report.json', report);
  console.log(JSON.stringify({ status: report.status, commit, output, cases: report.cases.map(entry => ({ label: entry.label, exitCode: entry.outer.status })), failures: report.failures }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}
