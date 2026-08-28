import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../../..');
const prefix = 'tests/commands/yq-independent-20260828/';
const ownRelative = prefix + 'candidate-35da1854-build-v1/';
const packetRelative = prefix + 'candidate-35da1854-v1/';
const packet = join(repository, packetRelative);
const consumerRelative = prefix + 'executor-preparation-v1/consumers-v2/';
const consumer = join(repository, consumerRelative);
const commits = Object.freeze({
  packet: '71a16afd5b430175180fc4741531b75c31b25882', source: '35da18547ca82a67be9ca22b4adc21e3b8060780',
  evidence: 'ef6032b210feb5cf19e6f6f94c40413740bef335', handoff: 'bcec1ead34aee37c8fe574b248a8242ad4f60cfa',
  baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290', length: '74361026502d76b8c2b696f9c60e410ac9b78d95',
  compositionReview: '7ed356ade4509e492e15615587408eb4b41f92e0', runtimeReview: '6af0eb2d627f3ed80255c295b79299708436d372',
  consumers: '90c4c50070334a34c1b75d78f7da25d302f6bb61', runtimeSource: '7add5d2c0a3acb27483ba0bb5dd52385812d8ed7',
  runtimeEvidence: '70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e', integrationSource: '4fafd93a2a414fe9ce1965f77ab45da1d417d10a',
  integrationEvidence: '83035d641c415019ac62a0d0114cf2836ba77e45',
});
const packetSealHash = '979cacf27eae6d3fc46980d35df17f8135274a4441f1d08d1f2768907b4cced3';
const consumerSealHash = '69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b';
const expectedPackageHash = '2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? JSON.stringify(value.map(entry => JSON.parse(canonical(entry)))) : value && typeof value === 'object' ? JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))) : JSON.stringify(value);
const equal = (actual, expected, label) => assert.equal(canonical(actual), canonical(expected), label);
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { maxBuffer: 64 * 1024 * 1024, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', LANG: 'C', LC_ALL: 'C' } });
const gitBytes = (revision, path) => git('show', `${revision}:${path}`);
const json = path => JSON.parse(readFileSync(path));
const descriptor = (bytes, mode = 420) => ({ sha256: hash(bytes), bytes: bytes.length, mode });

function regularFile(path, maximum = 16 * 1024 * 1024) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= maximum, `REGULAR: ${path}`);
  assert.equal(realpathSync(path), resolve(path), `CANONICAL: ${path}`);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  assert.equal(after.ino, stat.ino); assert.equal(after.dev, stat.dev); assert.equal(after.mode, stat.mode);
  assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(bytes.length, stat.size);
  return { bytes, identity: descriptor(bytes, stat.mode & 4095) };
}

