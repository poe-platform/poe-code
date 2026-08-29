import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const outer = fs.openSync(path.join(own, `${mode}.outer.jsonl`), 'ax');
const record = value => fs.writeSync(outer, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
record({ event: 'startup', role: mode === 'seal' ? 'A05' : 'A09', pid: process.pid, execPath: process.execPath });
const parent = path.dirname(own);
const repo = path.resolve(own, '../../../../..');
const candidate = path.join(parent, 'candidate');
const begin = Date.parse(JSON.parse(fs.readFileSync('/tmp/safe-bash-ere-producer-v2-20260829-start.jsonl', 'utf8').split('\n')[0]).at);
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(own, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const gitFlags = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40'];
let capture = 0;
const receipts = [];
function deadline() { if (Date.now() - begin >= 600000) throw new Error('fresh deadline'); }
function binding(filename, archive = false) {
  deadline();
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (archive ? 16777216 : 134217728)) throw new Error(`regular/size ${filename}`);
  for (let cursor = path.dirname(filename); cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('linked ancestor');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const hashes = [createHash('sha256'), createHash('sha1'), createHash('sha512')];
  let total = 0;
  try {
    const bytes = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(descriptor, bytes))) {
      total += count;
      if (total > stat.size) throw new Error('stream size drift');
      for (const digest of hashes) digest.update(bytes.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  if (total !== stat.size) throw new Error('stream truncated');
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: hashes[0].digest('hex'), sha1: hashes[1].digest('hex'), integrity: `sha512-${hashes[2].digest('base64')}` };
}
function verify(row, filename = row.path) {
  const actual = binding(filename);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`binding mismatch ${filename}`);
}
function inventory(root, links = false) {
  const rows = [];
  let bytes = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isSymbolicLink()) {
        if (!links) throw new Error('linked member');
        const resolved = fs.realpathSync(filename);
        if (!resolved.startsWith(`${root}/`)) throw new Error('external or cyclic tool link');
        const target = binding(resolved);
        rows.push({ path: relative, kind: 'link', mode: fs.lstatSync(filename).mode & 0o777, text: fs.readlinkSync(filename), target: path.relative(root, resolved), targetSha256: target.sha256, targetSize: target.size });
      } else {
        const { sha1, integrity, ...row } = binding(filename);
        bytes += row.size;
        if (bytes > 268435456 || rows.length > 10000) throw new Error('inventory cap');
        rows.push({ ...row, path: relative, kind: 'file' });
      }
    }
  }
  walk(root);
  rows.sort((left, right) => order(left.path, right.path));
  return { bytes, rows };
}
function same(left, right, label) { if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label} drift`); }
async function child(role, executable, args, cwd, env) {
  deadline();
  const stdout = fs.openSync(path.join(own, `${role}.stdout`), 'ax');
  const stderr = fs.openSync(path.join(own, `${role}.stderr`), 'ax');
  const instance = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: env ?? { PATH: path.dirname(process.execPath), HOME: own, TMPDIR: own, LANG: 'C', TZ: 'UTC' } });
  const receipt = { role, pid: instance.pid, executable, args, cwd, retired: false };
  receipts.push(receipt);
  let failure;
  let finish;
  const settled = new Promise(resolve => { finish = resolve; });
  instance.once('error', error => { failure = error; });
  instance.once('close', (code, signal) => { Object.assign(receipt, { code, signal, retired: true }); finish(); });
  const consume = descriptor => bytes => {
    try { capture += bytes.length; fs.writeSync(descriptor, bytes); if (capture > 8388608) throw new Error('capture cap'); }
    catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  };
  instance.stdout.on('data', consume(stdout));
  instance.stderr.on('data', consume(stderr));
  const timer = setTimeout(() => { failure ??= new Error('child deadline'); instance.kill('SIGKILL'); }, Math.min(60000, 600000 - (Date.now() - begin)));
  try { record({ event: 'enrolled', ...receipt }); }
  catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  await settled;
  clearTimeout(timer);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  record({ event: 'retired', ...receipt });
  if (failure) throw failure;
  if (receipt.code !== 0) throw new Error(`${role} exit${receipt.code}`);
  deadline();
  return receipt;
}
async function commit(addRole, commitRole, files, message) {
  await child(addRole, '/usr/bin/git', [...gitFlags, 'add', '-N', '--', ...files], repo);
  await child(commitRole, '/usr/bin/git', [...gitFlags, 'commit', '--only', '-m', message, '--', ...files], repo);
}
function authenticate() {
  const authority = json(path.join(own, 'A06.stdout'));
  verify(authority.completeCompiledManifest);
  verify(authority.toolManifest);
  if (binding(path.join(parent, 'SEAL.json')).sha256 !== authority.sealSha256) throw new Error('old seal authority');
  const seal = json(path.join(parent, 'SEAL.json'));
  if (seal.selectedTree !== 'da4e1cc187022255521879b00db2ac77674f79d9' || seal.sources.length !== 305) throw new Error('selected composition');
  const compiled = json(authority.completeCompiledManifest.path);
  if (compiled.rows.length !== 1305) throw new Error('compiled cardinality');
  same(inventory(candidate), compiled, 'all compiled/source paths');
  for (const row of seal.sources) verify({ size: row.bytes, mode: Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256 }, path.join(candidate, row.path));
  for (const row of authority.privateCompiledAssets) verify(row, path.join(candidate, row.path));
  if (authority.privateCompiledAssets.length !== 48) throw new Error('private asset count');
  const tools = json(authority.toolManifest.path);
  verify(tools.node);
  verify(tools.git);
  if (process.execPath !== tools.node.path) throw new Error('Node path');
  for (const row of tools.typescript) verify(row, path.join(parent, 'node_modules', path.relative(path.join(repo, 'node_modules'), row.path)));
  same(inventory(tools.npmRoot, true), tools.npm, 'complete npm tool');
  return { authority, seal, compiled, tools };
}
function safe(relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('archive path');
  return relative;
}
function octal(bytes) {
  const text = bytes.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]*$/.test(text)) throw new Error('tar numeric');
  const value = text ? Number.parseInt(text, 8) : 0;
  if (!Number.isSafeInteger(value)) throw new Error('tar integer');
  return value;
}
function tar(bytes) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  let ended = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) { ended = true; break; }
    const sum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    if (sum !== octal(header.subarray(148, 156))) throw new Error('tar checksum');
    const text = field => field.subarray(0, field.indexOf(0) < 0 ? field.length : field.indexOf(0)).toString('utf8');
    const prefix = text(header.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`;
    if (!name.startsWith('package/')) throw new Error('tar root');
    const relative = safe(name.slice(8));
    if (seen.has(relative) || rows.length >= 5000 || (header[156] !== 0 && header[156] !== 48)) throw new Error('tar type/duplicate/count');
    seen.add(relative);
    const size = octal(header.subarray(124, 136));
    if (size > 8388608 || offset + 512 + size > bytes.length) throw new Error('tar payload');
    const row = { path: relative, size, mode: octal(header.subarray(100, 108)) & 0o777, sha256: hash(bytes.subarray(offset + 512, offset + 512 + size)) };
    verify(row, path.join(candidate, relative));
    rows.push(row);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended || bytes.subarray(offset).some(value => value !== 0)) throw new Error('tar termination');
  return rows.sort((left, right) => order(left.path, right.path));
}

