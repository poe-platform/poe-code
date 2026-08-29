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
record({ event: 'startup', role: mode === 'seal' ? 'A06' : 'A14', pid: process.pid, execPath: process.execPath });
const repo = path.resolve(own, '../../../..');
const begin = Date.parse(JSON.parse(fs.readFileSync('/tmp/safe-bash-ere-rebind-v1-20260829-start.jsonl', 'utf8').split('\n')[0]).at);
const candidate = path.join(own, 'candidate');
const sourceCommit = 'e013f817fd7700c59a144c395c80dc25856e4157';
const engineCommit = '72187e5abc1179883f85a63e1ef558f2e141c542';
const transportCommit = '46611a5b67ad7af276154421ac7f50dd536ec570';
const npmRoot = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
const git = '/usr/bin/git';
const gitFlags = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.abbrev=40'];
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(own, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const receipts = [];
let capture = 0;

function deadline() { if (Date.now() - begin >= 1500000) throw new Error('grant deadline'); }
function safe(relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\0')) throw new Error(`path refusal ${relative}`);
  if (relative.split('/').includes('AGENTS.md')) throw new Error('instruction member refusal');
  return relative;
}
function binding(filename) {
  deadline();
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error(`regular/size refusal ${filename}`);
  for (let cursor = path.dirname(filename); cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`linked ancestor ${cursor}`);
  const descriptor = fs.openSync(filename, 'r');
  const digest = createHash('sha256');
  try {
    const bytes = Buffer.alloc(65536);
    let count;
    while ((count = fs.readSync(descriptor, bytes))) digest.update(bytes.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
function verify(row) {
  const actual = binding(row.path);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`binding mismatch ${row.path}`);
}
function inventory(root, links = false) {
  const rows = [];
  let bytes = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => order(left.name, right.name))) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isSymbolicLink()) {
        if (!links) throw new Error(`linked member ${filename}`);
        const text = fs.readlinkSync(filename);
        const resolved = fs.realpathSync(filename);
        if (!resolved.startsWith(`${root}/`)) throw new Error('external/cyclic tool link');
        const target = binding(resolved);
        rows.push({ path: relative, kind: 'link', mode: fs.lstatSync(filename).mode & 0o777, text, target: path.relative(root, resolved), targetSha256: target.sha256, targetSize: target.size });
      } else {
        const row = binding(filename);
        bytes += row.size;
        if (bytes > 256 * 1024 * 1024 || rows.length >= 10000) throw new Error('inventory cap');
        rows.push({ ...row, path: relative, kind: 'file' });
      }
    }
  }
  visit(root);
  rows.sort((left, right) => order(left.path, right.path));
  return { bytes, rows };
}
function identical(actual, expected, label) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} census drift`); }
function copy(source, target) {
  const before = binding(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, before.mode);
  verify({ ...before, path: target });
}
async function child(role, executable, args, cwd, { input, timeout = 30000, env = {} } = {}) {
  deadline();
  if (receipts.length >= 12) throw new Error('coordinator child cap');
  const stdout = fs.openSync(path.join(own, `${role}.stdout`), 'ax');
  const stderr = fs.openSync(path.join(own, `${role}.stderr`), 'ax');
  const instance = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: path.dirname(process.execPath), HOME: own, TMPDIR: own, LANG: 'C', TZ: 'UTC', ...env } });
  const receipt = { role, pid: instance.pid, executable, args, cwd, retired: false };
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
      if (capture > 64 * 1024 * 1024) throw new Error('child capture cap');
    } catch (error) { failure ??= error; instance.kill('SIGKILL'); }
  };
  instance.stdout.on('data', accept(stdout));
  instance.stderr.on('data', accept(stderr));
  instance.stdin.on('error', error => { failure ??= error; instance.kill('SIGKILL'); });
  const timer = setTimeout(() => { failure ??= new Error('child deadline'); instance.kill('SIGKILL'); }, Math.min(timeout, 1500000 - (Date.now() - begin)));
  try { record({ event: 'enrolled', ...receipt }); instance.stdin.end(input); }
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
function bytesOf(role) { return fs.readFileSync(path.join(own, `${role}.stdout`)); }
function batch(bytes, names) {
  let offset = 0;
  const result = [];
  for (const expected of names) {
    const end = bytes.indexOf(10, offset);
    const header = bytes.subarray(offset, end).toString('ascii').match(/^([0-9a-f]{40}) blob ([0-9]+)$/);
    if (!header) throw new Error(`blob header ${expected}`);
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || size > 2 * 1024 * 1024) throw new Error('blob size');
    const payload = bytes.subarray(end + 1, end + 1 + size);
    if (payload.length !== size || bytes[end + 1 + size] !== 10) throw new Error('blob boundary');
    if (hash(Buffer.concat([Buffer.from(`blob ${size}\0`), payload]), 'sha1') !== header[1]) throw new Error('blob identity');
    if (/^[0-9a-f]{40}$/.test(expected) && header[1] !== expected) throw new Error('requested blob identity');
    result.push({ blob: header[1], bytes: payload });
    offset = end + 2 + size;
  }
  if (offset !== bytes.length) throw new Error('batch trailing bytes');
  return result;
}
function ls(bytes, revision) {
  if (bytes.at(-1) !== 0) throw new Error('non-NUL Git inventory');
  return bytes.subarray(0, -1).toString('utf8').split('\0').map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error('Git inventory entry');
    return { mode: match[1], blob: match[2], path: safe(match[3]), revision };
  });
}
function tree(rows) {
  const root = new Map();
  for (const row of rows) {
    const parts = row.path.split('/');
    let current = root;
    for (const component of parts.slice(0, -1)) {
      if (!current.has(component)) current.set(component, new Map());
      current = current.get(component);
      if (!(current instanceof Map)) throw new Error('tree collision');
    }
    if (current.has(parts.at(-1))) throw new Error('duplicate tree member');
    current.set(parts.at(-1), row);
  }
  function digest(node) {
    const records = [...node].sort(([left, leftValue], [right, rightValue]) => order(left + (leftValue instanceof Map ? '/' : ''), right + (rightValue instanceof Map ? '/' : ''))).map(([name, value]) => Buffer.concat([Buffer.from(`${value instanceof Map ? '40000' : value.mode} ${name}\0`), Buffer.from(value instanceof Map ? digest(value) : value.blob, 'hex')]));
    const payload = Buffer.concat(records);
    return hash(Buffer.concat([Buffer.from(`tree ${payload.length}\0`), payload]), 'sha1');
  }
  return digest(root);
}
function currentSource(seal) {
  for (const row of seal.sources) verify({ path: path.join(candidate, row.path), size: row.bytes, mode: Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256 });
}
function tools(seal) {
  verify(seal.node);
  if (process.execPath !== seal.node.path) throw new Error('Node path');
  for (const row of seal.typescript) verify({ ...row, path: path.join(own, 'node_modules', path.relative(path.join(repo, 'node_modules'), row.path)) });
  identical(inventory(npmRoot, true), seal.npm, 'npm full tool');
}
function octal(bytes) {
  const text = bytes.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]*$/.test(text)) throw new Error('tar numeric encoding');
  const value = text ? Number.parseInt(text, 8) : 0;
  if (!Number.isSafeInteger(value)) throw new Error('tar integer');
  return value;
}
function tarManifest(bytes) {
  const rows = [];
  let offset = 0;
  let ended = false;
  const seen = new Set();
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) { ended = true; break; }
    const sum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    if (sum !== octal(header.subarray(148, 156))) throw new Error('tar checksum');
    const text = chunk => chunk.subarray(0, chunk.indexOf(0) < 0 ? chunk.length : chunk.indexOf(0)).toString('utf8');
    const prefix = text(header.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`;
    if (!name.startsWith('package/')) throw new Error('tar root');
    const relative = safe(name.slice(8));
    if (seen.has(relative) || rows.length >= 5000) throw new Error('tar duplicate/count');
    seen.add(relative);
    const type = header[156];
    if (type !== 0 && type !== 48) throw new Error(`nonregular tar type ${type}`);
    const size = octal(header.subarray(124, 136));
    if (size > 8 * 1024 * 1024 || offset + 512 + size > bytes.length) throw new Error('tar payload cap');
    const payload = bytes.subarray(offset + 512, offset + 512 + size);
    const file = path.join(candidate, relative);
    const expected = binding(file);
    const row = { path: relative, size, mode: octal(header.subarray(100, 108)) & 0o777, sha256: hash(payload) };
    if (row.size !== expected.size || row.mode !== expected.mode || row.sha256 !== expected.sha256) throw new Error(`packaged-byte mismatch ${relative}`);
    rows.push(row);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended || bytes.subarray(offset).some(value => value !== 0)) throw new Error('tar terminator');
  return rows.sort((left, right) => order(left.path, right.path));
}

