import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { constants, lstatSync, realpathSync, mkdirSync, openSync, fstatSync, writeFileSync, closeSync, chmodSync, utimesSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireReady, sha256 } from './binding.mjs';
import { compareObservation } from './module-adapter.mjs';
import { authenticateFixture } from './fixture-data.mjs';

export const gitPath = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
export const gitSha256 = '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9';
export const supervisorSha256 = '3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08';
export function nativeRecipe(root, row) {
  assert.ok(root.startsWith('/') && !root.includes('\0'));
  const empty = join(root, 'empty');
  const settings = [
    `core.hooksPath=${join(empty, 'hooks')}`, 'core.fsmonitor=false',
    `core.attributesFile=${join(empty, 'attributes')}`, `core.excludesFile=${join(empty, 'excludes')}`,
    'core.autocrlf=false', 'core.filemode=false', 'core.quotePath=true', 'core.pager=',
    'core.untrackedCache=false', 'core.preloadIndex=false', 'core.useReplaceRefs=false',
    'diff.autoRefreshIndex=false', 'diff.renames=false', 'diff.external=',
    'diff.ignoreSubmodules=none', 'color.ui=false', 'color.status=false', 'color.diff=false',
    'log.showSignature=false', 'log.decorate=false', 'gc.auto=0', 'maintenance.auto=false',
    'credential.helper=', 'credential.interactive=false', 'protocol.allow=never',
  ];
  const commonArgs = ['--no-pager', ...settings.flatMap(setting => ['-c', setting])];
  const securityArgs = row.args[0] === 'diff' || row.args[0] === 'show' ? ['--no-ext-diff', '--no-textconv'] : [];
  return {
    id: row.id, executable: gitPath, executableSha256: gitSha256,
    semanticArgs: [...row.args], commonArgs, securityArgs,
    args: [...commonArgs, row.args[0], ...securityArgs, ...row.args.slice(1)], cwd: join(root, 'repo'),
    env: {
      PATH: join(empty, 'bin'), HOME: join(empty, 'home'), XDG_CONFIG_HOME: join(empty, 'xdg'),
      GIT_CONFIG_GLOBAL: join(empty, 'global.config'), GIT_CONFIG_SYSTEM: join(empty, 'system.config'),
      GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_COUNT: '0',
      GIT_CEILING_DIRECTORIES: root, GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
      GIT_EXEC_PATH: join(empty, 'git-core'), GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0',
      LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'),
    },
    timeoutMs: 10000, maxOutputBytes: 65536, observeSockets: false, ipc: false,
    stdout: join(root, 'capture', 'stdout.bin'), stderr: join(root, 'capture', 'stderr.bin'),
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: false,
  };
}
function regularDirectory(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(realpathSync(path), path);
  assert.equal(stat.uid, process.getuid());
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid };
}
function newFile(path, bytes, mode) {
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    const stat = fstatSync(descriptor);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid());
    writeFileSync(descriptor, bytes);
  } finally { closeSync(descriptor); }
  chmodSync(path, mode);
}
function captureBytes(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && stat.size <= 65536, 'owned bounded regular capture');
    const bytes = readFileSync(descriptor);
    assert.equal(bytes.length, stat.size);
    return bytes;
  } finally { closeSync(descriptor); }
}
function snapshot(root) {
  const entries = [];
  const visit = relative => {
    const absolute = join(root, relative);
    const stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink() && stat.uid === process.getuid());
    if (stat.isDirectory()) {
      if (relative) entries.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
      for (const name of readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile() && stat.nlink === 1);
      const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try {
        const opened = fstatSync(descriptor);
        assert.equal(opened.dev, stat.dev); assert.equal(opened.ino, stat.ino); assert.equal(opened.nlink, 1);
        bytes = readFileSync(descriptor);
      } finally { closeSync(descriptor); }
      entries.push({ path: relative, type: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) });
    }
  };
  visit('');
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function stage(root, records) {
  for (const directory of ['repo', 'empty', 'tmp', 'capture']) mkdirSync(join(root, directory), { mode: 0o700 });
  for (const directory of ['bin', 'home', 'xdg', 'hooks', 'git-core']) mkdirSync(join(root, 'empty', directory), { mode: 0o700 });
  for (const file of ['global.config', 'system.config', 'attributes', 'excludes']) newFile(join(root, 'empty', file), Buffer.alloc(0), 0o600);
  for (const directory of [...records.directories].sort((left, right) => left.path.split('/').length - right.path.split('/').length)) {
    mkdirSync(join(root, 'repo', directory.path), { mode: directory.mode });
    chmodSync(join(root, 'repo', directory.path), directory.mode);
  }
  for (const file of records.files) {
    const bytes = Buffer.from(file.base64, 'base64');
    assert.equal(sha256(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    newFile(join(root, 'repo', file.path), bytes, file.mode);
    utimesSync(join(root, 'repo', file.path), 946684800, 946684800);
  }
  assert.deepEqual(snapshot(join(root, 'repo')), records.tree);
}
export function acceptSupervisor(receipt) {
  assert.equal(receipt.status, 0, 'late PASS cannot override nonzero child');
  assert.equal(receipt.signal, null);
  for (const key of ['closed', 'captureClosed', 'survivorsKnown', 'teardownAttempted', 'clean']) assert.equal(receipt[key], true, key);
  assert.equal(receipt.observability, 'FINAL_SNAPSHOT_OBSERVED');
  assert.equal(receipt.faultCount, 0);
  assert.deepEqual(receipt.faults, []); assert.equal(receipt.spawnError, undefined); assert.equal(receipt.observerError, undefined);
  assert.equal(receipt.timedOut, false); assert.equal(receipt.outputExceeded, false);
  assert.deepEqual(receipt.survivors, []); assert.deepEqual(receipt.signals, []);
  assert.equal(receipt.cleanupAllowanceMs, 5000);
  assert.deepEqual(receipt.captures, [{ label: 'stdout', closed: true }, { label: 'stderr', closed: true }]);
  assert.ok(Number.isSafeInteger(receipt.outputBytes) && receipt.outputBytes >= 0 && receipt.outputBytes <= 65536);
}
export async function runNative(packetBytes, go, bridge, records, preparationSha256) {
  requireReady(Buffer.isBuffer(packetBytes), 'native packet missing');
  requireReady(go?.action === 'ROOT_GIT_NATIVE_SIX_EXECUTE' && typeof go.authorization === 'string' && go.authorization.length >= 16 && !/template|placeholder|example/i.test(go.authorization), 'separate fresh native ROOT GO');
  requireReady(go.packetSha256 === sha256(packetBytes) && go.preparationSha256 === preparationSha256 && /^[a-f0-9]{64}$/.test(preparationSha256), 'native packet/preseal binding');
  const packet = JSON.parse(packetBytes);
  authenticateFixture(records);
  requireReady(packet.schema === 'git-native-six-for-preparation-v3' && packet.fixtureSha256 === records.records.fixture.sha256 && packet.treeSha256 === records.treeSha256, 'immutable six fixture binding');
  requireReady(packet.recordsSha256 === sha256(JSON.stringify(records)), 'exact metadata data binding');
  assert.deepEqual(packet.ids, ['A01', 'A02', 'A03', 'A04', 'A05', 'A06']);
  requireReady(packet.gitPath === gitPath && packet.gitSha256 === gitSha256 && packet.supervisorSha256 === supervisorSha256, 'historical exact Git/H11 identities');
  requireReady(packet.gitCoreSha256 === records.historicalTools.gitCore.sha256 && packet.gitCoreEntries === 197 && packet.inspectorSha256 === records.historicalTools.inspector.sha256, 'historical core/inspector identities');
  requireReady(packet.gitCorePath === records.historicalTools.gitCore.origin && packet.inspectorPath === records.historicalTools.inspector.physical, 'exact core/direct inspector routes');
  const node = records.historicalTools.selected.find(tool => tool.physical.endsWith('/bin/node'));
  const observer = records.historicalTools.selected.find(tool => tool.physical === '/bin/ps');
  requireReady(packet.nodePath === node.physical && packet.nodeSha256 === node.sha256 && packet.observerPath === observer.physical && packet.observerSha256 === observer.sha256, 'exact historical Node/observer routes; changed tools need new preparation');
  requireReady(packet.nativeVersion && packet.nodePath && packet.nodeSha256 && packet.toolRevalidationReceiptSha256 && packet.helperClosureSha256 && packet.collectorQualificationSha256, 'future exact version/Node/tool/collector revalidation metadata');
  requireReady(packet.fence && packet.fence.network === 'DENY_ALL' && packet.fence.repositoryWrites === 'DENY_ALL' && packet.fence.exec === 'EXACT_GIT_ONLY' && /^[a-f0-9]{64}$/.test(packet.fence.qualificationSha256), 'new root-specific OS fence/role qualification missing; old write fence is insufficient');
  requireReady(bridge && typeof bridge.runH11 === 'function' && typeof bridge.revalidate === 'function', 'source-bound qualified H11 bridge missing');
  requireReady(sha256(Function.prototype.toString.call(bridge.runH11)) === packet.runH11FunctionSha256 && sha256(Function.prototype.toString.call(bridge.revalidate)) === packet.revalidateFunctionSha256, 'exact bridge function bodies');
  requireReady(packet.bridgeClosureSha256 === go.bridgeClosureSha256 && /^[a-f0-9]{64}$/.test(packet.bridgeClosureSha256), 'ROOT-authenticated bridge import closure');
  const directory = dirname(fileURLToPath(import.meta.url));
  requireReady(directory === '/Users/kjopek/Workspace/safe-bash/tests/commands/git-independent-20260828/preparation-v3', 'owned preparation location only');
  const owner = regularDirectory(directory);
  await bridge.revalidate(packet);
  const receipts = [];
  for (const row of records.workflows) {
    assert.deepEqual(regularDirectory(directory), owner, 'parent takeover');
    const root = resolve(directory, `native-${row.id}-${randomUUID()}`);
    mkdirSync(root, { mode: 0o700 });
    const identity = regularDirectory(root);
    stage(root, records);
    const recipe = nativeRecipe(root, row), before = snapshot(root);
    let receipt, failure, failed = false;
    try {
      receipt = await bridge.runH11(recipe, packet);
      acceptSupervisor(receipt);
      assert.deepEqual(regularDirectory(root), identity, 'root takeover');
      const actual = { exitCode: receipt.status, stdout: captureBytes(recipe.stdout), stderr: captureBytes(recipe.stderr), cwd: row.cwd, env: row.env, tree: snapshot(recipe.cwd) };
      assert.equal(receipt.cwd, recipe.cwd); assert.deepEqual(receipt.args, recipe.args); assert.equal(receipt.executable, recipe.executable);
      compareObservation(row, actual, records.tree);
      const after = snapshot(root);
      assert.deepEqual(after.filter(entry => !['capture/stdout.bin', 'capture/stderr.bin'].includes(entry.path)), before, 'append-aware full scratch baseline');
      receipts.push({ id: row.id, root, recipe, receipt, stdoutBase64: actual.stdout.toString('base64'), stderrBase64: actual.stderr.toString('base64'), after });
    } catch (error) { failure = error; failed = true; }
    if (failed) throw failure;
  }
  return receipts;
}