function patchBytes(name, bytes) {
  assert(!name.includes('/') && !existsSync(join(own, name)), `NO_OVERWRITE: ${name}`);
  const text = bytes.toString('utf8');
  assert(Buffer.from(text).equals(bytes), 'RAW_UTF8');
  const lines = text.length ? text.replace(/\n$/u, '').split('\n').map(line => '+' + line).join('\n') + '\n' : '';
  execFileSync('apply_patch', [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${ownRelative}${name}\n${lines}*** End Patch\n`, maxBuffer: 1024 * 1024 });
  assert(readFileSync(join(own, name)).equals(bytes), `EXACT_PATCH_BYTES: ${name}`);
  return { path: join(own, name), ...descriptor(bytes) };
}

const patchJson = (name, value, compact = false) => patchBytes(name, Buffer.from(JSON.stringify(value, null, compact ? undefined : 2) + '\n'));

async function authenticate() {
  assert.equal(repository, '/Users/kjopek/Workspace/safe-bash');
  for (const revision of Object.values(commits)) assert.equal(git('rev-parse', `${revision}^{commit}`).toString().trim(), revision);
  const bindings = [];
  const bind = (revision, path, expectedHash) => {
    const bytes = gitBytes(revision, path);
    assert.equal(hash(bytes), expectedHash, `GIT_BINDING: ${path}`);
    const live = regularFile(join(repository, path), 64 * 1024 * 1024);
    assert(live.bytes.equals(bytes), `LIVE_FROZEN_BINDING: ${path}`);
    bindings.push({ revision, path, ...live.identity });
    return bytes;
  };
  const seal = JSON.parse(bind(commits.packet, packetRelative + 'FINAL-SEAL.json', packetSealHash));
  assert.equal(lstatSync(packet).mode & 4095, seal.rootMode);
  equal(readdirSync(packet).sort(), [...Object.keys(seal.files), 'FINAL-SEAL.json'].sort(), 'PACKET_MEMBERSHIP');
  for (const [name, expected] of Object.entries(seal.files)) {
    const value = regularFile(join(packet, name)); equal(value.identity, expected, `PACKET: ${name}`);
    assert(gitBytes(commits.packet, packetRelative + name).equals(value.bytes));
  }
  bind(commits.compositionReview, prefix + 'executor-review-v1/results-v2/REVIEW.md', '5aa39ec6a8b7df41ce3e6f4d71e060d8326f68ceed5a009d7d2e62497da6ff35');
  bind(commits.runtimeReview, prefix + 'executor-review-v1/results-v3/REVIEW.md', '39088c1e418dad9c980fe0b097c8f4f679905206e582b468a9686d60c29f6da2');
  bind(commits.runtimeEvidence, prefix + 'executor-preparation-v1/runtime-v2/RECIPE-SEAL.json', 'fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15');
  bind(commits.integrationSource, prefix + 'executor-preparation-v1/integration-v2/SEAL-v4.json', '47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff');
  bind(commits.consumers, consumerRelative + 'RECIPE-SEAL.json', consumerSealHash);
  for (const [name, expected] of [['verify-recipe.mjs', 'a4f2bb661d91505a22fa414b83cbba26dd6d4f63fcd5bc08d648e0368b97bba1'], ['guards.mjs', '7185edea6beeb17282feb773a49476b76da216b228cc8b2f0f710346e18bda4a'], ['frozen-v1.mjs', 'b62e446129ed8936edf381548465bc8cd89660658e5a720cd52a5bd7cc7d2576']]) bind(commits.consumers, consumerRelative + name, expected);
  const verifier = await import(pathToFileURL(join(consumer, 'verify-recipe.mjs')).href);
  verifier.verifyRecipe(consumerSealHash);
  const guards = await import(pathToFileURL(join(consumer, 'guards.mjs')).href);
  const sourceAuthority = guards.authorizeSources(join(packet, 'SOURCE-RECEIPT.json'), 'cd0e2b94ea15e8199399d2cb589aee61a6c014785146dfec6b664ac0967130c9');
  assert.equal(sourceAuthority.sourceMapSha256, 'e01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284');
  return { guards, sourceAuthority, bindings, verify: () => verifier.verifyRecipe(consumerSealHash) };
}

function inspected(guards, root) {
  const tree = guards.inspectTree(root);
  assert(!Object.keys(tree.files).some(path => path.split('/').includes('AGENTS.md')), `AGENTS_REFUSAL: ${root}`);
  return tree;
}

function treeSummary(tree) {
  return { files: Object.keys(tree.files).length, directories: Object.keys(tree.directories).length, filesSha256: hash(canonical(tree.files)), directoriesSha256: hash(canonical(tree.directories)), treeMapSha256: hash(canonical(tree)) };
}

function toolIdentity(tree) {
  const rows = [];
  const walk = path => {
    const children = [...Object.keys(tree.files), ...Object.keys(tree.directories).filter(Boolean)].filter(child => posix.dirname(child) === (path || '.')).sort();
    for (const child of children) {
      if (Object.hasOwn(tree.directories, child)) { rows.push([child, 'directory', tree.directories[child]]); walk(child); }
      else { const value = tree.files[child]; rows.push([child, value.sha256, value.bytes, value.mode]); }
    }
  };
  walk('');
  return { sha256: hash(JSON.stringify(rows)), entries: rows.length };
}

function mkdir(path) { assert(!existsSync(path)); mkdirSync(path, { mode: 493 }); chmodSync(path, 493); }

function protectedTrees(guards) {
  const maps = json(join(packet, 'MAPS.json'));
  const materialization = json(join(packet, 'MATERIALIZATION.json'));
  const paths = [
    [materialization.source.original, maps.source], [materialization.source.moved, maps.source],
    [materialization.package.original, { files: maps.fullPackage.files, directories: maps.fullPackage.directories }],
    [materialization.package.moved, { files: maps.fullPackage.files, directories: maps.fullPackage.directories }],
    [materialization.archive.root, { files: maps.archive.files, directories: maps.archive.directories }],
    [materialization.artifacts.root, { files: materialization.artifacts.before.files, directories: materialization.artifacts.before.directories }],
  ];
  return paths.map(([root, expected]) => { const actual = inspected(guards, root); equal(actual, expected, `RETAINED_TREE: ${root}`); return { root, ...treeSummary(actual) }; });
}

async function prepare() {
  assert(!existsSync(join(own, 'INPUTS.json')), 'PREPARATION_EXISTS');
  assert.equal(process.umask(), 18, 'COMPILER_UMASK_0022');
  const authority = await authenticate();
  const { guards } = authority;
  const retained = protectedTrees(guards);
  const selected = JSON.parse(gitBytes('409449136ae1adc252ff6e205a6bb5785d113d0f', prefix + 'executor-preparation-v1/consumers/SELECTED.json'));
  const readyFiles = ['/tmp/yq-composition-independent-ready.txt', '/tmp/yq-runtime-independent-ready.txt'].map(path => ({ path, ...regularFile(realpathSync(path)).identity }));
  const node = regularFile(selected.tools.node.path, 128 * 1024 * 1024);
  assert.equal(node.identity.sha256, selected.tools.node.sha256); assert.equal(process.version, selected.tools.node.version);
  const originalTools = Object.fromEntries(['typescript', 'nodeTypes', 'undiciTypes'].map(name => {
    const pin = selected.tools[name];
    const root = join(repository, pin.path);
    const tree = inspected(guards, root);
    equal(toolIdentity(tree), { sha256: pin.sha256, entries: pin.entries }, `TOOL_PIN: ${name}`);
    return [name, { originalRoot: root, pin, tree }];
  }));
  const temporary = mkdtempSync(join(realpathSync('/tmp'), 'yq-independent-build-35da1854-')); chmodSync(temporary, 493);
  const paths = { temporary, source: join(temporary, 'source'), tools: join(temporary, 'tools'), output: join(temporary, 'raw-output'), evidence: join(temporary, 'evidence'), package: join(temporary, 'independent-package'), home: join(temporary, 'home'), scratch: join(temporary, 'scratch') };
  for (const name of ['tools', 'output', 'evidence', 'home', 'scratch']) mkdir(paths[name]);
  mkdir(join(paths.tools, 'types'));
  const originalSource = json(join(packet, 'MATERIALIZATION.json')).source.moved;
  guards.assertSourceMaterialization(authority.sourceAuthority, originalSource);
  const sourceTree = inspected(guards, originalSource);
  guards.copyRegularTree(originalSource, paths.source, sourceTree);
  guards.assertSourceMaterialization(authority.sourceAuthority, paths.source);
  const toolDestinations = { typescript: join(paths.tools, 'typescript'), nodeTypes: join(paths.tools, 'types/node'), undiciTypes: join(paths.tools, 'types/undici-types') };
  for (const [name, value] of Object.entries(originalTools)) {
    value.copiedRoot = toolDestinations[name];
    guards.copyRegularTree(value.originalRoot, value.copiedRoot, value.tree);
    equal(toolIdentity(inspected(guards, value.copiedRoot)), { sha256: value.pin.sha256, entries: value.pin.entries }, `COPIED_TOOL: ${name}`);
  }
  const nodeCopy = join(paths.tools, 'node'); copyFileSync(selected.tools.node.path, nodeCopy); chmodSync(nodeCopy, node.identity.mode);
  equal(regularFile(nodeCopy, 128 * 1024 * 1024).identity, node.identity, 'COPIED_NODE');
  const command = { executable: nodeCopy, args: [join(toolDestinations.typescript, 'lib/tsc.js'), '--project', join(paths.source, 'tsconfig.build.json'), '--outDir', join(paths.output, 'dist'), '--typeRoots', join(paths.tools, 'types')], cwd: paths.source, umask: process.umask(), env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: paths.home, TMPDIR: paths.scratch } };
  const maps = json(join(packet, 'MAPS.json'));
  const expectedOutputPaths = Object.keys(maps.fullPackage.files).filter(path => path.startsWith('dist/')).sort();
  const sourceTypescript = Object.keys(sourceTree.files).filter(path => path.startsWith('src/') && path.endsWith('.ts')).sort();
  equal(sourceTypescript.flatMap(path => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => path.replace(/^src\//u, 'dist/').replace(/\.ts$/u, extension))).sort(), expectedOutputPaths, 'SOURCE_TO_OUTPUT_NAME_MAP');
  const inputs = { schema: 1, date: '2026-08-28', purpose: 'ONE_BUILD_ONLY_PREPARATION_NO_COMPILER_EXECUTION', commits, bindings: authority.bindings, readyFiles, paths, command, bounds: { deadlineMs: 120000, termGraceMs: 2000, reapMs: 5000, captureBytesPerStream: 4194304, treeBytes: 67108864, treeEntries: 4096 }, tools: { node: { original: selected.tools.node.path, copied: nodeCopy, version: selected.tools.node.version, ...node.identity }, ...originalTools }, retainedBefore: retained, sourceTree, sourceMapSha256: authority.sourceAuthority.sourceMapSha256, packageMapSha256: maps.packageMapSha256, expectedPackageHash, sourceTypescript, expectedOutputPaths, compilerProfile: { tsconfig: sourceTree.files['tsconfig.json'], buildConfig: sourceTree.files['tsconfig.build.json'], actualDeclarationConsumerRuns: 0 }, projection: { sourceFiles: 271, archiveFiles: 273, excludedFromConsumerProjectionOnly: ['package-lock.json', 'scripts/typecheck.mjs'], fullArchiveRetained: true }, buildReceiptBeforeProof: { classification: 'AUTHOR_ARTIFACT_BINDING_ONLY', independentlyCompiled: false } };
  equal(protectedTrees(guards), retained, 'RETAINED_AFTER_PREPARATION');
  authority.verify();
  const receipt = patchJson('INPUTS.json', inputs, true);
  console.log(JSON.stringify({ status: 'PREPARED_NOT_COMPILED', receipt, paths, command, sourceTypeScriptCount: sourceTypescript.length, outputCount: expectedOutputPaths.length }, null, 2));
}

function groupAbsent(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(-pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

async function compileOnce(inputs) {
  const { command, bounds } = inputs;
  const startedAt = new Date().toISOString(); const monotonic = process.hrtime.bigint();
  const stdout = []; const stderr = []; let stdoutBytes = 0; let stderrBytes = 0;
  let overflow = false; let spawnError = null; let exitSeen = false; let exitedAt = null;
  const signals = []; let timedOut = false; let stopTimer; let deadline; let reapTimer; let settled = false;
  let child;
  const result = await new Promise(resolveResult => {
    const finish = (code, signal, closeObserved = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(stopTimer); clearTimeout(reapTimer);
      if (!closeObserved) { child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref(); }
      const closedAt = new Date().toISOString();
      resolveResult({ pid: child?.pid ?? null, startedAt, exitedAt, closedAt, elapsedMs: Number(process.hrtime.bigint() - monotonic) / 1e6, exitCode: code, signal, spawnError, timedOut, overflow, exitSeen, closeObserved, reapTimedOut: !closeObserved, reaped: exitSeen && closeObserved, groupAbsent: groupAbsent(child?.pid), signals, stdoutObservedBytes: stdoutBytes, stderrObservedBytes: stderrBytes });
    };
    const watchReap = () => { if (!reapTimer) reapTimer = setTimeout(() => finish(null, null, false), bounds.reapMs); };
    const stop = reason => {
      if (!child?.pid || exitSeen || stopTimer) return;
      const signal = kind => { try { process.kill(-child.pid, kind); signals.push({ signal: kind, reason, elapsedMs: Number(process.hrtime.bigint() - monotonic) / 1e6 }); } catch (error) { signals.push({ signal: kind, reason, error: error.code }); } };
      signal('SIGTERM'); stopTimer = setTimeout(() => { if (!exitSeen) signal('SIGKILL'); watchReap(); }, bounds.termGraceMs);
    };
    try { child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); }
    catch (error) { spawnError = { name: error.name, message: error.message, code: error.code }; finish(null, null); return; }
    const capture = (chunks, bytes, stream) => {
      if (settled) return;
      const prior = stream === 'stdout' ? stdoutBytes : stderrBytes;
      if (stream === 'stdout') stdoutBytes += bytes.length; else stderrBytes += bytes.length;
      const available = Math.max(0, bounds.captureBytesPerStream - prior);
      if (available) chunks.push(Buffer.from(bytes.subarray(0, available)));
      if (prior + bytes.length > bounds.captureBytesPerStream) { overflow = true; stop('capture-overflow'); }
    };
    child.stdout.on('data', bytes => capture(stdout, bytes, 'stdout')); child.stderr.on('data', bytes => capture(stderr, bytes, 'stderr'));
    child.once('error', error => { spawnError = { name: error.name, message: error.message, code: error.code }; });
    child.once('exit', () => { exitSeen = true; exitedAt = new Date().toISOString(); watchReap(); });
    child.once('close', (code, signal) => finish(code, signal));
    deadline = setTimeout(() => { timedOut = true; stop('deadline'); }, bounds.deadlineMs);
  });
  const stdoutRaw = Buffer.concat(stdout); const stderrRaw = Buffer.concat(stderr);
  const stdoutPath = join(inputs.paths.evidence, 'compiler.stdout'); const stderrPath = join(inputs.paths.evidence, 'compiler.stderr');
  writeFileSync(stdoutPath, stdoutRaw, { flag: 'wx', mode: 420 }); writeFileSync(stderrPath, stderrRaw, { flag: 'wx', mode: 420 });
  const captured = { ...result, command, bounds, stdout: { path: stdoutPath, ...descriptor(stdoutRaw) }, stderr: { path: stderrPath, ...descriptor(stderrRaw) }, captureBeforeAssertion: true, rawOutputRoot: inputs.paths.output };
  const processReceipt = patchJson('COMPILER-PROCESS.json', captured);
  for (const [name, bytes] of [['compiler.stdout.txt', stdoutRaw], ['compiler.stderr.txt', stderrRaw]]) {
    if (bytes.length === 0 || bytes.at(-1) === 10) patchBytes(name, bytes);
    else patchJson(name + '.raw.json', { encoding: 'base64', bytes: bytes.length, sha256: hash(bytes), data: bytes.toString('base64') });
  }
  return { ...captured, processReceipt };
}

function header(name, size) {
  assert(Buffer.byteLength(name) <= 100);
  const bytes = Buffer.alloc(512); bytes.write(name, 0, 'ascii');
  const octal = (offset, width, number) => bytes.write(number.toString(8).padStart(width - 2, '0') + ' \0', offset, width, 'ascii');
  octal(100, 8, 420); octal(124, 12, size); octal(136, 12, 499162500);
  bytes.fill(32, 148, 156); bytes.write('0', 156, 'ascii'); bytes.write('ustar\0' + '00', 257, 'ascii');
  octal(329, 8, 0); octal(337, 8, 0); octal(148, 8, bytes.reduce((sum, byte) => sum + byte, 0));
  return bytes;
}

function ensureParents(root, directories) {
  mkdir(root);
  for (const path of Object.keys(directories).filter(Boolean).sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) mkdir(join(root, path));
}

async function run() {
  assert(!existsSync(join(own, 'ATTEMPT-STARTED.json')), 'ONE_ATTEMPT_ALREADY_STARTED');
  const presealRaw = regularFile(join(own, 'BUILD-PRESEAL.json')).bytes;
  assert.equal(hash(presealRaw), process.argv[3], 'INDEPENDENT_PRESEAL_HASH');
  const preseal = JSON.parse(presealRaw);
  for (const [name, expected] of Object.entries(preseal.files)) equal(regularFile(join(own, name)).identity, expected, `BUILD_PRESEAL: ${name}`);
  const inputs = json(join(own, 'INPUTS.json'));
  assert.equal(process.umask(), inputs.command.umask, 'PRESEALED_UMASK');
  const authority = await authenticate(); const { guards } = authority;
  const checkInputs = () => {
    const priorSeal = regularFile(join(packet, 'FINAL-SEAL.json')).bytes;
    assert.equal(hash(priorSeal), packetSealHash, 'OLD_PACKET_AFTER_SEAL');
    const priorFiles = JSON.parse(priorSeal);
    assert.equal(lstatSync(packet).mode & 4095, priorFiles.rootMode);
    equal(readdirSync(packet).sort(), [...Object.keys(priorFiles.files), 'FINAL-SEAL.json'].sort(), 'OLD_PACKET_AFTER_MEMBERSHIP');
    for (const [name, expected] of Object.entries(priorFiles.files)) equal(regularFile(join(packet, name)).identity, expected, `OLD_PACKET_AFTER: ${name}`);
    equal(protectedTrees(guards), inputs.retainedBefore, 'RETAINED_INPUTS');
    guards.assertSourceMaterialization(authority.sourceAuthority, inputs.paths.source);
    equal(inspected(guards, inputs.paths.source), inputs.sourceTree, 'BUILD_SOURCE');
    for (const name of ['typescript', 'nodeTypes', 'undiciTypes']) for (const root of [inputs.tools[name].originalRoot, inputs.tools[name].copiedRoot]) equal(inspected(guards, root), inputs.tools[name].tree, `TOOLS: ${root}`);
    for (const path of [inputs.tools.node.original, inputs.tools.node.copied]) equal(regularFile(path, 128 * 1024 * 1024).identity, { sha256: inputs.tools.node.sha256, bytes: inputs.tools.node.bytes, mode: inputs.tools.node.mode }, 'NODE_AFTER');
    equal(readdirSync(inputs.paths.tools).sort(), ['node', 'types', 'typescript'], 'TOOL_ROOT_MEMBERSHIP');
    equal(readdirSync(join(inputs.paths.tools, 'types')).sort(), ['node', 'undici-types'], 'TYPE_ROOT_MEMBERSHIP');
    for (const path of [inputs.paths.tools, join(inputs.paths.tools, 'types')]) assert.equal(lstatSync(path).mode & 4095, 493, 'TOOL_PARENT_MODE');
    authority.verify();
  };
  checkInputs();
  assert.equal(readdirSync(inputs.paths.output).length, 0, 'FRESH_OUTPUT');
  patchJson('ATTEMPT-STARTED.json', { schema: 1, date: new Date().toISOString(), buildPresealSha256: hash(presealRaw), attempt: 1, command: inputs.command, purpose: 'INDEPENDENT_SCOPED_COMPILER_ONLY', status: 'STARTED_NOT_SUCCESS' });
  let outcome; let compiler;
  try {
    compiler = await compileOnce(inputs);
    assert(compiler.exitCode === 0 && compiler.signal === null && compiler.spawnError === null && !compiler.timedOut && !compiler.overflow && compiler.reaped && compiler.groupAbsent, 'COMPILER_PROCESS_FAILED');
    assert(compiler.exitedAt && Date.parse(compiler.closedAt) - Date.parse(compiler.exitedAt) <= inputs.bounds.reapMs, 'REAP_BOUND');
    const rawTree = inspected(guards, inputs.paths.output);
    const rawMap = patchJson('RAW-OUTPUT-MAP.json', rawTree, true);
    equal(Object.keys(rawTree.files).sort(), inputs.expectedOutputPaths, 'COMPILER_OUTPUT_MEMBERSHIP');
    const expected = json(join(packet, 'MAPS.json'));
    equal(rawTree.directories, expected.fullPackage.directories, 'COMPILER_OUTPUT_DIRECTORIES');
    const comparisons = [];
    const independent = new Map();
    for (const path of inputs.expectedOutputPaths) {
      const raw = regularFile(join(inputs.paths.output, path));
      let bytes = raw.bytes;
      let relocation = null;
      if (path.endsWith('.map')) {
        const parsed = JSON.parse(raw.bytes);
        const suffix = raw.bytes.at(-1) === 10 ? '\n' : '';
        assert.equal(JSON.stringify(parsed) + suffix, raw.bytes.toString('utf8'), `COMPILER_MAP_SERIALIZATION: ${path}`);
        assert(Array.isArray(parsed.sources) && parsed.sources.length === 1 && parsed.sourceRoot === '', `MAP_SHAPE: ${path}`);
        const sourcePath = path.replace(/^dist\//u, 'src/').replace(/(?:\.d\.ts|\.js)\.map$/u, '.ts');
        assert(Object.hasOwn(inputs.sourceTree.files, sourcePath), `MAP_SOURCE_NOT_SELECTED: ${path}`);
        const target = resolve(dirname(join(inputs.paths.output, path)), parsed.sources[0]);
        assert.equal(target, join(inputs.paths.source, sourcePath), `MAP_RAW_SOURCE: ${path}`);
        assert.equal(realpathSync(target), target, `MAP_SOURCE_ALIAS: ${path}`);
        const originalSource = parsed.sources[0];
        parsed.sources = [posix.relative(posix.dirname(path), sourcePath)];
        bytes = Buffer.from(JSON.stringify(parsed) + suffix);
        relocation = { sourcePath, sourceIdentity: inputs.sourceTree.files[sourcePath], before: originalSource, after: parsed.sources[0], changedFieldOnly: 'sources[0]' };
      }
      const actual = descriptor(bytes, raw.identity.mode);
      const wanted = expected.fullPackage.files[path];
      comparisons.push({ path, raw: raw.identity, expected: wanted, relocated: relocation ? actual : null, rawByteEqual: canonical(raw.identity) === canonical(wanted), finalByteEqual: canonical(actual) === canonical(wanted), relocation });
      independent.set(path, bytes);
    }
    const comparisonFile = patchJson('OUTPUT-COMPARISONS.json', { schema: 1, comparisons, rawOutputMap: rawMap, rawEqual: comparisons.filter(entry => entry.rawByteEqual).length, relocatedMaps: comparisons.filter(entry => entry.relocation).length, finalEqual: comparisons.filter(entry => entry.finalByteEqual).length, mismatches: comparisons.filter(entry => !entry.finalByteEqual).map(entry => entry.path) }, true);
    assert(comparisons.every(entry => entry.finalByteEqual), 'INDEPENDENT_OUTPUT_MISMATCH');
    for (const path of ['README.md', 'package.json']) {
      const value = regularFile(join(inputs.paths.source, path)); equal(value.identity, expected.fullPackage.files[path], `METADATA: ${path}`); independent.set(path, value.bytes);
    }
    equal([...independent.keys()].sort(), Object.keys(expected.fullPackage.files).sort(), 'FULL_870_NAMES');
    ensureParents(inputs.paths.package, expected.fullPackage.directories);
    for (const [path, bytes] of independent) writeFileSync(join(inputs.paths.package, path), bytes, { flag: 'wx', mode: 420 });
    const packageTree = inspected(guards, inputs.paths.package);
    equal(packageTree, { files: expected.fullPackage.files, directories: expected.fullPackage.directories }, 'FULL_870_BYTE_MODE_MAP');
    const packageMap = patchJson('INDEPENDENT-PACKAGE-MAP.json', packageTree, true);
    const tar = Buffer.concat([...expected.fullPackage.entries.flatMap(entry => { const bytes = independent.get(entry.path); assert(bytes); return [header(entry.name, bytes.length), bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]; }), Buffer.alloc(1024)]);
    const packed = gzipSync(tar, { level: 9, strategy: 0, memLevel: 8, windowBits: 15 }); packed[9] = 255;
    const tarPath = join(inputs.paths.evidence, 'independent-package.tar'); const packagePath = join(inputs.paths.evidence, 'virtual-bash-0.0.0.tgz');
    writeFileSync(tarPath, tar, { flag: 'wx', mode: 420 }); writeFileSync(packagePath, packed, { flag: 'wx', mode: 420 });
    const packing = patchJson('PACKING.json', { tar: { path: tarPath, ...descriptor(tar) }, package: { path: packagePath, ...descriptor(packed) }, expectedPackageSha256: expectedPackageHash, byteExact: hash(packed) === expectedPackageHash, attempts: 1, zlib: process.versions.zlib, recipe: 'candidate-35da1854-v1/PRESEAL.md; unchanged npm USTAR numeric spelling/entry order and one level-9 gzip', inputRole: 'INDEPENDENT_COMPILER_OUTPUTS_AND_DECLARED_MAP_RELOCATION_NOT_AUTHOR_OUTPUT_COPY' });
    assert.equal(hash(packed), expectedPackageHash, 'INDEPENDENT_PACKAGE_BYTES');
    checkInputs();
    equal(inspected(guards, inputs.paths.output), rawTree, 'RAW_OUTPUT_RETAINED');
    equal(inspected(guards, inputs.paths.package), packageTree, 'INDEPENDENT_PACKAGE_RETAINED');
    const after = patchJson('INTEGRITY-AFTER.json', { retainedTrees: protectedTrees(guards), source: treeSummary(inspected(guards, inputs.paths.source)), tools: Object.fromEntries(['typescript', 'nodeTypes', 'undiciTypes'].map(name => [name, { original: treeSummary(inspected(guards, inputs.tools[name].originalRoot)), copied: treeSummary(inspected(guards, inputs.tools[name].copiedRoot)) }])), rawOutput: treeSummary(rawTree), independentPackage: treeSummary(packageTree), oldPacketAndConsumersSealsVerified: true, addedEntryDetection: true, scope: 'Before/after complete membership/bytes/modes; not change-and-restore detection or filesystem transaction' });
    const buildReceipt = patchJson('INDEPENDENT-BUILD-RECEIPT.json', { schema: 1, candidateCommit: commits.source, sourceMapSha256: inputs.sourceMapSha256, packageMapSha256: hash(canonical(packageTree)), classification: 'INDEPENDENT_SCOPED_BUILD_WITH_EXPLICIT_SOURCE_MAP_RELOCATION', independentlyCompiled: true, rootTrustedBuildReceipt: false, buildPresealSha256: hash(presealRaw), compilerProcess: compiler.processReceipt, comparisons: comparisonFile, rawOutputMap: rawMap, independentPackageMap: packageMap, packing, integrityAfter: after, command: inputs.command, toolPins: { node: inputs.tools.node, typescript: inputs.tools.typescript.pin, nodeTypes: inputs.tools.nodeTypes.pin, undiciTypes: inputs.tools.undiciTypes.pin }, sourceFiles: 271, sourceArchiveFiles: 273, compiledSourceFiles: inputs.sourceTypescript.length, compilerOutputs: comparisons.length, rawEqualOutputs: comparisons.filter(entry => entry.rawByteEqual).length, explicitlyRelocatedMaps: comparisons.filter(entry => entry.relocation).length, finalEqualOutputs: comparisons.filter(entry => entry.finalByteEqual).length, fullPackageFiles: Object.keys(packageTree.files).length, artifact: { path: packagePath, ...descriptor(packed) }, evidenceSourceCommit: commits.evidence, sourceOrigin: commits.source, semanticPasses: 0, publicIntegration: 'ABSENT_EXPECTED', rootRouting: 'New proof only; old integration-v2 explicitly pins BOUND_AUTHOR_BUILD. Root must route this additive receipt without modifying history.' });
    const full = json(join(packet, 'FULL-RECEIPT.json')); full.buildReceipt = { path: buildReceipt.path, sha256: buildReceipt.sha256 }; guards.validateReceiptShape(full);
    const fullReceipt = patchJson('FULL-RECEIPT.json', full);
    outcome = { status: 'INDEPENDENT_BUILD_AND_BYTE_EXACT_PACKAGE_PASS', commits, buildReceipt, fullReceipt, packageRoot: inputs.paths.package, packageArtifact: { path: packagePath, ...descriptor(packed) }, rawOutputRoot: inputs.paths.output, sourceRoot: inputs.paths.source, sourceMapSha256: inputs.sourceMapSha256, packageMapSha256: inputs.packageMapSha256, buildPresealSha256: hash(presealRaw), counts: { source: 271, archivedSource: 273, compiledSource: inputs.sourceTypescript.length, compilerOutputs: comparisons.length, rawEqual: comparisons.filter(entry => entry.rawByteEqual).length, relocatedMaps: comparisons.filter(entry => entry.relocation).length, finalEqual: comparisons.filter(entry => entry.finalByteEqual).length, fullPackage: 870, baselinePackage: 846, additions: 24 }, compiler: compiler.processReceipt, remaining: ['Root routing of new independent build proof; fixed integration-v2 still pins original author receipt', 'Actual semantic/type/moved/lifecycle/CARRY review elsewhere', 'Public exports remain absent; no global typecheck acceptance'], execution: { compilerAttempts: 1, productImports: 0, productRuns: 0, declarationConsumerRuns: 0, semanticVectors: 0, authorTestRuns: 0, npm: 0, nativeYaml: 0, retries: 0 } };
  } catch (error) {
    let integrity;
    try { checkInputs(); integrity = { retainedInputsUnchanged: true }; } catch (failure) { integrity = { retainedInputsUnchanged: false, error: failure.message }; }
    const partial = existsSync(inputs.paths.output) ? inspected(guards, inputs.paths.output) : null;
    patchJson('FAILURE-RAW-OUTPUT-MAP.json', partial, true);
    outcome = { status: 'FAIL_NO_RETRY', commits, error: { name: error.name, message: error.message, code: error.code, stack: error.stack }, compiler: compiler ?? null, rawOutputRoot: inputs.paths.output, integrity, sourceBugInferred: false, rerunAuthorized: false, instruction: 'Report exact failure; invocation-only corrections need separately additive root-authorized preseal', execution: { compilerAttempts: compiler ? 1 : 0, productImports: 0, productRuns: 0, declarationConsumerRuns: 0, semanticVectors: 0, retries: 0 } };
    process.exitCode = 1;
  }
  const result = patchJson('RESULT.json', outcome);
  patchJson('EXPECTED-HASHES.json', { schema: 1, result, ...(outcome.buildReceipt ? { buildReceipt: outcome.buildReceipt, fullReceipt: outcome.fullReceipt } : {}), routing: 'Authenticate the final owned commit/seal independently before trusting these raw hashes; no self-announced authority' });
  console.log(JSON.stringify({ ...outcome, result }, null, 2));
}

if (process.argv[2] === 'prepare' && process.argv.length === 3) await prepare();
else if (process.argv[2] === 'run' && process.argv.length === 4) await run();
else throw new Error('Usage: build-once.mjs prepare | run INDEPENDENT_BUILD_PRESEAL_SHA256');
