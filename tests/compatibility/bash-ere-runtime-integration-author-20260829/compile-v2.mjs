import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const outer = fs.openSync(path.join(own, `v2-${mode}.outer.jsonl`), 'ax');
const started = Date.now();
const event = value => fs.writeSync(outer, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
event({ event: 'startup', pid: process.pid, execPath: process.execPath, mode });
const repo = path.resolve(own, '../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const emit = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
const overrides = ['parser', 'conditional', 'runtime', 'shell'].map(name => `src/shell/${name}.ts`);
let capture = 0;
let starts = 0;
const receipts = [];

function regular(filename) {
  let cursor = path.resolve(filename);
  const stat = fs.lstatSync(cursor);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`not regular: ${filename}`);
  for (cursor = path.dirname(cursor); cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`linked ancestor: ${cursor}`);
  }
  return stat;
}

function binding(filename) {
  const stat = regular(filename);
  if (stat.size > 128 * 1024 * 1024) throw new Error('file cap');
  const digest = createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  try {
    const chunk = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(descriptor, chunk)) > 0) digest.update(chunk.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}

function verify(row) {
  const actual = binding(row.path);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`binding mismatch: ${row.path}`);
}

function copy(source, target) {
  regular(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, fs.statSync(source).mode & 0o777);
  const left = binding(source);
  const right = binding(target);
  if (left.size !== right.size || left.sha256 !== right.sha256 || left.mode !== right.mode) throw new Error('copy integrity');
}

function census(directory) {
  const rows = [];
  let bytes = 0;
  function visit(parent) {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : 1)) {
      const filename = path.join(parent, entry.name);
      if (entry.isSymbolicLink()) throw new Error('linked output');
      if (entry.isDirectory()) visit(filename);
      else {
        const row = binding(filename);
        bytes += row.size;
        if (bytes > 256 * 1024 * 1024) throw new Error('working storage cap');
        rows.push({ ...row, path: path.relative(directory, filename) });
      }
    }
  }
  visit(directory);
  return { bytes, rows };
}

async function child(node, args, cwd, name, milliseconds) {
  if (++starts > 3 || Date.now() - started > 600000) throw new Error('compiler grant cap');
  const stdout = fs.openSync(path.join(own, `${name}.stdout`), 'ax');
  const stderr = fs.openSync(path.join(own, `${name}.stderr`), 'ax');
  let reason;
  const processChild = spawn(node, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: path.dirname(node), HOME: cwd, TMPDIR: cwd, LANG: 'C', TZ: 'UTC' } });
  const receipt = { name, pid: processChild.pid, argv: [node, ...args], cwd, started: new Date().toISOString(), retired: false };
  receipts.push(receipt);
  let finish;
  const settled = new Promise(resolve => { finish = resolve; });
  processChild.once('error', error => { reason = error; });
  processChild.once('close', (code, signal) => { receipt.code = code; receipt.signal = signal; receipt.retired = true; finish(); });
  const consume = descriptor => bytes => {
    capture += bytes.length;
    try {
      fs.writeSync(descriptor, bytes);
      if (capture > 32 * 1024 * 1024) throw new Error('capture cap');
    } catch (error) { reason ??= error; processChild.kill('SIGKILL'); }
  };
  processChild.stdout.on('data', consume(stdout));
  processChild.stderr.on('data', consume(stderr));
  const timer = setTimeout(() => { reason ??= new Error('child deadline'); processChild.kill('SIGKILL'); }, milliseconds);
  try { event({ event: 'enrolled', ...receipt }); }
  catch (error) { reason ??= error; processChild.kill('SIGKILL'); }
  await settled;
  clearTimeout(timer);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  event({ event: 'retired', ...receipt });
  if (reason) throw reason;
  return receipt;
}

