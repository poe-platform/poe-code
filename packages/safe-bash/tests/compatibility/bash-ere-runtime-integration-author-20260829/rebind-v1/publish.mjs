import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const outer = fs.openSync(path.join(own, 'A22-final.jsonl'), 'ax');
const record = value => fs.writeSync(outer, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
record({ role: 'A22', event: 'startup', pid: process.pid, execPath: process.execPath });
const repo = path.resolve(own, '../../../..');
const startup = '/tmp/safe-bash-ere-rebind-v1-20260829-start.jsonl';
const begin = Date.parse(JSON.parse(fs.readFileSync(startup, 'utf8').split('\n')[0]).at);
const json = name => JSON.parse(fs.readFileSync(path.join(own, name), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
function deadline() { if (Date.now() - begin >= 1500000) throw new Error('publication deadline'); }
function bind(filename) {
  deadline();
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error('regular/size');
  const descriptor = fs.openSync(filename, 'r');
  const hash = createHash('sha256');
  try {
    const bytes = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(descriptor, bytes))) hash.update(bytes.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: hash.digest('hex') };
}
function inventory(root) {
  const rows = [];
  let bytes = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('linked output');
      if (entry.isDirectory()) visit(filename);
      else {
        const row = bind(filename);
        bytes += row.size;
        if (bytes > 512 * 1024 * 1024 || rows.length > 20000) throw new Error('publication storage cap');
        rows.push({ ...row, path: path.relative(root, filename), kind: 'file' });
      }
    }
  }
  visit(root);
  rows.sort((left, right) => order(left.path, right.path));
  return { bytes, rows };
}
function verify(row, filename = row.path) {
  const actual = bind(filename);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`postbinding ${filename}`);
}
const gitFlags = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40'];
const finalReceipts = [];
async function git(role, args) {
  deadline();
  const stdout = fs.openSync(path.join(own, `${role}.stdout`), 'ax');
  const stderr = fs.openSync(path.join(own, `${role}.stderr`), 'ax');
  const instance = spawn('/usr/bin/git', [...gitFlags, ...args], { cwd: repo, stdio: ['ignore', stdout, stderr] });
  const receipt = { role, pid: instance.pid, args, retired: false };
  finalReceipts.push(receipt);
  let failure;
  let finish;
  const settled = new Promise(resolve => { finish = resolve; });
  instance.once('error', error => { failure = error; });
  instance.once('close', (code, signal) => { Object.assign(receipt, { code, signal, retired: true }); finish(); });
  const timer = setTimeout(() => { failure ??= new Error('Git timeout'); instance.kill('SIGKILL'); }, Math.min(30000, 1500000 - (Date.now() - begin)));
  try { record({ event: 'enrolled', ...receipt }); }
  catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  await settled;
  clearTimeout(timer);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  record({ event: 'retired', ...receipt });
  if (failure || receipt.code !== 0) throw failure ?? new Error(role);
  return fs.readFileSync(path.join(own, `${role}.stdout`));
}

