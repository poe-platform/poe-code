import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { HERE, REPO, sha, need, now, inventory, put, untar } from './common.mjs';
import { supervisor } from './supervisor.mjs';

const binding = JSON.parse(await fs.readFile(path.join(HERE, 'BINDING.json')));
const seal = JSON.parse(await fs.readFile(path.join(HERE, 'PRESEAL.json')));
const working = path.join(HERE, 'working-v1'), captureRoot = path.join(HERE, 'capture-v1');
const result = { schema: 'different-m1a-review-v5-actual', date: '2026-08-28', source: binding.source, evidence: binding.evidence, base: binding.base, preseal: process.argv[2], status: 'RUNNING', children: [], layouts: [], types: [], mutants: [], bindings: [], integrity: [], nativeGit: 0, nativeH11: 0, nativeOracleSix: 'UNRUN', M1B12: 'UNRUN', startMonotonicMs: now(), preparationStartMonotonicMs: binding.startMonotonicMs };
let workingWritten = 0;
const write = async (file, bytes, mode = 0o644) => { workingWritten += Buffer.byteLength(bytes); need(workingWritten < 384 * 1024 * 1024, 'working write reserve leaves128MiB captures'); await put(file, bytes); await fs.chmod(file, mode); };
async function guard(label) {
  for (const row of seal.files) need(sha(await fs.readFile(path.join(HERE, row.path))) === row.sha256, `sealed harness/input changed ${row.path}`);
  need(sha(await fs.readFile(binding.node.path)) === binding.node.sha256 && process.execPath === binding.node.path, 'Node executable binding');
  for (const tool of binding.tools) assert.deepEqual(await inventory(tool.root), tool.rows, 'entire dev dependency tree including additions');
  need(sha(await fs.readFile(path.join(REPO, 'package-lock.json'))) === binding.lock.sha256, 'locked dependency closure unchanged');
  need(now() < binding.measuredDeadlineMs, 'monotonic aggregate deadline');
  result.integrity.push({ label, monotonicMs: now(), exactToolAndHarnessClosure: true, newEntriesChecked: true });
}
const child = supervisor(binding, result, captureRoot);
const compiler = path.join(binding.tools.find(row => row.name === 'typescript').root, 'lib/tsc.js');
const typeRoots = path.dirname(binding.tools.find(row => row.name === '@types/node').root);
const harnessFiles = seal.files.filter(row => row.path.endsWith('.mjs')).map(row => ({ path: path.join(HERE, row.path), sha256: row.sha256 }));
async function packageRows(root) { return (await inventory(root)).filter(row => !row.directory).map(row => ({ ...row, path: path.join(root, row.path) })); }
async function layout(label, root, source = false, options = {}) {
  await guard('pre-' + label);
  const captured = path.join(captureRoot, label); await fs.mkdir(captured, { recursive: true });
  const realRoot = path.join(working, label + '-real'); await fs.mkdir(realRoot);
  const before = await inventory(root);
  const rows = source ? binding.selected.map(row => ({ path: path.join(root, row.path), sha256: row.sha256 })) : await packageRows(root);
  let entry = path.join(HERE, 'worker.mjs');
  const extras = [];
  if (options.app) {
    entry = path.join(options.app, 'entry.mjs');
    if (!options.moved) await write(entry, `import { run as execute } from ${JSON.stringify(pathToFileURL(path.join(HERE, 'worker.mjs')).href)};\nexport async function run(packet) { packet.physicalResolve = import.meta.resolve('virtual-bash'); return execute(packet); }\n`);
    extras.push({ path: entry, sha256: sha(await fs.readFile(entry)) });
  }
  const moduleEntry = path.join(root, source ? 'src/commands/git/index.ts' : 'dist/commands/git/index.js');
  const packet = { mode: 'product', layout: label, candidate: binding.source, root, source, entry, loader: path.join(HERE, 'loader.mjs'), records: binding.records.path, recordsSha256: binding.records.sha256,
    capture: captured, realRoot, expectedCases: options.only?.length ?? 71, only: options.only, mutant: options.mutant,
    binding: { root, source, entry: moduleEntry, compiler: path.join(path.dirname(compiler), 'typescript.js'), files: [...rows, ...harnessFiles, ...extras], trace: path.join(captured, 'loads.jsonl') } };
  const execution = await child(label, packet, 120000);
  const report = JSON.parse(await fs.readFile(path.join(captured, 'RESULT.json')));
  need(!report.safety && report.executed === packet.expectedCases && report.nativeZlib.outstanding === 0 && report.nativeZlib.created === report.nativeZlib.closed, 'known complete cooperative cleanup');
  assert.deepEqual(await inventory(root), before, 'full product tree pre/post detects additions');
  await guard('post-' + label);
  const loads = (await fs.readFile(packet.binding.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const productLoads = loads.filter(row => row.file.startsWith(root + path.sep));
  need(productLoads.some(row => row.file === moduleEntry && row.sha256 === rows.find(row => row.path === moduleEntry).sha256), 'actual candidate entry loaded');
  if (options.app) need(report.physicalResolve === pathToFileURL(path.join(root, 'dist/index.js')).href, 'physical app import.meta.resolve');
  return { ...report, code: execution.row.code, traceSha256: sha(await fs.readFile(packet.binding.trace)), uniqueProductModules: new Set(productLoads.map(row => row.file)).size, root, manifestSha256: sha(JSON.stringify(before)) };
}
async function main() {
  need(/^[a-f0-9]{40}$/.test(result.preseal ?? ''), 'explicit committed preseal hash');
  const flag = await fs.readFile('/tmp/safe-bash-git-native-bridge-prep-result.txt'); need(sha(flag) === seal.nativePrepClosed.sha256, 'native preparation closure flag unchanged');
  result.nativePrepClosed = seal.nativePrepClosed;
  await guard('initial');
  await fs.mkdir(working); await fs.mkdir(captureRoot);
  const control = await child('control', { mode: 'control' }, 30000);
  need(control.row.code === 0 && control.stdout.toString() === 'bounded-node-ipc-control\n' && control.stderr.length === 0, 'one actual control cohort');
  const inputs = JSON.parse(await fs.readFile(path.join(HERE, 'INPUTS.json')));
  const source = path.join(working, 'source'); await fs.mkdir(source);
  for (const row of inputs) { const bytes = Buffer.from(row.base64, 'base64'); need(sha(bytes) === row.sha256, 'exact archived source input'); await write(path.join(source, row.path), bytes, row.mode); }
  const sourceBefore = await inventory(source);
  const build = await child('build', { mode: 'compiler', compiler, args: ['-p', path.join(source, 'tsconfig.build.json'), '--typeRoots', typeRoots] }, 120000);
  need(build.row.code === 0, 'actual source snapshot compiler build succeeds');
  const packageBytes = Buffer.from((await fs.readFile(seal.packagePath)).toString().trim(), 'base64'); need(sha(packageBytes) === seal.packageSha256, 'author full898 package data');
  const members = untar(gunzipSync(packageBytes, { maxOutputLength: 32 * 1024 * 1024 }));
  for (const member of members.filter(row => row.path.startsWith('dist/'))) need(sha(await fs.readFile(path.join(source, member.path))) === sha(member.data), `actual emitted/package byte equality ${member.path}`);
  result.build = { code: build.row.code, selectedInputs: inputs.length, sourceManifest: sha(JSON.stringify(sourceBefore)), emitted: (await inventory(path.join(source, 'dist'))).filter(row => !row.directory).length, packageMatchingEmitted: true };
  result.layouts.push(await layout('source', source, true));
  result.layouts.push(await layout('compiled', source));
  const app = path.join(working, 'app'), installed = path.join(app, 'node_modules/virtual-bash');
  await write(path.join(app, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const member of members) await write(path.join(installed, member.path), member.data, member.mode);
  result.layouts.push(await layout('manual-staged', installed, false, { app }));
  const movedApp = path.join(working, 'moved app'); await fs.rename(app, movedApp);
  const moved = path.join(movedApp, 'node_modules/virtual-bash');
  await assert.rejects(fs.stat(app), { code: 'ENOENT' });
  result.layouts.push(await layout('physically-moved', moved, false, { app: movedApp, moved: true }));
  result.package = { sha256: sha(packageBytes), files: members.length, baselineUnchanged: 858, installation: 'manual verified full tar-payload staging, not npm installation', physicalMove: true, oldAppAbsent: true };
  const typeApp = path.join(working, 'type-app'); await write(path.join(typeApp, 'package.json'), '{"type":"module"}\n');
  const specifier = path.join(moved, 'dist/commands/git/index.js');
  const cases = [
    ['positive', `import {createGitCommand,createGitCommands,gitCommands} from ${JSON.stringify(specifier)};\nimport type {CommandDefinition,VirtualShellPlugin} from ${JSON.stringify(path.join(moved, 'dist/contracts/index.js'))};\nconst command:CommandDefinition=createGitCommand({replace:false,discoveryBoundary:'/repo'});\nconst family:readonly CommandDefinition[]=createGitCommands();\nconst plugin:VirtualShellPlugin=gitCommands();\nvoid [command,family,plugin];\n`, 0, null],
    ['negative-limits', `import {createGitCommand} from ${JSON.stringify(specifier)};createGitCommand({limits:{maxObjects:1}});\n`, 2, 'TS2353'],
    ['negative-native', `import {gitCommands} from ${JSON.stringify(specifier)};gitCommands({spawn:()=>undefined});\n`, 2, 'TS2353'],
    ['negative-boundary', `import {createGitCommands} from ${JSON.stringify(specifier)};createGitCommands({discoveryBoundary:1});\n`, 2, 'TS2322'],
    ['negative-public-root', `import {createGitCommand} from ${JSON.stringify(path.join(moved, 'dist/index.js'))};void createGitCommand;\n`, 2, 'TS2305'],
  ];
  for (const [name, text, code, diagnostic] of cases) {
    const file = path.join(typeApp, name + '.ts'); await write(file, text);
    const outcome = await child('types-' + name, { mode: 'compiler', compiler, args: ['--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', 'false', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', typeRoots, file] }, 120000);
    const output = outcome.stdout.toString() + outcome.stderr.toString();
    result.types.push({ name, expectedCode: code, code: outcome.row.code, diagnostic, passed: outcome.row.code === code && (!diagnostic || output.includes(diagnostic)), consumerSha256: sha(text) });
  }
  for (const mutant of seal.mutants) {
    const root = path.join(working, 'mutant-' + mutant.id);
    for (const member of members) {
      let data = member.data;
      if (member.path === mutant.file) data = Buffer.from(`globalThis.__reviewMutant = ${JSON.stringify(mutant.id)};\n` + data.toString().replace(mutant.needle, mutant.replacement));
      if (member.path === mutant.file) need(sha(data) === mutant.mutatedSha256, 'exact presealed mutant copy');
      await write(path.join(root, member.path), data, member.mode);
    }
    const report = await layout('mutant-' + mutant.id, root, false, { only: mutant.cases, mutant: mutant.id });
    result.mutants.push({ id: mutant.id, detected: report.fail === 1 && report.pass === 0 && report.mutantSentinel === mutant.id, sourceSha256: mutant.mutatedSha256, report });
  }
  for (const kind of ['entry', 'hash', 'import']) {
    const root = moved, rows = await packageRows(root), trace = path.join(captureRoot, `binding-${kind}-loads.jsonl`);
    const packet = { mode: 'product', entry: path.join(HERE, 'worker.mjs'), loader: path.join(HERE, 'loader.mjs'), binding: { root, entry: path.join(root, 'dist/commands/git/index.js'), files: [...rows, ...harnessFiles], trace } };
    if (kind === 'entry') packet.binding.entry = path.join(root, 'dist/commands/git/absent.js');
    if (kind === 'hash') packet.binding.files.find(row => row.path === packet.binding.entry).sha256 = '0'.repeat(64);
    if (kind === 'import') packet.entry = path.join(app, 'node_modules/virtual-bash/dist/commands/git/index.js');
    const outcome = await child('binding-' + kind, packet, 30000);
    const expected = { entry: 'BINDING_ENTRY_REFUSED', hash: 'BINDING_HASH_REFUSED', import: 'BINDING_IMPORT_REFUSED' }[kind];
    result.bindings.push({ kind, refused: outcome.row.code === 1 && outcome.stderr.toString().includes(expected) && !outcome.row.messages.some(row => row.kind === 'product-loaded'), code: outcome.row.code, expected });
  }
  await guard('final');
  const currentSource = await inventory(source); assert.deepEqual(currentSource.filter(row => !row.path.startsWith('dist/') && row.path !== 'dist'), sourceBefore, 'source inputs pre/post including new entries');
  for (const member of members) need(sha(await fs.readFile(path.join(moved, member.path))) === sha(member.data), 'moved payload post type/mutant binding checks');
  result.layoutEquality = [];
  for (const layoutResult of result.layouts.slice(1)) {
    let equal = true;
    for (const test of seal.cases) {
      const sourceCase = JSON.parse(await fs.readFile(path.join(captureRoot, 'source', test.id + '.json')));
      const actual = JSON.parse(await fs.readFile(path.join(captureRoot, layoutResult.layout, test.id + '.json')));
      if (JSON.stringify(sourceCase.observations) !== JSON.stringify(actual.observations) || sourceCase.status !== actual.status) equal = false;
    }
    result.layoutEquality.push({ layout: layoutResult.layout, exactObservationsAndStatusEqual: equal });
  }
  const captureTree = await inventory(captureRoot), workingTree = await inventory(working);
  result.storage = { captureBytes: captureTree.reduce((total, row) => total + (row.bytes ?? 0), 0), workingBytes: workingTree.reduce((total, row) => total + (row.bytes ?? 0), 0), reusedReadOnlyDependenciesBytes: binding.tools.flatMap(tool => tool.rows).reduce((total, row) => total + (row.bytes ?? 0), 0) };
  need(result.storage.captureBytes < 128 * 1024 * 1024 && result.storage.workingBytes + result.storage.captureBytes < 512 * 1024 * 1024, 'actual capture and working hard bounds');
  need(result.children.length === 17 && result.children.every(row => row.closed && row.signals.length === 0), 'all seventeen exact children settled');
  result.status = result.layouts.every(row => row.fail === 0) && result.types.every(row => row.passed) && result.mutants.every(row => row.detected) && result.bindings.every(row => row.refused) && result.layoutEquality.every(row => row.exactObservationsAndStatusEqual) ? 'SCOPED_PASS' : 'SCOPED_FAILURES';
}
try { await main(); }
catch (error) { result.status = 'FATAL_STOP'; result.fatal = { message: error.message, stack: error.stack }; }
result.finishMonotonicMs = now(); result.measuredPreparationAndRunMs = now() - binding.startMonotonicMs; result.priorInspectionReserveMs = binding.priorInspectionReserveMs;
await put(path.join(HERE, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, layouts: result.layouts.map(row => [row.layout, row.pass, row.fail]), children: result.children.length, fatal: result.fatal, path: path.join(HERE, 'RESULT.json') }));
process.exitCode = result.status === 'SCOPED_PASS' ? 0 : 1;
