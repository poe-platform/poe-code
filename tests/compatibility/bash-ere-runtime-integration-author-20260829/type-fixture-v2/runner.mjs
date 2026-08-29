import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const own = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const outer = fs.openSync(path.join(own, `${mode}.outer.jsonl`), 'ax');
const record = row => fs.writeSync(outer, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
record({ event: 'startup', role: mode === 'seal' ? 'A06' : 'A10', pid: process.pid, execPath: process.execPath });
const parent = path.dirname(own);
const repo = path.resolve(own, '../../../..');
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const startup = '/tmp/safe-bash-ere-runtime-type-v2-20260829-start.jsonl';
const begin = Date.parse(JSON.parse(fs.readFileSync(startup, 'utf8').split('\n')[0]).at);
const receipts = [];
let capture = 0;

function deadline() { if (Date.now() - begin >= 600000) throw new Error('fresh grant deadline'); }
function bind(filename) {
  deadline();
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error(`regular/size: ${filename}`);
  for (let cursor = path.dirname(filename); cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`linked ancestor ${cursor}`);
  }
  const descriptor = fs.openSync(filename, 'r');
  const hash = createHash('sha256');
  try {
    const buffer = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(descriptor, buffer)) !== 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: hash.digest('hex') };
}
function verify(row) {
  const actual = bind(row.path);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`identity mismatch ${row.path}`);
}
function save(name, data) { fs.writeFileSync(path.join(own, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o644 }); }
async function child(role, executable, args, cwd, milliseconds = 30000) {
  deadline();
  const stdout = fs.openSync(path.join(own, `${role}.stdout`), 'ax');
  const stderr = fs.openSync(path.join(own, `${role}.stderr`), 'ax');
  const instance = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: path.dirname(process.execPath), HOME: own, TMPDIR: own, LANG: 'C', TZ: 'UTC' } });
  const receipt = { role, executable, args, cwd, pid: instance.pid, retired: false };
  receipts.push(receipt);
  let failure;
  let finish;
  const settled = new Promise(resolve => { finish = resolve; });
  instance.once('error', error => { failure = error; });
  instance.once('close', (code, signal) => { Object.assign(receipt, { code, signal, retired: true }); finish(); });
  const accept = descriptor => bytes => {
    try {
      capture += bytes.length;
      fs.writeSync(descriptor, bytes);
      if (capture > 8 * 1024 * 1024) throw new Error('capture cap');
    } catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  };
  instance.stdout.on('data', accept(stdout));
  instance.stderr.on('data', accept(stderr));
  const timer = setTimeout(() => { failure ??= new Error('deadline'); instance.kill('SIGKILL'); }, Math.min(milliseconds, 600000 - (Date.now() - begin)));
  try { record({ event: 'enrolled', ...receipt }); }
  catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  await settled;
  clearTimeout(timer);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  record({ event: 'retired', ...receipt });
  if (failure) throw failure;
  deadline();
  return receipt;
}
const gitArgs = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40'];

function authenticate() {
  const authority = json(path.join(own, 'A07.stdout'));
  if (bind(path.join(parent, 'SEAL.json')).sha256 !== authority.sealSha256 || bind(path.join(parent, 'TYPE-01.post-census.json')).sha256 !== authority.compiledBinding) throw new Error('historical authority');
  const seal = json(path.join(parent, 'SEAL.json'));
  if (seal.transport !== '02782056c436c9f2a8319f73a9eb8e2b4b5aebd5' || seal.sources.length !== 305) throw new Error('selected composition');
  verify(seal.node);
  if (process.execPath !== seal.node.path) throw new Error('coordinator binary');
  const census = json(path.join(parent, 'TYPE-01.post-census.json'));
  const work = path.join(parent, 'TYPE-01');
  if (census.rows.length !== 1549) throw new Error('compiled census cardinality');
  const expected = new Set(census.rows.map(row => row.path));
  let visited = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('linked retained member');
      if (entry.isDirectory()) walk(filename);
      else { if (!expected.has(path.relative(work, filename))) throw new Error('extra retained member'); visited++; }
    }
  }
  walk(work);
  if (visited !== expected.size) throw new Error('missing retained member');
  for (const row of census.rows) verify({ ...row, path: path.join(work, row.path) });
  for (const row of seal.sources) verify({ ...row, path: path.join(work, 'candidate', row.relative) });
  for (const row of seal.tools) {
    const relative = path.relative(path.join(repo, 'node_modules'), row.path);
    if (relative.startsWith('..')) throw new Error('tool path');
    verify({ ...row, path: path.join(work, 'node_modules', relative) });
  }
  const original = fs.readFileSync(path.join(parent, 'positive.mts'), 'utf8');
  const corrected = original.replaceAll('parseShellAST', 'parseShell').replaceAll('"./candidate/', '"../TYPE-01/candidate/');
  if (fs.readFileSync(path.join(own, 'positive-v2.mts'), 'utf8') !== corrected) throw new Error('fixture delta');
  return { seal, census, work, sources: seal.sources.length, tools: seal.tools.length, members: census.rows.length };
}