try {
  if (mode === 'seal') {
    const authorityNames = [
      '27cf475704b1fef96d0923a23369b6578464b062:tests/compatibility/bash-ere-runtime-integration-design-20260829/CORE-SOURCE.json.data',
      `${sourceCommit}:tests/compatibility/bash-ere-runtime-integration-author-20260829/SEAL.json`,
      `${sourceCommit}:tests/compatibility/bash-ere-runtime-integration-author-20260829/CASEMAP.json`,
      `${sourceCommit}:tests/compatibility/bash-ere-runtime-integration-author-20260829/negative.mts`
    ];
    const authorityResult = await child('A07', git, [...gitFlags, 'cat-file', '--batch'], repo, { input: `${authorityNames.join('\n')}\n` });
    if (authorityResult.code !== 0) throw new Error('authority Git failure');
    const authority = batch(bytesOf('A07'), authorityNames);
    if (hash(authority[0].bytes) !== '12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4' || hash(authority[1].bytes) !== '8bcc8e9d2d7d6374e709c7343736859718c78a3c64fd30268ffb18ec083930d5') throw new Error('authority digest');
    const core = JSON.parse(authority[0].bytes);
    const oldSeal = JSON.parse(authority[1].bytes);
    if (!authority[3].bytes.equals(fs.readFileSync(path.join(own, 'negative.mts')))) throw new Error('negative fixture changed');
    fs.writeFileSync(path.join(own, 'CASEMAP.json'), authority[2].bytes, { flag: 'wx' });
    const corePaths = ['parser', 'conditional', 'runtime', 'shell'].map(name => `src/shell/${name}.ts`);
    const enginePaths = ['types', 'errors', 'limits', 'syntax', 'matcher'].map(name => `src/commands/regex-execution/ere/${name}.ts`);
    for (const [role, revision, paths] of [['A08', sourceCommit, corePaths], ['A09', engineCommit, enginePaths], ['A10', transportCommit, ['src/commands/regex-execution/ere/transport']]]) {
      const result = await child(role, git, [...gitFlags, 'ls-tree', '-r', '-z', revision, '--', ...paths], repo);
      if (result.code !== 0) throw new Error('selected source inventory');
    }
    const overrides = ls(bytesOf('A08'), sourceCommit);
    const engine = ls(bytesOf('A09'), engineCommit);
    const transport = ls(bytesOf('A10'), transportCommit);
    if (overrides.length !== 4 || engine.length !== 5 || transport.length !== 7 || core.inputs.length !== 293) throw new Error('selected group cardinality');
    const selected = new Map(core.inputs.map(row => [safe(row.path), { ...row, group: 'core' }]));
    for (const [group, rows] of [['integration', overrides], ['engine', engine], ['transport', transport]]) for (const row of rows) selected.set(row.path, { ...row, group });
    const rows = [...selected.values()].sort((left, right) => order(left.path, right.path));
    const payloadResult = await child('A11', git, [...gitFlags, 'cat-file', '--batch'], repo, { input: `${rows.map(row => row.blob).join('\n')}\n` });
    if (payloadResult.code !== 0) throw new Error('selected blob fetch');
    const payloads = batch(bytesOf('A11'), rows.map(row => row.blob));
    fs.mkdirSync(candidate);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const bytes = payloads[index].bytes;
      const digest = hash(bytes);
      if (row.sha256 && (row.sha256 !== digest || row.bytes !== bytes.length)) throw new Error(`base blob mismatch ${row.path}`);
      Object.assign(row, { bytes: bytes.length, sha256: digest });
      const target = path.join(candidate, row.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: Number.parseInt(row.mode, 8) & 0o777 });
    }
    verify(oldSeal.node);
    if (oldSeal.node.path !== process.execPath) throw new Error('Node authority');
    for (const row of oldSeal.tools) {
      verify(row);
      const relative = path.relative(path.join(repo, 'node_modules'), row.path);
      if (relative.startsWith('..')) throw new Error('type tool containment');
      copy(row.path, path.join(own, 'node_modules', relative));
    }
    const npm = inventory(npmRoot, true);
    if (json(path.join(npmRoot, 'package.json')).version !== '10.9.7') throw new Error('npm version');
    const packageJson = json(path.join(candidate, 'package.json'));
    if (Object.keys(packageJson.dependencies ?? {}).length) throw new Error('runtime dependency drift');
    const source = { coreAuthority: core.computedTree, sourceCommit, engineCommit, transportCommit, selectedTree: tree(rows), selectedCount: rows.length, counts: { coreCatalog: core.inputs.length, integrationOverrides: overrides.length, engineAdded: engine.length, transportAdded: transport.length }, sources: rows, packageJson: binding(path.join(candidate, 'package.json')), exports: packageJson.exports, dependencies: packageJson.dependencies ?? {}, qualification: 'Complete selected shipping-input tree, not whole repository or Node309; derived identity need not be stored.' };
    save('SOURCE.json', source);
    save('TOOLS.json', { node: oldSeal.node, typescript: oldSeal.tools, npmRoot, npm, git: binding(git), flags: oldSeal.flags });
    const fixtureNames = ['positive.mts', 'negative.mts', 'CASEMAP.json', 'runner.mjs', 'PRESEAL.md', 'ROLE-PLAN.json', 'SOURCE.json', 'TOOLS.json'];
    const seal = { ...source, node: oldSeal.node, typescript: oldSeal.tools, npm, flags: oldSeal.flags, inputInventory: inventory(candidate), fixtures: fixtureNames.map(name => binding(path.join(own, name))), authority: authority.map((row, index) => ({ spec: authorityNames[index], blob: row.blob, size: row.bytes.length, sha256: hash(row.bytes) })), intendedCompilerChildren: 3, intendedPackProducers: 1, runtimeImports: 0 };
    save('SEAL.json', seal);
    const files = [...fixtureNames, 'SEAL.json'].map(name => path.join(own, name));
    const add = await child('A12', git, [...gitFlags, 'add', '-N', '--', ...files], repo);
    if (add.code !== 0) throw new Error('preseal add');
    const commit = await child('A13', git, [...gitFlags, 'commit', '--only', '-m', 'test: seal complete private ERE integration transport rebind', '--', ...files], repo);
    if (commit.code !== 0) throw new Error('preseal commit');
    record({ event: 'sealed', selected: rows.length, tree: source.selectedTree, npmFiles: npm.rows.filter(row => row.kind === 'file').length, npmLinks: npm.rows.filter(row => row.kind === 'link').length });
  } else if (mode === 'produce') {
    const seal = json(path.join(own, 'SEAL.json'));
    for (const row of seal.fixtures) verify(row);
    currentSource(seal);
    identical(inventory(candidate), seal.inputInventory, 'source prebuild');
    tools(seal);
    const compiler = path.join(own, 'node_modules/typescript/lib/tsc.js');
    const roots = path.join(own, 'node_modules/@types');
    const build = await child('A15', seal.node.path, [compiler, '-p', path.join(candidate, 'tsconfig.build.json'), '--typeRoots', roots], own, { timeout: 120000 });
    if (build.code !== 0) {
      save('RESULT.json', { status: 'INTERFACE_BUILD_HOLD', receipts, capture, noProductionPatch: true, packageProduced: false, elapsedMs: Date.now() - begin });
      process.exitCode = 1;
    } else {
      const positive = await child('A16', seal.node.path, [compiler, ...seal.flags, '--noEmit', '--typeRoots', roots, path.join(own, 'positive.mts')], own);
      const negative = await child('A17', seal.node.path, [compiler, ...seal.flags, '--noEmit', '--typeRoots', roots, path.join(own, 'negative.mts')], own);
      const diagnostics = bytesOf('A17').toString('utf8');
      const codes = [...diagnostics.matchAll(/error TS(\d+):/g)].map(match => Number(match[1]));
      const locations = [...diagnostics.matchAll(/negative\.mts\((\d+),\d+\)/g)].map(match => Number(match[1]));
      const typesPass = positive.code === 0 && bytesOf('A16').length === 0 && negative.code === 2 && JSON.stringify(codes) === '[2322,2353,2353]' && JSON.stringify(locations) === '[4,5,6]';
      currentSource(seal);
      const compiled = inventory(candidate);
      save('COMPILED.json', compiled);
      fs.mkdirSync(path.join(own, 'package'));
      fs.mkdirSync(path.join(own, 'npm-cache'));
      fs.writeFileSync(path.join(own, 'empty.npmrc'), '', { flag: 'wx' });
      tools(seal);
      const packed = await child('A18', seal.node.path, [path.join(npmRoot, 'bin/npm-cli.js'), 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', path.join(own, 'package')], candidate, { timeout: 60000, env: { npm_config_userconfig: path.join(own, 'empty.npmrc'), npm_config_globalconfig: path.join(own, 'empty.npmrc'), npm_config_cache: path.join(own, 'npm-cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' } });
      if (packed.code !== 0) throw new Error('single package producer failure');
      const producer = JSON.parse(bytesOf('A18'));
      if (!Array.isArray(producer) || producer.length !== 1) throw new Error('producer schema');
      const info = producer[0];
      if (path.basename(info.filename) !== info.filename || !info.filename.endsWith('.tgz')) throw new Error('archive filename');
      const filename = path.join(own, 'package', info.filename);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 16 * 1024 * 1024 || stat.size !== info.size) throw new Error('compressed admission size');
      const compressed = fs.readFileSync(filename);
      if (compressed.length !== stat.size || hash(compressed, 'sha1') !== info.shasum || `sha512-${hash(compressed, 'sha512', 'base64')}` !== info.integrity) throw new Error('compressed producer identity');
      const archive = { filename, size: stat.size, mode: stat.mode & 0o777, sha256: hash(compressed), sha1: info.shasum, integrity: info.integrity, compressedMaximum: 16777216, decodedMaximum: 67108864, producer: binding(path.join(own, 'A18.stdout')), phase: 'Persisted BEFORE first inflation; exact same authenticated Buffer is decoded next.' };
      save('PRE-INFLATE-RECEIPT.json', archive);
      const decoded = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
      const files = tarManifest(decoded);
      const expected = compiled.rows.filter(row => row.path.startsWith('dist/') || row.path === 'README.md' || row.path === 'package.json').map(({ kind, ...row }) => row);
      identical(files, expected, 'full package vs compiled shipping bytes');
      const npmFiles = info.files.map(row => ({ path: row.path, size: row.size, mode: row.mode })).sort((left, right) => order(left.path, right.path));
      identical(files.map(({ sha256, ...row }) => row), npmFiles, 'npm file metadata');
      const paths = new Set(files.map(row => row.path));
      const publicTargets = [];
      function targets(value) {
        if (typeof value === 'string') publicTargets.push(value);
        else if (value && typeof value === 'object') for (const nested of Object.values(value)) targets(nested);
      }
      targets(seal.exports);
      for (const target of publicTargets) {
        const relative = target.replace(/^\.\//, '');
        if (relative.includes('*')) {
          const [before, after] = relative.split('*');
          if (!files.some(row => row.path.startsWith(before) && row.path.endsWith(after))) throw new Error('wildcard public target');
        } else if (!paths.has(relative)) throw new Error(`missing public target ${target}`);
      }
      const privateAssets = [];
      for (const row of seal.sources.filter(row => row.group === 'engine' || row.group === 'transport')) for (const suffix of ['.js', '.d.ts', '.js.map', '.d.ts.map']) {
        const relative = row.path.replace(/^src\//, 'dist/').replace(/\.ts$/, suffix);
        const member = files.find(file => file.path === relative);
        if (!member) throw new Error(`missing private asset ${relative}`);
        privateAssets.push(member);
      }
      save('PACKAGE-MANIFEST.json', { archive, decodedBytes: decoded.length, files, fileCount: files.length, unpackedBytes: files.reduce((total, row) => total + row.size, 0), publicExports: seal.exports, publicTargets, privateAssets, dependencies: seal.dependencies, noInstall: true, noRuntime: true });
      currentSource(seal);
      identical(inventory(candidate), compiled, 'compiled postproducer');
      tools(seal);
      for (const row of seal.fixtures) verify(row);
      const storage = inventory(own);
      if (storage.bytes > 512 * 1024 * 1024) throw new Error('working storage cap');
      save('RESULT.json', { status: typesPass ? 'SOURCE_TYPES_PACKAGE_READY' : 'TYPE_FIXTURE_HOLD', build: build.code, positive: positive.code, negative: negative.code, codes, locations, receipts, selectedTree: seal.selectedTree, selectedInputs: seal.sources.length, archive, packagedFiles: files.length, privateAssets: privateAssets.length, capture, storageBytesAtSnapshot: storage.bytes, elapsedMs: Date.now() - begin, compilerStarts: 3, packStarts: 1, runtimeImports: 0, Workers: 0, runtimeObligations: '70 UNRUN; actual transport60 gate separately pending' });
      if (!typesPass) process.exitCode = 1;
    }
  } else throw new Error('invalid mode');
  deadline();
  record({ event: 'complete', receipts, capture, elapsedMs: Date.now() - begin });
} catch (error) {
  record({ event: 'STOP', message: String(error), receipts, capture, elapsedMs: Date.now() - begin });
  process.exitCode = 78;
} finally { fs.closeSync(outer); }
