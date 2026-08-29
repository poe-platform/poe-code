import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { define } from './expectations.mjs';
const own = path.dirname(fileURLToPath(import.meta.url));
const outer = fs.openSync(path.join(own, 'C01-materialize.jsonl'), 'ax');
const record = value => fs.writeSync(outer, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
record({ event: 'startup', pid: process.pid, execPath: process.execPath });
const parent = path.dirname(own);
const previous = path.join(parent, 'rebind-v1');
const repo = path.resolve(own, '../../../..');
const start = Date.parse(JSON.parse(fs.readFileSync('/tmp/safe-bash-core70-prep-20260829-start.jsonl', 'utf8').split('\n')[0]).at);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function deadline() { if (Date.now() - start > 1500000) throw new Error('prep deadline'); }
function bind(filename) {
  deadline();
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 134217728) throw new Error(`regular/size ${filename}`);
  for (let cursor = path.dirname(filename); cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`linked ancestor ${cursor}`);
  const descriptor = fs.openSync(filename, 'r');
  const digest = createHash('sha256');
  let count = 0;
  try {
    const bytes = Buffer.alloc(65536); let amount;
    while ((amount = fs.readSync(descriptor, bytes))) { count += amount; if (count > stat.size) throw new Error('size growth'); digest.update(bytes.subarray(0, amount)); }
  } finally { fs.closeSync(descriptor); }
  if (count !== stat.size) throw new Error('size shrink');
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
function verify(row, filename = row.path) {
  const actual = bind(filename);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error(`binding ${filename}`);
}
function inventory(root, toolLinks = false) {
  const rows = []; let bytes = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name), relative = path.relative(root, filename);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isSymbolicLink()) {
        if (!toolLinks) throw new Error('source/harness/package symlink');
        const target = fs.realpathSync(filename); if (!target.startsWith(`${root}/`)) throw new Error('tool link escape');
        const bound = bind(target);
        rows.push({ path: relative, kind: 'link', mode: fs.lstatSync(filename).mode & 0o777, text: fs.readlinkSync(filename), target: path.relative(root, target), targetSha256: bound.sha256, targetSize: bound.size });
      } else {
        if (entry.name === 'AGENTS.md') throw new Error('instruction member');
        const bound = bind(filename); bytes += bound.size;
        if (bytes > 536870912 || rows.length > 12000) throw new Error('storage census cap');
        rows.push({ ...bound, path: relative, kind: 'file' });
      }
    }
  }
  visit(root); rows.sort((left, right) => order(left.path, right.path)); return { bytes, rows };
}
function same(actual, expected, label) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} census drift`); }
function save(name, data) { fs.writeFileSync(path.join(own, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' }); }
function copy(filename, target) { const row = bind(filename); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(filename, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, row.mode); verify(row, target); }
function octal(bytes) { const value = bytes.toString('ascii').replace(/\0.*$/s, '').trim(); if (!/^[0-7]*$/.test(value)) throw new Error('tar number'); const number = value ? Number.parseInt(value, 8) : 0; if (!Number.isSafeInteger(number)) throw new Error('tar integer'); return number; }
try {
  const sourceSealPath = path.join(previous, 'SEAL.json');
  if (bind(sourceSealPath).sha256 !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('rebind authority');
  const sourceSeal = json(sourceSealPath);
  const compiledPath = path.join(previous, 'COMPILED.json');
  if (bind(compiledPath).sha256 !== 'f42f0008bf5939f28ccb7cd038b9f462a03efa38238709c97a7daab7c98e3035') throw new Error('compiled authority');
  const compiled = json(compiledPath), sourceRoot = path.join(previous, 'candidate');
  same(inventory(sourceRoot), compiled, 'retained1305');
  for (const row of sourceSeal.sources) verify({ size: row.bytes, mode: Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256 }, path.join(sourceRoot, row.path));
  verify(sourceSeal.node);
  if (process.execPath !== sourceSeal.node.path) throw new Error('Node identity');
  for (const row of sourceSeal.typescript) verify(row, path.join(previous, 'node_modules', path.relative(path.join(repo, 'node_modules'), row.path)));
  const npmRoot = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
  same(inventory(npmRoot, true), sourceSeal.npm, 'npm tool');
  const archivePath = path.join(previous, 'producer-v2/package/virtual-bash-0.0.0.tgz');
  const archiveBinding = bind(archivePath);
  if (archiveBinding.size !== 908381 || archiveBinding.sha256 !== '4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e') throw new Error('archive admission');
  save('ARCHIVE-ADMISSION.json', { archiveBinding, compressedMaximum: 1048576, decodedMaximum: 8388608, phase: 'before bounded read/first inflate' });
  const descriptor = fs.openSync(archivePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const compressed = Buffer.alloc(archiveBinding.size);
  try {
    if (fs.fstatSync(descriptor).size !== compressed.length) throw new Error('archive size changed');
    let offset = 0;
    while (offset < compressed.length) { const count = fs.readSync(descriptor, compressed, offset, compressed.length - offset, null); if (!count) throw new Error('archive truncated'); offset += count; }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null)) throw new Error('archive grew');
  } finally { fs.closeSync(descriptor); }
  if (hash(compressed) !== archiveBinding.sha256) throw new Error('same-buffer archive hash');
  const decoded = gunzipSync(compressed, { maxOutputLength: 8388608 });
  const packageRows = []; let offset = 0; const seen = new Set();
  while (offset + 512 <= decoded.length) {
    const header = decoded.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
    if (header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0) !== octal(header.subarray(148, 156))) throw new Error('tar checksum');
    const text = bytes => bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)).toString('utf8');
    const prefix = text(header.subarray(345, 500)), name = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`;
    if (!name.startsWith('package/') || ![0, 48].includes(header[156])) throw new Error('tar role/type');
    const relative = name.slice(8);
    if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '..' || part === '.' || part === 'AGENTS.md') || seen.has(relative)) throw new Error('tar path');
    seen.add(relative); const size = octal(header.subarray(124, 136));
    if (size > 8388608 || offset + 512 + size > decoded.length) throw new Error('tar size');
    const payload = decoded.subarray(offset + 512, offset + 512 + size);
    const row = { path: relative, size, mode: octal(header.subarray(100, 108)) & 0o777, sha256: hash(payload) };
    verify(row, path.join(sourceRoot, relative)); packageRows.push({ ...row, payload });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (decoded.subarray(offset).some(value => value !== 0) || packageRows.length !== 1002) throw new Error('tar termination/count');
  packageRows.sort((left, right) => order(left.path, right.path));
  same(packageRows.map(({ payload, ...row }) => row), compiled.rows.filter(row => row.path.startsWith('dist/') || ['README.md', 'package.json'].includes(row.path)).map(({ kind, ...row }) => row), 'full packaged set');
  const casePath = path.join(parent, 'CASEMAP.json');
  const oldSealPath = path.join(parent, 'SEAL.json');
  if (bind(oldSealPath).sha256 !== '8bcc8e9d2d7d6374e709c7343736859718c78a3c64fd30268ffb18ec083930d5') throw new Error('case authority');
  const caseBinding = json(oldSealPath).fixtures.find(row => row.path.endsWith('/CASEMAP.json')); verify(caseBinding, casePath);
  const original = json(casePath).rows; if (original.length !== 70 || new Set(original.map(row => row.id)).size !== 70) throw new Error('70 IDs');
  const definitions = original.map(define); save('CASES.json', { original: bind(casePath), status: 'ALL_UNRUN', rows: definitions });
  const privateRoot = fs.realpathSync(fs.mkdtempSync('/private/tmp/safe-bash-core70-20260829-'));
  fs.chmodSync(privateRoot, 0o700);
  fs.mkdirSync(path.join(privateRoot, 'controller'), { mode: 0o700 });
  for (const file of ['dispatch.mjs', 'owner.mjs', 'controller-core.mjs']) copy(path.join(own, file), path.join(privateRoot, 'controller', file));
  const harnessFiles = ['cell.mjs', 'worker-observer.mjs', 'controller-core.mjs', 'malformed-worker.mjs'];
  const layouts = [];
  for (const name of ['source-built', 'installed', 'moved']) {
    const stage = name === 'moved' ? path.join(privateRoot, 'move-origin/app') : path.join(privateRoot, name, 'app');
    const packageRoot = name === 'source-built' ? path.join(stage, 'package') : path.join(stage, 'node_modules/virtual-bash');
    fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
    if (name === 'source-built') for (const row of compiled.rows) copy(path.join(sourceRoot, row.path), path.join(packageRoot, row.path));
    else for (const row of packageRows) { const target = path.join(packageRoot, row.path); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, row.payload, { flag: 'wx', mode: row.mode }); verify(row, target); }
    if (name === 'moved') { fs.mkdirSync(path.join(privateRoot, 'moved'), { mode: 0o700 }); fs.renameSync(stage, path.join(privateRoot, 'moved/app')); if (fs.existsSync(stage)) throw new Error('move origin remains'); }
    const app = path.join(privateRoot, name, 'app');
    const finalPackage = name === 'source-built' ? path.join(app, 'package') : path.join(app, 'node_modules/virtual-bash');
    for (const folder of ['harness', 'cells', 'captures', 'home', 'tmp']) fs.mkdirSync(path.join(app, folder), { mode: 0o700 });
    for (const file of harnessFiles) copy(path.join(own, file), path.join(app, 'harness', file));
    const owner = fs.readFileSync(path.join(finalPackage, 'dist/commands/regex-execution/ere/transport/owner.js'), 'utf8');
    const resource = /resourceLimits:\s*\{([^}]+)\}/.exec(owner);
    const resourceLimits = resource ? Object.fromEntries(resource[1].split(',').map(part => part.trim()).filter(Boolean).map(part => { const match = /^(\w+):\s*([0-9.]+)$/.exec(part); if (!match) throw new Error('literal Worker resource option'); return [match[1], Number(match[2])]; })) : undefined;
    const worker = { ...bind(path.join(finalPackage, 'dist/commands/regex-execution/ere/transport/worker-entry.js')), optionKeys: ['workerData', 'env', 'execArgv', 'stdout', 'stderr', ...(resource ? ['resourceLimits'] : [])], ...(resource ? { resourceLimits } : {}) };
    const limits = { maxOutputBytes: 65536, maxCommands: 500, maxLoopIterations: 1000, maxSubstitutionDepth: 16, maxSourceBytes: 65536, maxExpansionFields: 16384, maxExpansionBytes: 1048576, pipeHighWaterMark: 65536 };
    const cells = definitions.map(definition => {
      const cellPath = path.join(app, 'cells', `${definition.id}.json`), capture = path.join(app, 'captures', `${definition.id}.jsonl`);
      fs.writeFileSync(cellPath, `${JSON.stringify({ definition, modulePath: path.join(finalPackage, 'dist/index.js'), worker, limits })}\n`, { flag: 'wx' });
      return { id: `${name}/${definition.id}`, originalId: definition.id, route: definition.route, state: 'UNRUN', cellPath, capture, cwd: app, executable: sourceSeal.node.path, argv: ['--permission', `--allow-fs-read=${app}`, `--allow-fs-write=${path.join(app, 'captures')}`, '--allow-worker', path.join(app, 'harness/cell.mjs'), cellPath, capture], env: { PATH: path.dirname(sourceSeal.node.path), HOME: path.join(app, 'home'), TMPDIR: path.join(app, 'tmp'), LANG: 'C', TZ: 'UTC' }, workerStartsMaximum: definition.workerStartsMaximum };
    });
    const closure = inventory(app); save(`LAYOUT-${name}.json`, closure);
    copy(path.join(own, `LAYOUT-${name}.json`), path.join(privateRoot, 'controller', `LAYOUT-${name}.json`));
    layouts.push({ name, app, packageRoot: finalPackage, modulePath: path.join(finalPackage, 'dist/index.js'), worker, manifest: bind(path.join(privateRoot, 'controller', `LAYOUT-${name}.json`)), cells });
  }
  const privateFiles = packageRows.filter(row => row.path.startsWith('dist/commands/regex-execution/ere/') && row.path.endsWith('.js'));
  const edges = [];
  for (const row of privateFiles) for (const match of row.payload.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)) {
    const specifier = match[1], target = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(row.path), specifier)) : specifier;
    if (!target.startsWith('node:') && !packageRows.some(member => member.path === target)) throw new Error('static edge outside bound package');
    edges.push({ importer: row.path, specifier, target, qualification: 'static source edge only; no nested-load execution witness' });
  }
  save('STATIC-EDGES.json', { files: privateFiles.length, edges, privateAssets: packageRows.filter(row => row.path.startsWith('dist/commands/regex-execution/ere/')).map(({ payload, ...row }) => row) });
  const matrix = layouts.flatMap(layout => layout.cells);
  const seal = { status: 'PREPARATION_WITH_EXPLICIT_GATES_NOT_ACTUAL_READY', sourceTree: sourceSeal.selectedTree, sourceInputs: 305, archive: archiveBinding, compiled: bind(compiledPath), node: sourceSeal.node, tools: { typescript: sourceSeal.typescript.length, npmFiles: sourceSeal.npm.rows.filter(row => row.kind === 'file').length, npmLinks: sourceSeal.npm.rows.filter(row => row.kind === 'link').length }, privateRoot, layouts, cells: matrix, cellCount: matrix.length, deferredCells: matrix.filter(row => row.route === 'DEFERRED_ADAPTER').map(row => row.id), executableBodyCells: matrix.filter(row => row.route !== 'DEFERRED_ADAPTER').length, futureCaps: { totalMilliseconds: 7500000, childMaximum: 210, coordinatorMaximum: 1, osPeak: 2, caseMilliseconds: 30000, retirementMilliseconds: 3000, captureBytes: 167772160, workingBytes: 536870912, workerStartsMaximum: matrix.reduce((sum, row) => sum + row.workerStartsMaximum, 0), workerLivePerCell: 1, internalLoaderAdmissions: 0 }, harness: ['expectations.mjs', 'controller-core.mjs', 'worker-observer.mjs', 'malformed-worker.mjs', 'cell.mjs', 'dispatch.mjs', 'prepare.mjs', 'controls.mjs', 'PRESEAL.md'].map(file => bind(path.join(own, file))), qualifications: ['No product imports or Workers during preparation', 'No nested Worker module-load proof', 'Explicit configured public limits; not default-boundary/RSS proof', 'Seven adapter gates and actual launch controller still incomplete', 'Transport60 and different preexec review plus exact ROOT grant required'] };
  seal.controller = ['dispatch.mjs', 'owner.mjs', 'controller-core.mjs'].map(name => bind(path.join(privateRoot, 'controller', name)));
  seal.harness.push(bind(path.join(own, 'owner.mjs')));
  save('EXECUTION-SEAL.json', seal);
  copy(path.join(own, 'EXECUTION-SEAL.json'), path.join(privateRoot, 'controller', 'EXECUTION-SEAL.json'));
  same(inventory(sourceRoot), compiled, 'retained source post');
  verify(archiveBinding);
  const storage = inventory(privateRoot);
  save('PREPARATION-RESULT.json', { materialized: true, privateRoot, cellCount: matrix.length, executableBodyCells: seal.executableBodyCells, deferredCells: seal.deferredCells.length, privateStaticEdges: edges.length, privateAssets: 48, storageBytes: storage.bytes, elapsedMs: Date.now() - start, productImports: 0, Workers: 0, role: 'DATA materialization only', moveOriginAbsent: !fs.existsSync(path.join(privateRoot, 'move-origin/app')) });
  record({ event: 'complete', cells: matrix.length, gated: seal.deferredCells.length, privateRoot, elapsedMs: Date.now() - start });
} catch (error) { record({ event: 'STOP', message: String(error), elapsedMs: Date.now() - start }); process.exitCode = 78; }
finally { fs.closeSync(outer); }