try {
  const seal = json('SEAL.json');
  for (const row of seal.fixtures) verify(row);
  verify(seal.node);
  const compiled = json('COMPILED.json');
  const actual = inventory(path.join(own, 'candidate'));
  if (JSON.stringify(actual) !== JSON.stringify(compiled)) throw new Error('full compiled postproducer census');
  for (const row of seal.sources) verify({ size: row.bytes, mode: Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256 }, path.join(own, 'candidate', row.path));
  for (const row of seal.typescript) verify(row, path.join(own, 'node_modules', path.relative(path.join(repo, 'node_modules'), row.path)));
  const logs = name => fs.readFileSync(path.join(own, name), 'utf8').trim().split('\n').map(JSON.parse);
  const sealLogs = logs('seal.outer.jsonl');
  const produceLogs = logs('produce.outer.jsonl');
  const stop = produceLogs.at(-1);
  if (stop.event !== 'STOP' || stop.message !== 'Error: single package producer failure' || stop.receipts.length !== 4 || stop.receipts.some(row => !row.retired || row.signal !== null)) throw new Error('failure role classification');
  const [build, positive, negative, producer] = stop.receipts;
  if (build.code !== 0 || positive.code !== 0 || negative.code !== 2 || producer.code !== 1) throw new Error('outcome classification');
  const diagnostics = fs.readFileSync(path.join(own, 'A17.stdout'), 'utf8');
  const codes = [...diagnostics.matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
  const locations = [...diagnostics.matchAll(/negative\.mts\((\d+),\d+\)/g)].map(match => Number(match[1]));
  if (JSON.stringify(codes) !== '[2322,2353,2353]' || JSON.stringify(locations) !== '[4,5,6]') throw new Error('negative diagnostics');
  if (fs.readdirSync(path.join(own, 'package')).length || fs.existsSync(path.join(own, 'PRE-INFLATE-RECEIPT.json'))) throw new Error('unexpected archive state');
  const privateCompiledAssets = compiled.rows.filter(row => row.path.startsWith('dist/commands/regex-execution/ere/'));
  const working = inventory(own);
  const report = {
    status: 'SOURCE_TYPES_PASS_PACKAGE_PRODUCER_HOLD',
    presealCommit: 'e3dbccd26c1024619e55c13501d49f3a03128e1a',
    sealSha256: bind(path.join(own, 'SEAL.json')).sha256,
    core: seal.coreAuthority,
    integrationSource: seal.sourceCommit,
    engine: seal.engineCommit,
    transport: seal.transportCommit,
    selectedShippingTree: seal.selectedTree,
    selectedInputs: seal.sources.length,
    sourceGroups: seal.counts,
    sourceManifest: bind(path.join(own, 'SOURCE.json')),
    completeCompiledManifest: bind(path.join(own, 'COMPILED.json')),
    compiledMembers: compiled.rows.length,
    sourceAndCompiledPostguard: 'all paths/size/mode/hash match; no added candidate members',
    node: seal.node,
    typescriptFiles: seal.typescript.length,
    npmRegularFiles: seal.npm.rows.filter(row => row.kind === 'file').length,
    npmBoundLinks: seal.npm.rows.filter(row => row.kind === 'link').length,
    toolManifest: bind(path.join(own, 'TOOLS.json')),
    exports: seal.exports,
    runtimeDependencies: seal.dependencies,
    privateCompiledAssets,
    compilerResults: { build: build.code, positive: positive.code, negative: negative.code, codes, locations },
    producer: { code: producer.code, stderr: bind(path.join(own, 'A18.stderr')), reason: 'same regular file configured for both npm user and global configuration', attempts: 1 },
    package: { files: 0, archiveHash: null, firstInflations: 0, qualification: 'No archive produced; no full package claim or package acceptance' },
    observedChildren: [...sealLogs.filter(row => row.event === 'retired'), ...produceLogs.filter(row => row.event === 'retired')],
    knownRolesBeforeFinalPublication: 22,
    finalGitRolesNotYetCredited: ['A23', 'A24', 'A25'],
    expectedKnownRolesAfterFinalPublication: 25,
    knownPeak: 2,
    snapshotElapsedMs: Date.now() - begin,
    capturedChildBytes: sealLogs.at(-1).capture + stop.capture,
    workingBytesBeforeReportPublication: working.bytes,
    captureQualification: 'Child byte counts are exact from coordinator sinks; final Git capture and outer receipts are separate retained files.',
    oldCampaign: 'uncertified64 preserved; original TS2724 and source-review path failure unrescored',
    runtimeImports: 0,
    Workers: 0,
    obligations: '70 integration UNRUN; actual transport60 acceptance separately pending',
    nextRequiredGrant: 'Narrow producer-only distinct empty user/global npm config paths, no rebuild/type retry needed; retain all compression guards.'
  };
  fs.writeFileSync(path.join(own, 'SOURCE-REPORT.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  fs.copyFileSync(startup, path.join(own, 'A01-startup-preserved.jsonl'), fs.constants.COPYFILE_EXCL);
  const files = fs.readdirSync(own, { withFileTypes: true }).filter(entry => entry.isFile() && !/^A2[2-5]-/.test(entry.name)).map(entry => path.join(own, entry.name));
  await git('A23-add', ['add', '-N', '--', ...files]);
  const commit = await git('A24-commit', ['commit', '--only', '-m', 'docs: preserve complete ERE rebind types and producer setup failure', '--', ...files]);
  const index = await git('A25-index-after', ['diff', '--cached', '--raw', '--no-abbrev', '-z']);
  const before = fs.readFileSync(path.join(own, 'A03-index-before.raw'));
  const final = { event: 'complete', knownRoles: 25, peakKnown: 2, elapsedMs: Date.now() - begin, indexRawIdentical: before.equals(index), finalReceipts, qualification: 'Final receipt/raw commit files retained after their own commit; no retry, product changes or runtime.' };
  record(final);
  console.log(commit.toString('utf8').split('\n').slice(0, 2).join('\n'));
  console.log(JSON.stringify({ tree: report.selectedShippingTree, inputs: report.selectedInputs, compiled: report.compiledMembers, privateAssets: privateCompiledAssets.length, typescript: report.typescriptFiles, npmFiles: report.npmRegularFiles, npmLinks: report.npmBoundLinks, seal: report.sealSha256, status: report.status, childCapture: report.capturedChildBytes, storage: report.workingBytesBeforeReportPublication, elapsedMs: final.elapsedMs, indexRawIdentical: final.indexRawIdentical }));
} catch (error) {
  record({ event: 'PUBLICATION_STOP', message: String(error), finalReceipts });
  process.exitCode = 78;
} finally { fs.closeSync(outer); }
