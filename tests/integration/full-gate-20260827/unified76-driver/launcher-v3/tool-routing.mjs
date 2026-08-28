import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, realpathSync, symlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const inspector = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool-classic';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = error => Object.assign(new Error('declared tool route refused: ' + error.message), {exitCode: 78, cause: error});

export function toolRoutes() {
  const value = JSON.parse(readFileSync(join(directory, 'TOOL-ROUTES.json')));
  assert.equal(value.schema, 'unified76-tool-routes/1');
  assert.equal(value.candidate, 'f5e9fc49b6abb38e180cc9de16c95fced102ff75');
  assert.equal(value.inspector.origin, inspector);
  assert.equal(value.inspector.physical, inspector);
  assert.equal(value.inspector.bytes, 472320); assert.equal(value.inspector.mode, 0o755);
  assert.equal(value.inspector.sha256, '6beb1ad9c4fb7edafd59fddcb093f358f9a250bfe1db2db9f04ed1aacd523a69');
  assert.deepEqual(value.systemReferences, ['/usr/lib/libc++.1.dylib', '/usr/lib/libSystem.B.dylib']);
  assert.deepEqual(value.environment, {PATH: '/dev/null', LANG: 'C', LC_ALL: 'C', TZ: 'UTC'});
  assert.equal(value.git, git);
  assert.equal(value.gitCore, '/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core');
  assert.deepEqual(value.inspectionTargets, ['/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', git, '/usr/bin/tar', '/usr/bin/sandbox-exec']);
  assert.equal(value.aliases.git, git); assert.equal(value.aliases.node, value.inspectionTargets[0]);
  assert.deepEqual(Object.keys(value.aliases).sort(), ['node','git','sh','tar','ps','lsof','sw_vers','bsdtar','gzip','gunzip','bash','sed','awk','jq','curl','rev','expand','fold'].sort());
  return value;
}

function externalRecords() {
  const receipt = JSON.parse(readFileSync(join(directory, 'EXTERNAL-RECEIPT.json')));
  const encoded = readFileSync(join(directory, 'EXTERNAL.json.gz.base64'));
  assert.equal(digest(encoded), receipt.encodedSha256);
  const bytes = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), {maxOutputLength: 32 * 1024 * 1024});
  assert.equal(digest(bytes), receipt.sha256);
  return JSON.parse(bytes);
}

export function verifyToolFile(expected) {
  assert.equal(realpathSync(expected.origin), expected.physical, 'physical tool route changed');
  const before = lstatSync(expected.physical);
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.size, expected.bytes);
  assert.equal(before.mode & 0o777, expected.mode);
  assert.ok(before.size <= 256 * 1024 * 1024);
  const descriptor = openSync(expected.physical, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let total = 0;
  try {
    assert.equal(fstatSync(descriptor).ino, before.ino);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      total += count;
      assert.ok(total <= expected.bytes);
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.mode], [before.dev, before.ino, before.size, before.mtimeMs, before.mode]);
  } finally { closeSync(descriptor); }
  assert.equal(total, expected.bytes);
  assert.equal(hash.digest('hex'), expected.sha256, 'tool bytes changed before execution');
  assert.equal(lstatSync(expected.physical).ino, before.ino);
  return expected;
}

export function rejectToolSelection(environment) {
  for (const [key, value] of Object.entries(environment)) {
    if (value && (['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT', 'SDK_DIR', 'XCODE_DEVELOPER_DIR_PATH'].includes(key) || /^(?:xcrun_|DYLD_|LD_)/iu.test(key))) throw fail(new Error('ambient developer/loader selection: ' + key));
  }
}

