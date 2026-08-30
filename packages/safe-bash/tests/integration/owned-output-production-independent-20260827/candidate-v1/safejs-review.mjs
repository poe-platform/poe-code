import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), repo = realpathSync(join(own, '../../../..'));
const state = JSON.parse(readFileSync(JSON.parse(readFileSync('/tmp/owned-output-independent-current.json')).state));
const privateRoot = '/Users/kjopek/Workspace/poe-code', engine = join(privateRoot, 'packages/safejs');
const origin = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769', prefix = 'tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/author';
const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 32 * 1024 * 1024 });
function inventory(root, metadata = false, ignored = new Set()) {
  const entries = {};
  function visit(directory) { for (const name of readdirSync(directory).sort()) {
    if (ignored.has(name)) continue; const path = join(directory, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) visit(path); else { assert(stat.isFile()); entries[relative(root, path)] = { bytes: stat.size, sha256: hash(readFileSync(path)), ...(metadata ? { mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } : {}) }; }
  } }
  visit(root); return entries;
}
function privateState() {
  const query = (...args) => git(privateRoot, args).toString();
  const index = join(privateRoot, query('rev-parse', '--git-path', 'index').trim());
  return { head: query('rev-parse', 'HEAD').trim(), status: query('status', '--porcelain=v1'), staged: query('diff', '--cached', '--name-status'), indexSHA256: hash(readFileSync(index)), engine: inventory(engine, true, new Set(['.git', 'node_modules', 'dist', '.cache', '.turbo'])), metadata: Object.fromEntries(['AGENTS.md', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'packages/poe-agent/package.json'].map(path => [path, hash(readFileSync(join(privateRoot, path)))])) };
}
const before = privateState(), output = realpathSync(mkdtempSync(join(state.work, 'safejs-')));
const report = { candidate: state.candidate, packageSHA256: state.packageSHA256, origin, output, node, nodeSHA256: hash(readFileSync(node)), privateBefore: before, rows: [], origins: [] };
function frozen(path) { const bytes = git(repo, ['show', origin + ':' + path]); report.origins.push({ path, sha256: hash(bytes) }); return bytes; }
try {
  for (const family of ['surface', 'lifecycle', 'controls']) {
    const root = join(output, family); for (const path of ['consumer/harness', 'consumer/node_modules', 'engine', 'inputs', 'logs', 'tmp', 'node_modules']) mkdirSync(join(root, path), { recursive: true });
    cpSync(join(state.consumer, 'node_modules/virtual-bash'), join(root, 'consumer/node_modules/virtual-bash'), { recursive: true });
    cpSync(join(repo, 'node_modules/typescript'), join(root, 'node_modules/typescript'), { recursive: true });
    for (const [path, expected] of Object.entries(before.engine)) { const bytes = readFileSync(join(engine, path)); assert.equal(hash(bytes), expected.sha256); mkdirSync(dirname(join(root, 'engine', path)), { recursive: true }); writeFileSync(join(root, 'engine', path), bytes, { mode: 0o400 }); }
    writeFileSync(join(root, 'package.json'), '{"type":"module","private":true}\n'); writeFileSync(join(root, 'consumer/package.json'), '{"type":"module","private":true}\n');
    const names = git(repo, ['ls-tree', '-r', '--name-only', origin, '--', prefix + '/' + family]).toString().trim().split('\n');
    for (const path of names) { const name = path.slice((prefix + '/' + family + '/').length), bytes = frozen(path); const target = join(root, 'consumer/harness', name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); if (family === 'surface') { const input = join(root, 'inputs', name); mkdirSync(dirname(input), { recursive: true }); writeFileSync(input, bytes); } }
    const pins = JSON.parse(frozen(prefix + '/surface/PINS.json'));
    assert.equal(before.head, pins.privateEngine.lastRecordedHead);
    for (const entry of pins.privateEngine.staticImportClosure) assert.equal(before.engine[entry.path]?.sha256, entry.sha256, entry.path);
    cpSync(join(own, 'safejs-loader.mjs'), join(root, 'loader.mjs'));
    const protectedBefore = inventory(root), files = Object.fromEntries(Object.entries(protectedBefore).map(([path, item]) => [path, item.sha256]));
    writeFileSync(join(root, 'BINDING.json'), JSON.stringify({ files, engineClosure: pins.privateEngine.staticImportClosure.map(entry => 'engine/' + entry.path) }));
    const corpus = JSON.parse(readFileSync(join(root, 'consumer/harness/CASES.json'))), rows = family === 'surface' ? corpus.cases.slice(0, 8) : corpus.rows;
    let assess;
    if (family === 'surface') {
      const original = frozen(prefix + '/surface/run.mjs').toString(), start = original.indexOf('function assess('), end = original.indexOf('\nfunction auditImports(', start), code = original.slice(start, end);
      writeFileSync(join(root, 'assess.mjs'), `import assert from 'node:assert/strict'; import {createHash} from 'node:crypto'; const hash=bytes=>createHash('sha256').update(bytes).digest('hex'); export const create=cohort=>{${code};return assess;};\n`);
      assess = (await import(pathToFileURL(join(root, 'assess.mjs')))).create(corpus); report.assessmentFunctionSHA256 = hash(code.trimEnd());
    }
    for (const row of rows) {
      const resultFile = join(root, 'logs', row.id + '.json'), trace = join(root, 'logs', row.id + '.imports');
      const args = ['--permission', '--allow-fs-read=' + root, '--allow-fs-write=' + join(root, 'logs'), '--allow-fs-write=' + join(root, 'tmp'), '--import', join(root, 'loader.mjs'), join(root, 'consumer/harness/child.mjs')];
      const child = spawnSync(node, args, { cwd: join(root, 'consumer'), env: { PATH: dirname(node) + ':/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', SURFACE_ROOT: root, SURFACE_CASE: row.id, LIFECYCLE_ROW: row.id, SURFACE_RESULT: resultFile, SURFACE_IMPORTS: trace }, encoding: 'utf8', timeout: family === 'surface' ? 12000 : 9000, maxBuffer: 2 * 1024 * 1024 });
      writeFileSync(join(root, 'logs', row.id + '.stdout'), child.stdout ?? ''); writeFileSync(join(root, 'logs', row.id + '.stderr'), child.stderr ?? '');
      const actual = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile)) : undefined;
      const imports = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
      const engines = [...new Set(imports.filter(entry => entry.path.startsWith('engine/')).map(entry => entry.path))];
      const failures = engines.length === pins.privateEngine.staticImportClosure.length ? [] : ['actual-engine closure incomplete'];
      let assessment = family === 'surface' ? assess(row, actual, { code: child.status, signal: child.signal, timedOut: !!child.error }, { failures }) : { outcome: child.status === 0 && actual?.classification === 'PASS' && !failures.length ? 'PASS' : 'FAIL' };
      const result = { family, id: row.id, status: child.status, signal: child.signal, error: child.error?.message, engineLoadedFiles: engines.length, assessment, actual };
      report.rows.push(result); console.log(family, row.id, child.status, assessment.outcome, actual?.fatal?.message ?? child.stderr?.slice(-140));
    }
    const after = inventory(root);
    for (const [path, item] of Object.entries(protectedBefore)) assert.deepEqual(after[path], item, path);
    for (const path of Object.keys(after)) assert(path in protectedBefore || path.startsWith('logs/') || path.startsWith('tmp/') || ['BINDING.json', 'assess.mjs'].includes(path), 'unexpected entry ' + path);
  }
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (report.rows.length !== 25 || report.rows.some(row => row.assessment.outcome !== 'PASS')) process.exitCode = 1;
  report.privateAfter = privateState();
  try { assert.deepEqual(report.privateAfter, before); report.privateUnchanged = true; } catch (error) { report.privateChanged = error.message; process.exitCode = 1; }
  writeFileSync(join(output, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n'); console.log('SAFEJS REPORT', output);
}
