import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashObject = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const demand = (value, message) => { if (!value) throw new Error(message); };
const preseal = JSON.parse(await fs.readFile(path.join(here, 'PRESEAL.json')));
let childCount = 0, totalOutput = 0, scratchBytes = 0;
const started = Date.now();
let output;
const receipt = { schema: 'git-m1a-author-run-v1', base: preseal.baseComposition, nativeGitExecutions: 0, children: [], checks: [], status: 'PREPARING' };

async function save() { if (output) await fs.writeFile(path.join(output, 'RESULT.json'), JSON.stringify(receipt, null, 2) + '\n'); }
async function write(file, bytes, mode = 0o644) {
  scratchBytes += Buffer.byteLength(bytes);
  demand(scratchBytes <= preseal.execution.maxScratchBytes, 'scratch bound');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes, { mode, flag: 'wx' });
}
async function child(label, executable, args, cwd, extra = {}, input) {
  demand(++childCount <= preseal.execution.maxSupervisedChildrenPerAttempt, 'child bound');
  demand(Date.now() - started < preseal.execution.maxAttemptSeconds * 1000, 'attempt deadline');
  const row = { label, executable, executableSha256: sha(await fs.readFile(executable)), args, cwd, pid: null, signals: [] };
  receipt.children.push(row);
  const instance = spawn(executable, args, { cwd, env: { PATH: path.dirname(preseal.execution.nodePath), HOME: output, TMPDIR: output, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  row.pid = instance.pid;
  const stdout = [], stderr = []; let size = 0, killed = false;
  const terminate = () => { killed = true; row.signals.push('SIGTERM'); instance.kill('SIGTERM'); setTimeout(() => { if (instance.exitCode === null && instance.signalCode === null) { row.signals.push('SIGKILL'); instance.kill('SIGKILL'); } }, 1000).unref(); };
  const timer = setTimeout(terminate, preseal.execution.maxChildSeconds * 1000);
  for (const [stream, pieces] of [[instance.stdout, stdout], [instance.stderr, stderr]]) stream.on('data', data => { size += data.length; totalOutput += data.length; if (size > preseal.execution.maxOutputBytesPerChild || totalOutput > preseal.execution.maxTotalOutputBytes) terminate(); else pieces.push(Buffer.from(data)); });
  instance.stdin.on('error', () => {});
  instance.stdin.end(input);
  let spawnError;
  instance.on('error', error => { spawnError = String(error); });
  const [code, signal] = await new Promise(resolve => instance.once('close', (...values) => resolve(values)));
  clearTimeout(timer);
  Object.assign(row, { code, signal, killed, spawnError, outputBytes: size, closed: true });
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  await write(path.join(output, `${childCount}-${label}.stdout`), out);
  await write(path.join(output, `${childCount}-${label}.stderr`), err);
  await save();
  return { code, out, err };
}

async function regularTree(root, containedLinks = false) {
  const entries = [];
  async function walk(relative) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
      demand(name !== 'AGENTS.md', 'instruction file must not be copied');
      const file = path.join(relative, name), stat = await fs.lstat(path.join(root, file));
      if (stat.isSymbolicLink()) {
        demand(containedLinks, `symlink refused: ${file}`);
        const target = await fs.realpath(path.join(root, file)), realRoot = await fs.realpath(root);
        demand(target.startsWith(realRoot + path.sep) && (await fs.stat(target)).isFile(), 'tool link must target contained regular file');
        entries.push({ path: file, link: await fs.readlink(path.join(root, file)), target: path.relative(realRoot, target), targetSha256: sha(await fs.readFile(target)) });
        continue;
      }
      if (stat.isDirectory()) await walk(file);
      else { demand(stat.isFile(), 'nonregular input'); const bytes = await fs.readFile(path.join(root, file)); entries.push({ path: file, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha(bytes) }); }
    }
  }
  await walk('');
  return entries;
}

async function main() {
  demand(process.argv.length === 3 && process.argv[2] === '--run', 'explicit --run required');
  demand(process.execPath === preseal.execution.nodePath && process.version === preseal.execution.nodeVersion && sha(await fs.readFile(process.execPath)) === preseal.execution.nodeSha256, 'pinned Node binding');
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'git-m1a-author-'));
  receipt.output = output;
  console.log(output);
  const encoded = await fs.readFile(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
  demand(sha(encoded) === preseal.baseEvidenceEncodedSha256, 'base receipt hash');
  const raw = JSON.parse(gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }));
  demand(raw.candidate === preseal.baseComposition && raw.source.inputs.length === 268, 'base identity');
  const fixture = await fs.readFile(path.join(repo, 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json'));
  demand(sha(fixture) === preseal.fixtureSha256, 'neutral fixture binding');
  const source = path.join(output, 'source');
  await fs.mkdir(source);
  const baseRows = raw.source.inputs;
  const git = '/usr/bin/git';
  const gitReal = await fs.realpath(git);
  const blobs = await child('development-exact-blobs', gitReal, ['cat-file', '--batch'], repo, { GIT_OPTIONAL_LOCKS: '0' }, baseRows.map(row => row.blob).join('\n') + '\n');
  demand(blobs.code === 0, 'development blob read failed');
  let offset = 0;
  for (const row of baseRows) {
    demand(!row.path.split('/').includes('AGENTS.md') && !row.path.startsWith('/') && !row.path.split('/').includes('..'), 'selected base path');
    const newline = blobs.out.indexOf(10, offset), header = blobs.out.subarray(offset, newline).toString();
    demand(header === `${row.blob} blob ${row.bytes}`, 'blob header'); offset = newline + 1;
    const bytes = blobs.out.subarray(offset, offset + row.bytes); offset += row.bytes + 1;
    demand(sha(bytes) === row.sha256 && hashObject('blob', bytes) === row.blob && blobs.out[offset - 1] === 10, 'base blob authentication');
    await write(path.join(source, row.path), bytes, Number.parseInt(row.mode, 8) & 0o777);
  }
  demand(offset === blobs.out.length, 'extra base bytes');
  const moduleRoot = path.join(repo, 'src/commands/git');
  const moduleRows = await regularTree(moduleRoot);
  for (const row of moduleRows) await write(path.join(source, 'src/commands/git', row.path), await fs.readFile(path.join(moduleRoot, row.path)), row.mode);
  receipt.moduleInputs = moduleRows;
  receipt.baseInputs = baseRows;
  receipt.tools = [];
  for (const name of ['typescript', '@types/node', 'undici-types']) {
    const from = path.join(repo, 'node_modules', name), rows = await regularTree(from);
    const metadata = JSON.parse(await fs.readFile(path.join(from, 'package.json')));
    demand(metadata.version === ({ typescript: '5.9.3', '@types/node': '22.20.1', 'undici-types': '6.21.0' })[name], 'devtool version');
    receipt.tools.push({ name, version: metadata.version, entries: rows });
    for (const row of rows) await write(path.join(source, 'node_modules', name, row.path), await fs.readFile(path.join(from, row.path)), row.mode);
  }
  const sourceBefore = await regularTree(path.join(source, 'src'));
  receipt.sourceManifestSha256 = sha(JSON.stringify(sourceBefore));
  const compiler = path.join(source, 'node_modules/typescript/lib/tsc.js');
  const build = await child('build', process.execPath, [compiler, '-p', 'tsconfig.build.json'], source);
  demand(build.code === 0, 'isolated build failed');
  const harness = path.join(output, 'harness');
  for (const name of ['cases.mjs', 'source-loader.mjs', 'package-loader.mjs', 'mutants.mjs', 'consumer.ts.fixture']) await write(path.join(harness, name), await fs.readFile(path.join(here, name)));
  await write(path.join(harness, 'fixture.json'), fixture);
  const binding = { root: source, inputs: sourceBefore, compiler: path.join(source, 'node_modules/typescript/lib/typescript.js'), output };
  await write(path.join(harness, 'source-binding.json'), JSON.stringify(binding));
  const sourceRun = await child('source', process.execPath, ['--loader', path.join(harness, 'source-loader.mjs'), path.join(harness, 'cases.mjs')], source, { GIT_AUTHOR_BINDING: path.join(harness, 'source-binding.json'), GIT_AUTHOR_LAYOUT: 'source', GIT_AUTHOR_ROOT: source, GIT_AUTHOR_RESULT: path.join(output, 'source-cases.json') });
  const packageRun = async (label, packageRoot, script = 'cases.mjs', extras = {}) => {
    const real = await fs.realpath(packageRoot);
    const entries = await regularTree(path.join(real, 'dist'));
    const file = path.join(harness, `${label}-binding.json`);
    await write(file, JSON.stringify({ root: real, inputs: entries, harness: await fs.realpath(harness), trace: path.join(output, `${label}-loads.jsonl`) }));
    return child(label, process.execPath, ['--loader', path.join(harness, 'package-loader.mjs'), path.join(harness, script)], packageRoot, { GIT_AUTHOR_BINDING: file, GIT_AUTHOR_ROOT: packageRoot, GIT_AUTHOR_RESULT: path.join(output, `${label}-cases.json`), ...extras });
  };
  const compiled = await packageRun('compiled', source);
  demand(sourceRun.code === 0 && compiled.code === 0, 'author semantic controls failed');
  const npm = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  const npmRoot = path.dirname(path.dirname(npm));
  receipt.npmClosure = await regularTree(npmRoot, true);
  const packed = await child('pack', process.execPath, [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--cache', path.join(output, 'npm-cache')], source);
  demand(packed.code === 0, 'offline pack failed');
  const filename = JSON.parse(packed.out.toString())[0].filename;
  const tarball = path.join(source, filename); receipt.packageSha256 = sha(await fs.readFile(tarball));
  const installed = path.join(output, 'installed');
  await write(path.join(installed, 'package.json'), '{"private":true,"type":"module"}\n');
  const install = await child('install', process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--cache', path.join(output, 'npm-cache'), tarball], installed);
  demand(install.code === 0, 'offline install failed');
  const installedRoot = path.join(installed, 'node_modules/virtual-bash');
  const packageBefore = await regularTree(installedRoot); receipt.packageFiles = packageBefore;
  const installedRun = await packageRun('installed', installedRoot);
  demand(installedRun.code === 0, 'installed controls failed');
  const moved = path.join(output, 'moved package'); await fs.rename(installed, moved);
  const movedRoot = path.join(moved, 'node_modules/virtual-bash');
  const movedRun = await packageRun('moved', movedRoot);
  demand(movedRun.code === 0, 'moved controls failed');
  const consumer = (await fs.readFile(path.join(harness, 'consumer.ts.fixture'), 'utf8')).replaceAll('PACKAGE_LEAF', path.join(movedRoot, 'dist/commands/git/index.js'));
  await write(path.join(moved, 'consumer.ts'), consumer);
  const types = await child('types', process.execPath, [compiler, '--strict', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--typeRoots', path.join(source, 'node_modules/@types'), path.join(moved, 'consumer.ts')], moved);
  demand(types.code === 0, 'strict consumer/types negatives failed');
  for (const [name, relative, original, replacement] of [
    ['hash', 'codec.js', 'await session.hash(body, type) === oid', 'true'],
    ['pack', 'repository.js', 'children.length === 0', 'true'],
    ['exit', 'queries.js', 'return different && (parsed.flags.has("--quiet") || parsed.flags.has("--exit-code")) ? 1 : 0;', 'return 0;'],
  ]) {
    const mutantRoot = path.join(output, `mutant-${name}`);
    for (const row of packageBefore) await write(path.join(mutantRoot, row.path), await fs.readFile(path.join(movedRoot, row.path)), row.mode);
    const target = path.join(mutantRoot, 'dist/commands/git', relative), text = await fs.readFile(target, 'utf8');
    demand(text.split(original).length === 2, 'mutant must replace exactly one site');
    await fs.writeFile(target, text.replace(original, replacement));
    const mutated = await packageRun(`mutant-${name}`, mutantRoot, 'mutants.mjs', { GIT_AUTHOR_MUTANT: name });
    demand(mutated.code === 1 && mutated.out.toString().includes('"observed":0'), 'loaded semantic mutant not specifically detected');
    receipt.checks.push({ name: `loaded-${name}-mutant`, status: 'DETECTED', mutatedFileSha256: sha(await fs.readFile(target)) });
  }
  for (const kind of ['missing', 'changed', 'outside']) {
    const original = JSON.parse(await fs.readFile(path.join(harness, 'moved-binding.json')));
    const row = original.inputs.find(row => row.path === 'commands/git/index.js');
    if (kind === 'missing') original.inputs = original.inputs.filter(value => value !== row);
    if (kind === 'changed') row.sha256 = '0'.repeat(64);
    if (kind === 'outside') original.root = path.join(output, 'wrong-package');
    original.trace = path.join(output, `negative-${kind}-loads.jsonl`);
    const file = path.join(harness, `negative-${kind}.json`); await write(file, JSON.stringify(original));
    const negative = await child(`binding-${kind}`, process.execPath, ['--loader', path.join(harness, 'package-loader.mjs'), path.join(harness, 'mutants.mjs')], moved, { GIT_AUTHOR_BINDING: file, GIT_AUTHOR_ROOT: movedRoot, GIT_AUTHOR_MUTANT: 'hash' });
    demand(negative.code !== 0 && /package (binding|hash|outside)/.test(negative.err.toString()), 'binding control wrong failure');
    receipt.checks.push({ name: `binding-${kind}`, status: 'REFUSED' });
  }
  demand(JSON.stringify(sourceBefore) === JSON.stringify(await regularTree(path.join(source, 'src'))), 'isolated source changed');
  demand(JSON.stringify(packageBefore) === JSON.stringify(await regularTree(movedRoot)), 'installed package changed');
  demand(JSON.stringify(moduleRows) === JSON.stringify(await regularTree(moduleRoot)), 'author source drifted');
  demand(JSON.stringify(receipt.npmClosure) === JSON.stringify(await regularTree(npmRoot, true)), 'npm tool closure changed');
  receipt.status = 'AUTHOR_SCOPED_PASS'; receipt.elapsedMs = Date.now() - started; receipt.scratchBytesCharged = scratchBytes;
  await save(); console.log(JSON.stringify({ output, status: receipt.status, packageSha256: receipt.packageSha256 }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { receipt.status = 'FAILED'; receipt.error = String(error?.stack ?? error); await save(); console.error(receipt.error); process.exitCode = 1; }
}