export function verifyInspector(environment = process.env) {
  try {
    rejectToolSelection(environment);
    const routes = toolRoutes();
    assert.equal(process.platform, 'darwin');
    assert.equal(process.arch, 'arm64');
    verifyToolFile(routes.inspector);
    for (const path of routes.systemReferences) {
      let code;
      try { lstatSync(path); } catch (error) { code = error.code; }
      assert.equal(code, 'ENOENT', 'new readable library needs a separate exact binding');
    }
    const hostTool = externalRecords().tools.find(entry => entry.origin === '/usr/bin/sw_vers');
    verifyToolFile(hostTool);
    const host = spawnSync(hostTool.physical, [], {env: routes.environment, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.equal(host.status, 0); assert.equal(host.signal, null); assert.equal(host.error, undefined);
    assert.equal(host.stdout, JSON.parse(readFileSync(join(directory, 'OS-INSTRUCTION-FENCE.json'))).host);
    return {binary: routes.inspector, references: routes.systemReferences.map(path => ({tool: inspector, path, error: 'ENOENT'})), host: host.stdout, environment: routes.environment, qualification: 'Exact root-approved OS-metadata pairs; no library-file hash or full dynamic-image attestation.'};
  } catch (error) { throw fail(error); }
}

export function prepareInspection(origin, environment = process.env) {
  try {
    const routes = toolRoutes();
    assert.ok(routes.inspectionTargets.includes(origin), 'unlisted inspection target');
    const receipt = verifyInspector(environment);
    const expected = origin === '/usr/bin/sandbox-exec'
      ? {...JSON.parse(readFileSync(join(directory, 'OS-INSTRUCTION-FENCE.json'))).binary, origin, physical: origin}
      : externalRecords().tools.find(entry => entry.origin === origin);
    verifyToolFile(expected);
    return {executable: inspector, args: ['-L', origin], env: {...routes.environment}, receipt: {...receipt, target: expected, admittedAt: new Date().toISOString(), admittedBeforeExecution: true}};
  } catch (error) { throw fail(error); }
}

export function inspectLinkage(origin, environment = process.env) {
  const invocation = prepareInspection(origin, environment);
  const result = spawnSync(invocation.executable, invocation.args, {env: invocation.env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0 || result.signal || result.stderr) throw fail(new Error('direct dependency inspection failed: ' + (result.error?.message ?? result.stderr ?? result.status)));
  const expected = origin === '/usr/bin/sandbox-exec'
    ? JSON.parse(readFileSync(join(directory, 'OS-INSTRUCTION-FENCE.json'))).linkage
    : externalRecords().linkage.find(entry => entry.origin === origin).stdout;
  assert.equal(result.stdout, expected, 'linkage output changed or missing');
  return {stdout: result.stdout, stderr: result.stderr, status: result.status, pid: result.pid, signal: result.signal, invocation};
}

export function verifyGitClosure() {
  const expected = externalRecords().directories.gitCore;
  assert.equal(expected.origin, toolRoutes().gitCore);
  assert.equal(realpathSync(expected.origin), expected.root);
  const actualPaths = [];
  const checked = new Set();
  const checkFile = entry => {
    assert.equal(realpathSync(entry.origin), entry.physical);
    const key = JSON.stringify([entry.physical, entry.bytes, entry.mode, entry.sha256]);
    if (!checked.has(key)) { verifyToolFile(entry); checked.add(key); }
  };
  const visit = local => {
    const path = join(expected.root, local);
    const stat = lstatSync(path);
    actualPaths.push(local);
    const entry = expected.entries.find(row => row.path === local);
    assert.ok(entry, 'unbound Git helper entry: ' + local);
    assert.equal(stat.mode & 0o777, entry.mode);
    if (stat.isSymbolicLink()) {
      assert.equal(entry.kind, 'symlink'); assert.equal(readlinkSync(path), entry.target); assert.equal(realpathSync(path), entry.physical);
      if (entry.targetFile) checkFile(entry.targetFile);
    } else if (stat.isDirectory()) {
      assert.equal(entry.kind, 'directory');
      for (const name of readdirSync(path).sort()) visit(local === '.' ? name : local + '/' + name);
    } else { assert.equal(entry.kind, 'file'); checkFile(entry); }
  };
  visit('.');
  assert.deepEqual(actualPaths.sort(), expected.entries.map(entry => entry.path).sort());
  return {origin: expected.origin, entries: actualPaths.length, sha256: expected.sha256};
}

export function createToolPath(parent) {
  const routes = toolRoutes();
  const records = externalRecords();
  const closure = verifyGitClosure();
  const aliases = Object.entries(routes.aliases).map(([name, origin]) => {
    assert.match(name, /^[a-z][a-z_]*$/u);
    const expected = records.tools.find(entry => entry.origin === origin);
    assert.ok(expected && expected.mode & 0o111, 'PATH alias lacks existing executable admission: ' + name);
    assert.ok(!routes.deniedSelectorExecutables.includes(origin), 'selector may not be a PATH route');
    verifyToolFile(expected);
    return {name, ...expected};
  });
  const path = join(realpathSync(parent), 'tool-bin');
  mkdirSync(path, {mode: 0o700});
  for (const entry of aliases) symlinkSync(entry.physical, join(path, entry.name));
  const stat = lstatSync(path);
  return {path, device: stat.dev, inode: stat.ino, aliases, gitCore: closure, qualification: 'Finite declared aliases only; no ambient/system/developer-directory PATH fallback.'};
}

function verifyNativePath(root) {
  const records = externalRecords();
  assert.equal(realpathSync(root), root);
  const files = new Map(records.native.assets.filter(entry => entry.target?.startsWith('native:')).map(entry => [entry.target.slice(7), entry]));
  const directories = new Set(['.']);
  for (const path of files.keys()) for (let parent = dirname(path); parent !== '.'; parent = dirname(parent)) directories.add(parent);
  const visit = local => {
    const path = join(root, local), stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), 'native PATH entries must not become aliases');
    if (stat.isDirectory()) {
      assert.ok(directories.has(local), 'unbound native PATH directory: ' + local);
      for (const name of readdirSync(path)) visit(local === '.' ? name : local + '/' + name);
    } else {
      const asset = files.get(local);
      assert.ok(asset, 'unbound native PATH entry: ' + local);
      const expected = records.tools.find(entry => entry.origin === asset.origin);
      assert.ok(expected && expected.sha256 === asset.sha256);
      verifyToolFile({...expected, origin: path, physical: path, mode: asset.mode});
    }
  };
  visit('.');
}

export function verifyToolPath(binding, environment, nativeRoot) {
  rejectToolSelection(environment);
  const stat = lstatSync(binding.path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.deepEqual([stat.dev, stat.ino, stat.mode & 0o777], [binding.device, binding.inode, 0o700]);
  assert.equal(realpathSync(binding.path), binding.path);
  assert.deepEqual(readdirSync(binding.path).sort(), binding.aliases.map(entry => entry.name).sort());
  assert.equal(environment.PATH, [nativeRoot, binding.path].filter(Boolean).join(':'));
  assert.equal(environment.GIT_EXEC_PATH, binding.gitCore.origin);
  if (nativeRoot) verifyNativePath(nativeRoot);
  for (const entry of binding.aliases) {
    const path = join(binding.path, entry.name);
    assert.ok(lstatSync(path).isSymbolicLink());
    assert.equal(readlinkSync(path), entry.physical); verifyToolFile(entry);
  }
  assert.deepEqual(verifyGitClosure(), binding.gitCore);
  return true;
}

const inheritedKeys = ['PATH', 'GIT_EXEC_PATH', 'GIT_OPTIONAL_LOCKS'];
let inheritedOwner;
let inheritedPoison;

function requireInheritedIdle() {
  if (inheritedPoison) throw Object.assign(new Error('inherited helper environment is poisoned'), {exitCode: 78, cause: inheritedPoison});
  assert.equal(inheritedOwner, undefined, 'inherited helper environment already owned');
}

function environmentDifferences(actual, expected) {
  return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort().filter(key =>
    Object.hasOwn(actual, key) !== Object.hasOwn(expected, key) || actual[key] !== expected[key]);
}

export function createInheritedHelperRoute(binding, environment, nativeRoot) {
  const records = [];
  return {records, assertIdle: requireInheritedIdle, async run(label, callback) {
    requireInheritedIdle();
    assert.ok(['prerequisites', 'private-final-sweep', 'private-finally'].includes(label));
    assert.equal(typeof callback, 'function');
    rejectToolSelection(process.env);
    for (const [key, value] of Object.entries(process.env)) {
      if (value && (key === 'NODE_OPTIONS' || key === 'NODE_PATH' || key.startsWith('GIT_'))) throw fail(new Error('ambient loader/Git injection refused: ' + key));
    }
    assert.equal(environment.GIT_OPTIONAL_LOCKS, '0');
    verifyToolPath(binding, environment, nativeRoot);
    assert.equal(readdirSync(nativeRoot).includes('git'), false, 'native PATH must not shadow admitted Git');
    const installed = Object.fromEntries(inheritedKeys.map(key => [key, environment[key]]));
    assert.ok(Object.values(installed).every(value => typeof value === 'string'));
    const resolvedGit = realpathSync(join(binding.path, 'git'));
    assert.equal(resolvedGit, git);
    const target = process.env, before = {...target}, expected = {...before, ...installed};
    const owner = {};
    const record = {label, installed, resolvedGit, gitSha256: binding.aliases.find(entry => entry.name === 'git').sha256,
      failures: [], restored: false, poisoned: false,
      qualification: 'Exclusive cooperating worker scope only; callback settlement is not detached-child closure or a kernel exec trace.'};
    const failures = [];
    const retain = (stage, error) => {
      failures.push({stage, error});
      record.failures.push({stage, name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error)});
    };
    let value;
    inheritedOwner = owner;
    records.push(record);
    try {
      for (const key of inheritedKeys) target[key] = installed[key];
      assert.equal(process.env, target, 'environment object changed during installation');
      assert.deepEqual(environmentDifferences(target, expected), [], 'inherited environment installation drift');
      try { value = await callback(); } catch (error) { retain('callback', error); }
    } catch (error) { retain('installation', error); }
    finally {
      try {
        assert.equal(process.env, target, 'environment object changed during helper');
        assert.deepEqual(environmentDifferences(target, expected), [], 'inherited helper environment drift');
      } catch (error) { retain('drift', error); }
      for (const key of inheritedKeys) {
        try {
          if (Object.hasOwn(before, key)) target[key] = before[key];
          else delete target[key];
        } catch (error) { retain('restore:' + key, error); }
      }
      try {
        assert.equal(process.env, target, 'environment object not restored');
        assert.deepEqual(environmentDifferences(target, before), [], 'inherited helper environment not restored');
        record.restored = true;
      } catch (error) { retain('restore-verification', error); }
      record.poisoned = !record.restored || failures.some(entry => entry.stage.startsWith('restore:'));
      if (record.poisoned) inheritedPoison = new AggregateError(failures.map(entry => entry.error), 'inherited helper restoration failed');
      else inheritedOwner = undefined;
    }
    record.status = failures.length ? 'failed' : 'returned';
    if (failures.length === 1) throw failures[0].error;
    if (failures.length) throw Object.assign(new AggregateError(failures.map(entry => entry.error), 'inherited helper callback/guard failures'), {failures, exitCode: 78});
    return value;
  }};
}