try {
  if (mode === 'seal') {
    await child('A06', '/usr/bin/git', [...gitFlags, 'cat-file', 'blob', '22260dd7f168e25eb7b07cb65469f5f285acdec7:tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1/SOURCE-REPORT.json'], repo);
    const input = authenticate();
    const configs = ['user.npmrc', 'global.npmrc'].map(name => {
      const filename = path.join(own, name);
      fs.writeFileSync(filename, '', { flag: 'wx', mode: 0o644 });
      const stat = fs.statSync(filename);
      return { ...binding(filename), realpath: fs.realpathSync(filename), dev: stat.dev, ino: stat.ino };
    });
    if (configs[0].realpath === configs[1].realpath || (configs[0].dev === configs[1].dev && configs[0].ino === configs[1].ino)) throw new Error('config alias');
    fs.mkdirSync(path.join(own, 'cache'));
    fs.mkdirSync(path.join(own, 'package'));
    const env = { PATH: path.dirname(input.tools.node.path), HOME: own, TMPDIR: own, LANG: 'C', TZ: 'UTC', npm_config_userconfig: configs[0].path, npm_config_globalconfig: configs[1].path, npm_config_cache: path.join(own, 'cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
    const argv = [path.join(input.tools.npmRoot, 'bin/npm-cli.js'), 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', path.join(own, 'package')];
    const files = ['runner.mjs', 'PRESEAL.md', 'A06.stdout', 'user.npmrc', 'global.npmrc'];
    save('SEAL.json', { sourceTree: input.seal.selectedTree, sourceInputs: 305, compiledMembers: 1305, privateAssets: 48, authority: binding(path.join(own, 'A06.stdout')), oldSeal: binding(path.join(parent, 'SEAL.json')), compiled: input.authority.completeCompiledManifest, tools: input.authority.toolManifest, node: input.tools.node, configs, env, argv, cwd: candidate, fixtures: files.map(name => binding(path.join(own, name))), compressedMaximum: 16777216, decodedMaximum: 67108864, plannedProducerStarts: 1, runtimeStarts: 0 });
    await commit('A07', 'A08', [...files, 'SEAL.json'].map(name => path.join(own, name)), 'test: seal distinct npm configuration producer-only correction');
  } else if (mode === 'produce') {
    const seal = json(path.join(own, 'SEAL.json'));
    for (const row of [...seal.fixtures, seal.oldSeal, seal.compiled, seal.tools, seal.node]) verify(row);
    for (const row of seal.configs) {
      const stat = fs.statSync(row.path);
      if (fs.realpathSync(row.path) !== row.realpath || stat.dev !== row.dev || stat.ino !== row.ino || stat.size !== 0) throw new Error('config identity drift');
    }
    const input = authenticate();
    await child('A10', seal.node.path, seal.argv, seal.cwd, seal.env);
    const output = json(path.join(own, 'A10.stdout'));
    if (!Array.isArray(output) || output.length !== 1) throw new Error('producer JSON');
    const produced = output[0];
    if (path.basename(produced.filename) !== produced.filename || !produced.filename.endsWith('.tgz')) throw new Error('archive filename');
    const filename = path.join(own, 'package', produced.filename);
    const archive = binding(filename, true);
    if (archive.size !== produced.size || archive.sha1 !== produced.shasum || archive.integrity !== produced.integrity) throw new Error('producer digest');
    const receipt = { ...archive, producer: binding(path.join(own, 'A10.stdout')), sourceTree: seal.sourceTree, sizeBound: seal.compressedMaximum, decodedBound: seal.decodedMaximum, phase: 'Streaming hash completed; archive bytes and this receipt committed BEFORE first full-buffer read or inflate.' };
    save('PRE-INFLATE-RECEIPT.json', receipt);
    await commit('A11', 'A12', [filename, path.join(own, 'PRE-INFLATE-RECEIPT.json'), path.join(own, 'A10.stdout'), path.join(own, 'A10.stderr')], 'test: freeze actual ERE package receipt before bounded inflation');
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const compressed = Buffer.alloc(archive.size);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size !== archive.size || (stat.mode & 0o777) !== archive.mode) throw new Error('archive open identity');
      let offset = 0;
      while (offset < compressed.length) {
        const count = fs.readSync(descriptor, compressed, offset, compressed.length - offset, null);
        if (!count) throw new Error('bounded archive truncation');
        offset += count;
      }
      if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) throw new Error('archive grew');
    } finally { fs.closeSync(descriptor); }
    if (hash(compressed) !== archive.sha256 || hash(compressed, 'sha1') !== archive.sha1 || `sha512-${hash(compressed, 'sha512', 'base64')}` !== archive.integrity) throw new Error('same buffer identity');
    const decoded = gunzipSync(compressed, { maxOutputLength: seal.decodedMaximum });
    const members = tar(decoded);
    const expected = input.compiled.rows.filter(row => row.path.startsWith('dist/') || row.path === 'README.md' || row.path === 'package.json').map(({ kind, ...row }) => row);
    same(members, expected, 'full packaged shipping bytes');
    const reported = produced.files.map(row => ({ path: row.path, size: row.size, mode: row.mode })).sort((left, right) => order(left.path, right.path));
    same(members.map(({ sha256, ...row }) => row), reported, 'npm manifest');
    const memberMap = new Map(members.map(row => [row.path, row]));
    for (const asset of input.authority.privateCompiledAssets) if (memberMap.get(asset.path)?.sha256 !== asset.sha256) throw new Error('private packaged asset');
    const targets = [];
    const visit = value => { if (typeof value === 'string') targets.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
    visit(input.seal.exports);
    for (const target of targets) {
      const relative = target.replace(/^\.\//, '');
      if (relative.includes('*')) {
        const [before, after] = relative.split('*');
        if (!members.some(row => row.path.startsWith(before) && row.path.endsWith(after))) throw new Error('wildcard export');
      } else if (!memberMap.has(relative)) throw new Error(`missing export ${target}`);
    }
    authenticate();
    for (const row of seal.fixtures) verify(row);
    verify(archive);
    const storage = inventory(own);
    save('PACKAGE-MANIFEST.json', { sourceTree: seal.sourceTree, archive: receipt, decodedBytes: decoded.length, memberCount: members.length, unpackedBytes: members.reduce((sum, row) => sum + row.size, 0), members, exports: input.seal.exports, publicTargets: targets, privateAssets: input.authority.privateCompiledAssets, runtimeDependencies: input.seal.dependencies, qualification: 'Full real archive byte/inventory proof; no runtime, installation, transport or semantic acceptance.' });
    save('RESULT.json', { pass: true, archive, memberCount: members.length, privateAssets: 48, sourceInputs: 305, compiledPostguard: 1305, toolPostguard: { typescript: input.tools.typescript.length, npmRegular: input.tools.npm.rows.filter(row => row.kind === 'file').length, npmLinks: input.tools.npm.rows.filter(row => row.kind === 'link').length }, receipts, capture, storageBytesBeforeFinalManifests: storage.bytes, elapsedMs: Date.now() - begin, producerStarts: 1, compilers: 0, runtimeImports: 0, Workers: 0, oldFailure: '22260dd7 unrescored', obligations: '70 UNRUN' });
  } else throw new Error('mode');
  deadline();
  record({ event: 'complete', receipts, capture, elapsedMs: Date.now() - begin });
} catch (error) {
  record({ event: 'STOP', message: String(error), receipts, capture, elapsedMs: Date.now() - begin });
  process.exitCode = 78;
} finally { fs.closeSync(outer); }
