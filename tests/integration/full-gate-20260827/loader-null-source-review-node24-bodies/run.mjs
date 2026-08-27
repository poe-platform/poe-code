import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../../..');
const candidate = '8670ebe8f0d39966c2de2638780437398e5f8490', evidence = 'd98b8321d75e455d8f850fe02d086d2c77088753';
const prefix = 'tests/integration/full-gate-20260827', successor = `${prefix}/combined-8670ebe8`;
const executable = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const runtimeHash = '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0';
const privateRoot = '/Users/kjopek/Workspace/poe-code', engine = join(privateRoot, 'packages/safejs');
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/loader-body-independent-')), source = join(temporary, 'source'), harness = join(temporary, 'harness');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const git = (args, cwd = repository, extra = {}) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, ...extra });
const blob = (path, revision = evidence) => git(['show', `${revision}:${path}`]);
const raw = Buffer.from(blob(`${successor}/attempt-v4/raw-capture.tar.gz.b64`).toString(), 'base64');
assert.equal(hash(raw), '8a2beed3df62cfc0ceabe1c8f8ca9730d9873aecbc2f741947a2702f072d7648');
const original = JSON.parse(execFileSync('/usr/bin/tar', ['-xOf', '-', './report.json'], { input: raw, timeout: 30000, maxBuffer: 64 * 1024 * 1024 }));
const summary = JSON.parse(blob(`${successor}/attempt-v4/SUMMARY.json`));
const files = summary.failures.filter(entry => entry.group === 'loader-file-startup').map(entry => entry.canonicalPath);
const report = { startedAt: new Date().toISOString(), candidate, evidence, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), originalRuntime: original.node, runtime: { executable, sha256: hash(readFileSync(executable)), version: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim() }, source: {}, tools: {}, phases: [], controls: [], wholeGate: false, sourceEdits: false, engineBuiltOrInstalled: false, privateExecution: false };
assert.equal(report.runtime.sha256, runtimeHash); assert.equal(report.runtime.version, 'v24.11.1'); assert.equal(files.length, 4);
const privateState = () => ({ head: git(['rev-parse', 'HEAD'], privateRoot).toString().trim(), status: git(['status', '--porcelain=v1'], privateRoot).toString(), indexSha256: hash(readFileSync(resolve(privateRoot, git(['rev-parse', '--git-path', 'index'], privateRoot).toString().trim()))) });
const census = root => {
  const result = [];
  const walk = (path = '') => { for (const name of readdirSync(join(root, path)).sort()) {
    if (['node_modules', '.git', 'dist', '.cache', '.turbo'].includes(name)) continue;
    const local = path ? `${path}/${name}` : name, stat = lstatSync(join(root, local)); assert.equal(stat.isSymbolicLink(), false, local);
    if (stat.isDirectory()) walk(local); else { assert.ok(stat.isFile()); const bytes = readFileSync(join(root, local)); result.push({ path: local, bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777 }); }
  } }; walk(); return result;
};
const tree = root => {
  const result = {};
  const walk = (path = '') => { for (const name of readdirSync(join(root, path)).sort()) {
    const local = path ? `${path}/${name}` : name, stat = lstatSync(join(root, local)); assert.equal(stat.isSymbolicLink(), false, local);
    if (stat.isDirectory()) { result[`${local}/`] = { directory: true, mode: stat.mode & 0o777 }; walk(local); }
    else { assert.ok(stat.isFile()); result[local] = { sha256: hash(readFileSync(join(root, local))), mode: stat.mode & 0o777 }; }
  } }; walk(); return result;
};
let privateBefore, privateFiles, beforeTree, env;
try {
  mkdirSync(source); mkdirSync(harness);
  const selection = ['src', 'tests/commands/metadata-stress', 'tests/commands/safejs', 'tests/integrations/safejs', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
  const tar = join(temporary, 'source.tar'); git(['archive', '-o', tar, candidate, ...selection]); execFileSync('/usr/bin/tar', ['-xf', tar, '-C', source], { timeout: 60000 });
  const entries = git(['ls-tree', '-rz', candidate, ...selection]).toString().split('\0').filter(Boolean);
  for (const row of entries) { const separator = row.indexOf('\t'), [mode, , object] = row.slice(0, separator).split(' '), path = row.slice(separator + 1), bytes = readFileSync(join(source, path)); assert.ok(['100644', '100755'].includes(mode)); assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), object); report.source[path] = { sha256: hash(bytes), mode, object }; }
  for (const [path, pin] of Object.entries(original.dependencies.root.files)) { const bytes = readFileSync(join(repository, 'node_modules', path)); assert.equal(hash(bytes), pin.sha256, path); write(join(source, 'node_modules', path), bytes); chmodSync(join(source, 'node_modules', path), pin.mode); assert.equal(lstatSync(join(source, 'node_modules', path)).nlink, 1); report.tools[path] = pin; }
  const objects = new Set(), historical = [];
  for (const requested of ['3a1025f53e502c3426ffee34eb8d8037b27c26f8', '9fa86b2f']) {
    const revision = git(['rev-parse', requested]).toString().trim(); historical.push(revision); objects.add(revision);
    for (const path of ['', 'tests', 'tests/commands', 'tests/commands/metadata-stress']) objects.add(git(['rev-parse', path ? `${revision}:${path}` : `${revision}^{tree}`]).toString().trim());
    for (const row of git(['ls-tree', '-rtz', revision, 'tests/commands/metadata-stress', 'package.json']).toString().split('\0').filter(Boolean)) objects.add(row.slice(0, row.indexOf('\t')).split(' ')[2]);
  }
  const pack = git(['pack-objects', '--stdout'], repository, { input: [...objects].join('\n') + '\n' });
  git(['init', '--quiet', '--template='], source); git(['index-pack', '--stdin'], source, { input: pack });
  report.historicalMetadata = { revisions: historical, objects: objects.size, packSha256: hash(pack), selection: 'Only requested committed metadata subtree/package blobs and traversal trees, two commit objects; no alternates/worktree/remotes/live index' };
  assert.equal(existsSync(join(source, '.git/objects/info/alternates')), false);
  const guardBytes = blob(`${successor}/import-guard.mjs`), guard = join(harness, 'import-guard.mjs'); assert.equal(hash(guardBytes), original.successorHarnessHashes['import-guard.mjs']); write(guard, guardBytes); report.guardSha256 = hash(guardBytes);
  for (const module of ['supervise.mjs', 'account.mjs']) { const bytes = blob(`${prefix}/${module}`); write(join(harness, module), bytes); report[module] = hash(bytes); }
  const { supervise } = await import(pathToFileURL(join(harness, 'supervise.mjs'))), { account } = await import(pathToFileURL(join(harness, 'account.mjs')));
  const policy = JSON.parse(blob(`${successor}/policy.json`)), mktemp = policy.native.find(entry => entry.name === 'mktemp');
  const nativeBytes = readFileSync(mktemp.origin); assert.equal(hash(nativeBytes), mktemp.sha256); const nativePath = join(source, mktemp.target.slice('snapshot:'.length)); write(nativePath, nativeBytes); chmodSync(nativePath, 0o755); report.nativeMktemp = { sha256: mktemp.sha256, origin: mktemp.origin, target: nativePath };
  privateBefore = privateState(); report.privateBefore = privateBefore; assert.equal(privateBefore.head, 'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e');
  privateFiles = census(engine); assert.deepEqual(privateFiles, original.prerequisites.safejs.files); report.privateInputs = privateFiles;
  const copied = join(temporary, 'safejs-engine');
  for (const entry of privateFiles) { const bytes = readFileSync(join(engine, entry.path)); assert.equal(hash(bytes), entry.sha256); write(join(copied, entry.path), bytes); chmodSync(join(copied, entry.path), entry.mode); assert.equal(lstatSync(join(copied, entry.path)).nlink, 1); }
  report.engineCopy = { files: privateFiles.length, treeSha256: hash(JSON.stringify(privateFiles)), root: copied, regularCopy: true, package: JSON.parse(readFileSync(join(copied, 'package.json'))) };
  assert.deepEqual(census(copied), privateFiles); assert.deepEqual(privateState(), privateBefore);
  env = Object.fromEntries(Object.entries(original.environment).map(([name, value]) => [name, value.replaceAll(original.temporary, temporary)]));
  env.PATH = `${join(temporary, 'native-bin')}:${dirname(executable)}:/usr/bin:/bin:/usr/sbin:/sbin`; env.FULL_GATE_TOOL_ROOTS = '[]';
  delete env.NODE_TEST_CONTEXT; delete env.METADATA_HELPER_COPY;
  for (const path of ['home', 'tmp', 'native-bin']) mkdirSync(join(temporary, path));
  write(join(harness, 'critical-source.json'), JSON.stringify(Object.fromEntries(['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => [path, report.source[path].sha256]))));
  write(join(harness, 'cleanup-expected.json'), blob(`${successor}/cleanup-expected.json`));
  const receipt = join(harness, 'runtime-receipt.mjs');
  write(receipt, `import{appendFileSync,readFileSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';appendFileSync(process.env.BODY_RUNTIME_RECEIPTS,JSON.stringify({pid:process.pid,execPath:process.execPath,realExecPath:realpathSync(process.execPath),sha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),version:process.version,argv:process.argv,execArgv:process.execArgv,cwd:process.cwd(),source:process.env.FULL_GATE_SOURCE,safejsRoot:process.env.SAFEJS_LOCAL_ROOT})+'\\n');\n`);
  env.NODE_OPTIONS = `--import=${pathToFileURL(guard).href} --import=${pathToFileURL(receipt).href}`;
  report.environment = env; report.receiptPreloadSha256 = hash(readFileSync(receipt));
  report.nativeMktemp.version = execFileSync(nativePath, ['--version'], { env, encoding: 'utf8', timeout: 5000 }).split('\n')[0];
  beforeTree = tree(source); report.sourceTreeBeforeSha256 = hash(JSON.stringify(beforeTree));
  const run = async (label, args, body = false) => {
    const stdout = join(output, `${label}.stdout.log`), stderr = join(output, `${label}.stderr.log`), receipts = join(output, `${label}.runtime.ndjson`), imports = join(output, `${label}.imports`);
    const phase = await supervise(executable, args, { cwd: source, env: { ...env, FULL_GATE_IMPORTS: imports, BODY_RUNTIME_RECEIPTS: receipts }, stdout, stderr, timeoutMs: 90000, maxOutputBytes: 16 * 1024 * 1024 });
    const text = readFileSync(stdout, 'utf8');
    const row = { label, ...phase, stdoutSha256: hash(text), stderrSha256: hash(readFileSync(stderr)), runtime: existsSync(receipts) ? readFileSync(receipts, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [], ...(body ? { accounting: account(text) } : {}) };
    assert.ok(row.runtime.length > 0); for (const value of row.runtime) { assert.equal(value.version, 'v24.11.1'); assert.equal(value.realExecPath, realpathSync(executable)); assert.equal(value.sha256, runtimeHash); assert.equal(value.source, source); assert.equal(value.safejsRoot, copied); }
    assert.equal(phase.closed, true); assert.equal(phase.survivors.length, 0);
    (body ? report.phases : report.controls).push(row);
    console.log(JSON.stringify({ label, status: phase.status, clean: phase.clean, ...(body ? { counts: row.accounting.summary } : {}) }));
    return row;
  };
  for (const [index, path] of files.entries()) {
    const phase = await run(`body-${index + 1}`, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', path], true); phase.entry = path;
    assert.deepEqual(tree(source), beforeTree, `Source/staged inputs or new-entry drift after ${path}`); assert.deepEqual(census(copied), privateFiles);
  }
  const probe = ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/commands/execution.ts');await import('./src/commands/env-split.ts');console.log('guard-positive');"];
  const positive = await run('guard-positive', probe); assert.equal(positive.status, 0);
  const target = join(source, 'src/commands/env-split.ts'), saved = readFileSync(target);
  try { write(target, Buffer.concat([saved, Buffer.from('\nexport const reviewTamper = true;\n')])); const negative = await run('guard-source-tamper', probe); assert.equal(negative.status, 1); assert.match(readFileSync(join(output, 'guard-source-tamper.stderr.log'), 'utf8'), /Frozen env source bytes: src\/commands\/env-split\.ts/u); }
  finally { write(target, saved); }
  const outside = join(temporary, '..', `${temporary.split('/').at(-1)}-outside.mjs`); assert.equal(existsSync(outside), false);
  try { write(outside, "throw new Error('OUTSIDE_BODY_EXECUTED');\n"); const negative = await run('guard-outside-source', ['--import', 'tsx', '--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(outside).href)})`]); assert.equal(negative.status, 1); const text = readFileSync(join(output, 'guard-outside-source.stderr.log'), 'utf8'); assert.match(text, /FROZEN_IMPORT_OUTSIDE/u); assert.doesNotMatch(text, /Error: OUTSIDE_BODY_EXECUTED/u); }
  finally { rmSync(outside, { force: true }); }
  assert.deepEqual(tree(source), beforeTree); assert.deepEqual(census(copied), privateFiles);
  report.sourceTreeAfterSha256 = hash(JSON.stringify(tree(source))); report.unchangedAndNoNewSourceEntries = true;
  report.counts = report.phases.reduce((total, phase) => { for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) total[key] += phase.accounting.summary[key]; return total; }, { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
  report.bodyAcceptance = report.phases.length === 4 && report.phases.every(phase => phase.status === 0 && phase.clean && phase.accounting.reconciled && phase.accounting.summary.skipped === 0);
  if (!report.bodyAcceptance) process.exitCode = 1;
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (privateBefore) { report.privateAfter = privateState(); report.privateUnchanged = JSON.stringify(privateBefore) === JSON.stringify(report.privateAfter); report.privateFilesAfter = census(engine); report.privateFilesUnchangedIncludingNewEntries = JSON.stringify(privateFiles) === JSON.stringify(report.privateFilesAfter); if (!report.privateUnchanged || !report.privateFilesUnchangedIncludingNewEntries) process.exitCode = 1; }
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString();
  write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n');
}