try {
  const catalogPath = path.join(own, 'BINDINGS.json');
  const catalog = json(catalogPath);
  if (catalog.bindings.length !== 305 || catalog.transport !== '02782056c436c9f2a8319f73a9eb8e2b4b5aebd5') throw new Error('composition authority');
  const inheritedPath = path.join(repo, 'tests/compatibility/bash-ere-engine-author-20260829/r02-v2/SEAL.json');
  if (binding(inheritedPath).sha256 !== '4f6d24661fc75ab4f2bc26836a735f998a88591caf377fddff36f45709799b12') throw new Error('tool authority');
  const inherited = json(inheritedPath);
  const sources = catalog.bindings.map(row => {
    verify({ path: row.selectedPath, size: row.bytes, mode: Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256 });
    if (row.path.split('/').includes('AGENTS.md') || row.path.includes('..')) throw new Error('source path');
    const actual = binding(overrides.includes(row.path) ? path.join(repo, row.path) : row.selectedPath);
    return { ...actual, relative: row.path, baselineBlob: row.blob };
  });
  verify(inherited.node);
  for (const tool of inherited.tools) verify(tool);
  if (process.execPath !== inherited.node.path) throw new Error('coordinator binary');
  if (mode === 'seal') {
    const design = path.join(repo, 'tests/compatibility/bash-ere-runtime-integration-design-20260829');
    const documentation = json(path.join(design, 'DOCS-BINDINGS.json'));
    const rows = [];
    for (const [name, key] of [['references', 'programs'], ['hosts', 'protocols']]) {
      const filename = `docs/${name}.data`;
      const row = documentation.files.find(item => item.copy === filename);
      const bytes = fs.readFileSync(path.join(design, filename));
      if (!row || bytes.length !== row.bytes || sha(bytes) !== row.sha256) throw new Error('reference authority');
      for (const item of JSON.parse(bytes)[key]) rows.push({ ...item, status: 'UNRUN', authority: row.sha256 });
    }
    const expressions = ['E','! E','! ! E','! ( ! E )','E && T','E || T','E || F','F && E','T || E','T && E','F || E','E || E','! ( E || T )'];
    const statuses = [2,0,2,1,2,0,1,1,0,2,2,2,1,2,0,0,0,0,null,2,0,0,0,0,0];
    const scripts = expressions.map(value => `[[ ${value} ]]`);
    scripts.push('[[ E ]] && :','[[ E ]] || :','! [[ E ]]','[[ ! E ]] && :','[[ ! E ]] || :','[[ -n t || x =~ ( ]]','set -e; [[ E ]]; printf after','set -e; [[ E ]] || :; printf after','set -e; [[ ! E ]]; printf after','[[ ! x =~ z ]]','[[ E || x =~ (x) ]]','[[ ! ( E && T ) ]]');
    for (let index = 0; index < scripts.length; index++) rows.push({ id: `EC${String(index + 1).padStart(2, '0')}`, script: `bad='('; ${scripts[index].replace(/\bE\b/g, 'x =~ $bad').replace(/\bT\b/g, '-n t').replace(/\bF\b/g, "-n ''")}`, predictedStatus: statuses[index], status: 'UNRUN', qualification: 'SOURCE control-flow expectation; no native diagnostic golden; EC19 structural parse question' });
    const hosts = ['Private profile3 escapes inner logical evaluation, skipped leaves consume nothing', 'Outer command lists and inversion consume resulting status3 normally', 'Actual global Budget/caller/host protocol/sink errors retain provenance', 'Cleanup versus numeric2, falsy diagnostic and caller precedence', 'N14 exact invoke Promise versus derived Promise/thenable distinctions'];
    hosts.forEach((procedure, index) => rows.push({ id: `EH0${index + 1}`, procedure, status: 'UNRUN' }));
    if (rows.length !== 70 || new Set(rows.map(row => row.id)).size !== 70) throw new Error('case census');
    emit(path.join(own, 'CASEMAP.json'), { status: 'ALL_UNRUN', rows });
    const fixtures = ['compile-v2.mjs','PRESEAL.md','CASEMAP.json','positive.mts','negative.mts','BINDINGS.json'].map(name => binding(path.join(own, name)));
    emit(path.join(own, 'SEAL.json'), { authority: 'SOURCE/strict compiler only; transport rebind mandatory', core: catalog.core, engine: catalog.engine, transport: catalog.transport, sources, fixtures, node: inherited.node, tools: inherited.tools, flags: inherited.tscFlags, expectedCompilerChildren: 3, noRuntime: true });
    event({ event: 'sealed', sources: sources.length, tools: inherited.tools.length, cases: rows.length });
  } else if (mode === 'types') {
    const seal = json(path.join(own, 'SEAL.json'));
    for (const row of [...seal.sources, ...seal.fixtures, seal.node, ...seal.tools]) verify(row);
    const work = path.join(own, 'TYPE-01');
    fs.mkdirSync(work);
    const candidate = path.join(work, 'candidate');
    for (const row of seal.sources) copy(row.path, path.join(candidate, row.relative));
    for (const row of seal.tools) {
      const relative = path.relative(path.join(repo, 'node_modules'), row.path);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('tool containment');
      copy(row.path, path.join(work, 'node_modules', relative));
    }
    for (const name of ['positive.mts','negative.mts']) copy(path.join(own, name), path.join(work, name));
    emit(path.join(own, 'TYPE-01.pre-census.json'), census(work));
    const compiler = path.join(work, 'node_modules/typescript/lib/tsc.js');
    const roots = path.join(work, 'node_modules/@types');
    const build = await child(seal.node.path, [compiler, '-p', path.join(candidate, 'tsconfig.build.json'), '--typeRoots', roots], work, 'TYPE-01-build', 120000);
    let positive;
    let negative;
    if (build.code === 0) {
      positive = await child(seal.node.path, [compiler, ...seal.flags, '--noEmit', '--typeRoots', roots, path.join(work, 'positive.mts')], work, 'TYPE-02-positive', 30000);
      negative = await child(seal.node.path, [compiler, ...seal.flags, '--noEmit', '--typeRoots', roots, path.join(work, 'negative.mts')], work, 'TYPE-03-negative', 30000);
    }
    const diagnostics = negative ? fs.readFileSync(path.join(own, 'TYPE-03-negative.stdout'), 'utf8') : '';
    const codes = [...diagnostics.matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
    const locations = [...diagnostics.matchAll(/negative\.mts\((\d+),\d+\)/g)].map(match => Number(match[1]));
    const pass = build.code === 0 && positive?.code === 0 && negative?.code === 2 && JSON.stringify(codes) === '[2322,2353,2353]' && JSON.stringify(locations) === '[4,5,6]';
    for (const row of [...seal.sources, ...seal.fixtures, seal.node, ...seal.tools]) verify(row);
    emit(path.join(own, 'TYPE-01.post-census.json'), census(work));
    emit(path.join(own, 'TYPE-RESULT.json'), { pass, receipts, codes, locations, capture, elapsedMs: Date.now() - started, runtimeCases: 0, Workers: 0, qualifications: ['compiler/declaration evidence only', 'transport027 known SOURCE HOLD and future rebind', 'compiled output never imported'] });
    if (!pass) process.exitCode = 1;
  } else throw new Error('unknown mode');
  event({ event: 'complete', starts, capture, elapsedMs: Date.now() - started });
} catch (error) {
  event({ event: 'STOP', message: String(error), receipts, starts, capture });
  process.exitCode = 78;
} finally { fs.closeSync(outer); }