try {
  if (mode === 'seal') {
    const history = await child('A07', '/usr/bin/git', [...gitArgs, 'cat-file', 'blob', '3b1a412af3bfa7c38a8f2796e815c4fdb26bfe27:tests/compatibility/bash-ere-runtime-integration-author-20260829/SOURCE-TYPE-HANDOFF.json'], repo);
    if (history.code !== 0) throw new Error('stored handoff');
    const input = authenticate();
    const fixtureNames = ['positive-v2.mts', 'runner.mjs', 'PRESEAL.md', 'ROLE-PLAN.json', 'A07.stdout'];
    save('SEAL-v2.json', { mode: 'type-only', sourceCommit: 'e013f817f', transport: input.seal.transport, retainedMembers: input.members, retainedSources: input.sources, retainedTools: input.tools, authority: bind(path.join(own, 'A07.stdout')), oldSeal: bind(path.join(parent, 'SEAL.json')), compiledCensus: bind(path.join(parent, 'TYPE-01.post-census.json')), node: input.seal.node, fixtures: fixtureNames.map(name => bind(path.join(own, name))), flags: input.seal.flags, expectedExit: 0, expectedStdout: '', expectedStderr: '', compilerMaximum: 2, compilerPlanned: 1 });
    const files = [...fixtureNames.filter(name => name !== 'A07.stdout'), 'A07.stdout', 'A07.stderr', 'SEAL-v2.json'].map(name => path.join(own, name));
    const added = await child('A08', '/usr/bin/git', [...gitArgs, 'add', '-N', '--', ...files], repo);
    if (added.code !== 0) throw new Error('intent-to-add');
    const committed = await child('A09', '/usr/bin/git', [...gitArgs, 'commit', '--only', '-m', 'test: seal ERE positive consumer public API correction', '--', ...files], repo);
    if (committed.code !== 0) throw new Error('preseal commit');
    record({ event: 'sealed', members: input.members, sources: input.sources, tools: input.tools });
  } else if (mode === 'type') {
    const seal = json(path.join(own, 'SEAL-v2.json'));
    for (const row of [...seal.fixtures, seal.authority, seal.oldSeal, seal.compiledCensus, seal.node]) verify(row);
    const input = authenticate();
    const receipt = await child('A11', seal.node.path, [path.join(input.work, 'node_modules/typescript/lib/tsc.js'), ...seal.flags, '--noEmit', '--typeRoots', path.join(input.work, 'node_modules/@types'), path.join(own, 'positive-v2.mts')], own);
    authenticate();
    for (const row of seal.fixtures) verify(row);
    const stdout = bind(path.join(own, 'A11.stdout'));
    const stderr = bind(path.join(own, 'A11.stderr'));
    save('RESULT-v2.json', { pass: receipt.code === 0 && stdout.size === 0 && stderr.size === 0, receipt, stdout, stderr, retainedMembers: input.members, retainedSources: input.sources, retainedTools: input.tools, capture, elapsedFromFreshStartMs: Date.now() - begin, compilerStarts: 1, runtimeImports: 0, Workers: 0, originalPositive: 'TS2724 preserved, not rescored', oldAdministrativeCensus: 'uncertified64 preserved', obligations: '70 UNRUN' });
    if (receipt.code !== 0 || stdout.size || stderr.size) process.exitCode = 1;
  } else throw new Error('invalid mode');
  record({ event: 'complete', receipts, capture, elapsedMs: Date.now() - begin });
} catch (error) {
  record({ event: 'STOP', message: String(error), receipts, capture });
  process.exitCode = 78;
} finally { fs.closeSync(outer); }
