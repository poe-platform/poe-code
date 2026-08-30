import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWrappers, validateWrappers } from './wrappers.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const output = path.join(directory, 'PREPARATION-01');
const started = performance.now();
const end = started + 180000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const nodeHash = '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011';
const inputPins = [
  ['semantic/FROZEN-DATA.json', 'a57c3da7b9354dd5d5cc1af23f5a10160aaafa0a2f05c94ee64d022946b4811d'],
  ['semantic/CASE-DATA.json', 'cdff96c2817366c7506e1cf785f9b4ca9056cfc1d787df232bd1dde95d6f2ff0'],
  ['decoder-v3/fixtures.mjs', 'bcd1e82a32263ca882c66d22627ff402fc11ae97149af3b8eaa8089510c14abe'],
  ['runner/v2/type-bridge.mjs', '8418addde828aa71b6b5a1776353f58d65fcf84203302d82ab966e2bff2ef74d']
];
const ids = ['P03-body', 'P04-body', 'P05-body', 'P06-body', 'P07-body', 'P08-body', 'P09-body', 'P11-body', 'P12-body', 'empty-blob', 'delta-program4-result1', 'delta-zero-result', 'shared-DAG'];
let captured = 0;
let root = null;
let child = null;
let retired = false;
let failure = null;
let result = null;
const controls = [];
function demand(condition, label) { if (!condition) throw new Error(label); }
function clock() { demand(performance.now() < end, 'PREPARATION_DEADLINE'); }
async function record(name, value) {
  clock();
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(captured + bytes.length <= 8388608, 'PREPARATION_CAPTURE');
  captured += bytes.length;
  await fs.writeFile(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
}
async function readPinned(name, expected) {
  clock();
  const filename = path.join(scope, name);
  const before = await fs.lstat(filename);
  demand(before.isFile() && !before.isSymbolicLink() && before.size < 1048576 && await fs.realpath(filename) === filename, 'INPUT_KIND');
  const bytes = await fs.readFile(filename);
  demand(sha(bytes) === expected, 'INPUT_HASH:' + name);
  return bytes;
}
await fs.mkdir(output, { mode: 0o700 });
await record('STARTUP.json', { role: 'SOURCE_DATA_AND_ONE_HARMLESS_PROBE_ONLY', maximumMs: 180000, maximumProcesses: 2, maximumCapture: 8388608, maximumWork: 134217728 });
try {
  const inputs = new Map();
  for (const [name, expected] of inputPins) inputs.set(name, await readPinned(name, expected));
  const executable = await fs.readFile(node);
  demand(process.execPath === node && sha(executable) === nodeHash && executable.length === 112989184, 'EXACT_NODE');
  root = '/private/tmp/git-m1b-preadmission-' + randomBytes(8).toString('hex');
  await fs.mkdir(root, { mode: 0o700 });
  const toolsRoot = path.join(root, 'type-tools');
  const caseRoot = path.join(root, 'cases/T01-S/T01');
  const program = path.join(root, 'harness/mechanical-type-api-v2/compiler-api-worker.mjs');
  for (const dir of [toolsRoot + '/bin', caseRoot, path.dirname(program), root + '/source-package']) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const probeSource = await fs.readFile(path.join(directory, 'env-probe.mjs'));
  await fs.writeFile(toolsRoot + '/bin/node', executable, { flag: 'wx', mode: 0o755 });
  await fs.writeFile(program, probeSource, { flag: 'wx', mode: 0o644 });
  demand(sha(await fs.readFile(toolsRoot + '/bin/node')) === nodeHash, 'COPIED_NODE_IDENTITY');
  const request = { schema: 'm1b-type-api-request-v2', fixtureId: 'T01', layout: 'S', caseRoot, subjectRoot: root + '/source-package', toolsRoot };
  const requestBytes = Buffer.from(JSON.stringify(request) + '\n');
  const requestFile = caseRoot + '/type-api-request.json';
  await fs.writeFile(requestFile, requestBytes, { flag: 'wx', mode: 0o600 });
  const environment = { PATH: toolsRoot + '/bin', HOME: caseRoot, TMPDIR: caseRoot, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', UV_THREADPOOL_SIZE: '1' };
  const argv = [program, '--request', requestFile, '--sha256', sha(requestBytes)];
  const stdoutFile = await fs.open(path.join(output, 'PROBE.stdout.raw'), 'wx', 0o600);
  const stderrFile = await fs.open(path.join(output, 'PROBE.stderr.raw'), 'wx', 0o600);
  await record('PROBE-LAUNCH.json', { executable: toolsRoot + '/bin/node', executableSha256: nodeHash, argv, cwd: caseRoot, environment, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: false, serialization: 'json', declaredChildStarts: 1, sourceProbeSha256: sha(probeSource), role: 'EXACT_LAUNCH_SHAPE_NEW_ROOT_PROGRAM_REPLACED_WITH_HARMLESS_OBSERVER' });
  let streams = Promise.resolve();
  let streamBytes = 0;
  let captureFailure = null;
  child = spawn(toolsRoot + '/bin/node', argv, { cwd: caseRoot, env: environment, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'], serialization: 'json' });
  child.stdin.end();
  for (const [stream, file] of [[child.stdout, stdoutFile], [child.stderr, stderrFile]]) stream.on('data', bytes => {
    stream.pause();
    streams = streams.then(async () => { streamBytes += bytes.length; demand(streamBytes <= 65536, 'PROBE_CAPTURE'); await file.writeFile(bytes); }).catch(error => { captureFailure = error.message; child.kill('SIGTERM'); }).finally(() => stream.resume());
  });
  const term = setTimeout(() => { if (!retired) child.kill('SIGTERM'); }, 5000);
  const kill = setTimeout(() => { if (!retired) child.kill('SIGKILL'); }, 7000);
  const outcome = await new Promise(resolve => { child.once('error', error => resolve({ error: error.code, code: null, signal: null })); child.once('close', (code, signal) => { retired = true; resolve({ error: null, code, signal }); }); });
  clearTimeout(term); clearTimeout(kill);
  await streams;
  await stdoutFile.close(); await stderrFile.close();
  captured += streamBytes;
  await record('PROBE-RETIREMENT.json', { ...outcome, retired, captureFailure, bytes: streamBytes, elapsedMs: performance.now() - started });
  demand(retired && outcome.code === 0 && outcome.signal === null && outcome.error === null && captureFailure === null, 'PROBE_RETIREMENT');
  const observation = (await fs.readFile(path.join(output, 'PROBE.stdout.raw'), 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  demand(observation.length === 2 && observation[1].role === 'HARMLESS_PREADMISSION_ENVIRONMENT' && observation[1].compilerLoaded === false && observation[1].productLoaded === false && observation[1].facts.every(row => row.value === 'REDACTED'), 'PROBE_PUBLICATION');
  await record('ENVIRONMENT-OBSERVATION.json', observation[1]);
  const data = JSON.parse(inputs.get('semantic/FROZEN-DATA.json'));
  const table = JSON.parse(inputs.get('semantic/CASE-DATA.json'));
  const { createFixture } = await import(pathToFileURL(path.join(scope, 'decoder-v3/fixtures.mjs')).href);
  const cases = [];
  const bindings = [];
  for (const id of ids) {
    clock();
    const original = table.cases.find(row => row.id === id);
    demand(original && !original.control && original.expected.exitCode === 0, 'EXACT_POSITIVE_CASE');
    const initial = createFixture(data, original.spec);
    const expected = original.expected.stdoutBase64 === undefined ? Buffer.from(original.expected.stdoutText, 'utf8') : Buffer.from(original.expected.stdoutBase64, 'base64');
    const wrapper = createWrappers(initial.args[1]);
    await validateWrappers(wrapper, expected);
    demand(!initial.files.some(row => row.path === '.git/objects/' + wrapper.targetOid.slice(0, 2) + '/' + wrapper.targetOid.slice(2)), 'NO_LOOSE_TARGET_BYPASS');
    const revised = structuredClone(original);
    revised.id = id + '-via-tree-v1';
    revised.variant = revised.id;
    revised.spec.args = wrapper.args;
    revised.spec.extra = [...(revised.spec.extra ?? []), ...[wrapper.tree, wrapper.commit].map(row => ({ path: row.path, body: { hex: row.compressedHex } }))];
    const constructed = createFixture(data, revised.spec);
    for (const row of initial.files) {
      const after = constructed.files.find(file => file.path === row.path);
      demand(after && after.mode === row.mode && after.type === row.type && after.bytes.equals(row.bytes), 'UNCHANGED_ORIGINAL_FILE');
    }
    demand(constructed.files.length === initial.files.length + 2 && JSON.stringify(revised.expected) === JSON.stringify(original.expected) && JSON.stringify(revised.spec.packs) === JSON.stringify(original.spec.packs), 'ONLY_WRAPPER_ADDITIONS');
    bindings.push({ originalId: id, id: revised.id, wrapper, originalFiles: initial.files.map(row => ({ path: row.path, mode: row.mode, bytes: row.bytes.length, sha256: sha(row.bytes) })), originalPacks: initial.facts, unchangedExpected: original.expected, proof: 'DATA_CONSTRUCTION_ONLY_NO_PRODUCT_QUERY' });
    cases.push(revised);
  }
  const template = bindings[0].wrapper;
  const expected = Buffer.from(bindings[0].unchangedExpected.stdoutBase64, 'base64');
  const mutations = [
    ['correct-wrapper', wrapper => wrapper, true],
    ['wrong-target', wrapper => { wrapper.targetOid = '0'.repeat(40); return wrapper; }, false],
    ['wrong-tree-oid', wrapper => { wrapper.tree.oid = '0'.repeat(40); return wrapper; }, false],
    ['wrong-commit-oid', wrapper => { wrapper.commit.oid = '0'.repeat(40); return wrapper; }, false],
    ['wrong-object-frame', wrapper => { wrapper.tree.objectHex += '00'; return wrapper; }, false],
    ['wrong-compressed-bytes', wrapper => { wrapper.commit.compressedHex += '00'; return wrapper; }, false],
    ['wrong-object-path', wrapper => { wrapper.tree.path += '0'; return wrapper; }, false],
    ['unsupported-query', wrapper => { wrapper.args = ['show', wrapper.targetOid]; return wrapper; }, false]
  ];
  for (const [id, mutate, accept] of mutations) {
    let error = null;
    try { await validateWrappers(mutate(structuredClone(template)), expected); } catch (caught) { error = caught.message; }
    await record(id + '.json', { id, accepted: error === null, error });
    controls.push({ id, passed: accept === (error === null) });
    demand(controls.at(-1).passed, 'WRAPPER_CONTROL');
  }
  await record('WRAPPERS.json', { schema: 'm1b-rev-path-wrapper-bindings-v1', bindings });
  await record('CASE-DATA.json', { ...table, schema: 'm1b-supported-query-successor-v1', generation: '13 versioned supported REV:path wrappers; original files/pack bytes/expected results unchanged', cases });
  for (const [name, expectedHash] of inputPins) await readPinned(name, expectedHash);
  demand(sha(await fs.readFile(node)) === nodeHash && sha(await fs.readFile(toolsRoot + '/bin/node')) === nodeHash && sha(await fs.readFile(program)) === sha(probeSource), 'FINAL_TOOL_SOURCE_GUARD');
  result = { status: 'PASS_PREPARATION_ONLY', wrapperCases: cases.length, wrapperControls: controls.length, allControlsPass: controls.every(row => row.passed), originalProductCalls: 0, compilerLoads: 0, harmlessProbeChildren: 1, observedUnknownKeys: observation[1].facts.filter(row => !row.declared).map(row => ({ key: row.key, matchesDarwinUidTextEncoding: row.matchesDarwinUidTextEncoding })) };
} catch (error) {
  failure = { name: error?.name ?? typeof error, message: error?.message ?? 'unknown' };
  process.exitCode = 1;
} finally {
  if (root && (retired || child === null)) {
    demand(root.startsWith('/private/tmp/git-m1b-preadmission-') && await fs.realpath(root) === root, 'OWNED_ROOT_CLEANUP');
    await fs.rm(root, { recursive: true });
  }
  await record('RESULT.json', { result, failure, retired, rootRemoved: root ? await fs.lstat(root).then(() => false, error => error.code === 'ENOENT') : null, controls, captureBytesBeforeResult: captured, elapsedMs: performance.now() - started, noRetry: true });
}
