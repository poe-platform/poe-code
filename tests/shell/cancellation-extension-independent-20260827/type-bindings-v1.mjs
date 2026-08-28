import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const evidence = join(own, 'evidence-v2', 'declaration-bindings-v1');
const scratch = join(own, '.scratch-declaration-bindings-v1');
const freeze = 'cbed682564e1e3b1c2ac8062157ece7b8b997f30';
const oldFreeze = '647f42b9abf9f5abc4de3e36c74410b3bb63df3c';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const processes = [];
assert.equal(existsSync(evidence), false);
assert.equal(existsSync(scratch), false);
mkdirSync(evidence);
mkdirSync(scratch);
function write(filename, value) {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, value, { flag: 'wx' });
}
function json(filename, value) { write(filename, JSON.stringify(value, null, 2) + '\n'); }
function inventory(directory) {
  const members = {};
  function visit(filename) {
    const info = lstatSync(filename);
    assert.equal(info.isSymbolicLink(), false);
    const name = relative(directory, filename) || '.';
    if (info.isDirectory()) {
      members[name] = { kind: 'directory', mode: info.mode & 0o777 };
      for (const child of readdirSync(filename).sort()) visit(join(filename, child));
    } else {
      assert.ok(info.isFile());
      members[name] = { kind: 'file', mode: info.mode & 0o777, size: info.size, sha256: sha256(readFileSync(filename)) };
    }
  }
  visit(directory);
  return members;
}
try {
  const tools = join(scratch, 'tools');
  mkdirSync(tools);
  const node = join(tools, 'node');
  copyFileSync(realpathSync(process.execPath), node);
  chmodSync(node, 0o755);
  cpSync(join(repository, 'node_modules/typescript'), join(tools, 'typescript'), { recursive: true, dereference: true });
  const toolsBefore = inventory(tools);
  assert.deepEqual(toolsBefore, JSON.parse(readFileSync(join(own, 'evidence-v2/tools-before.json'))), 'same previously authenticated tools');
  json(join(evidence, 'tools-before.json'), toolsBefore);
  const moved = join(scratch, 'moved-internal');
  mkdirSync(moved);
  for (const filename of ['cancellation.js', 'cancellation.d.ts', 'package.json']) copyFileSync(join(own, 'evidence-v2/artifacts', `${filename}.data`), join(moved, filename));
  const rows = [
    ['old-positive', oldFreeze, 'tests/shell/cancellation-stage1-independent-20260827/positive-v1.ts.data', []],
    ['old-six-negative', oldFreeze, 'tests/shell/cancellation-stage1-independent-20260827/negative-v1.ts.data', [2, 3, 4, 5, 6, 7]],
    ['extension-positive', freeze, `${relative(repository, own)}/positive-v1.ts.data`, []],
    ['extension-eight-negative', freeze, `${relative(repository, own)}/negative-v1.ts.data`, [5, 6, 7, 8, 9, 10, 11, 12]],
  ];
  for (const [name, commit, originalPath] of rows) {
    const filename = `${name}-moved.ts`;
    write(join(moved, filename), execFileSync('git', ['show', `${commit}:${originalPath}`], { cwd: repository, maxBuffer: 1024 * 1024, timeout: 60000 }));
    json(join(moved, `tsconfig-${name}-moved.json`), { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], types: [], strict: true,
      exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, declaration: false }, files: [filename] });
  }
  const before = inventory(moved);
  json(join(evidence, 'moved-before.json'), before);
  const summaries = [];
  for (const [name, commit, originalPath, expectedRows] of rows) {
    const args = [join(tools, 'typescript/lib/tsc.js'), '--project', join(moved, `tsconfig-${name}-moved.json`), '--pretty', 'false', '--listFiles'];
    const result = spawnSync(node, args, { cwd: scratch, env: { PATH: '/usr/bin:/bin', HOME: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
    processes.push({ name, executable: node, executableSha256: toolsBefore.node.sha256, args, pid: result.pid, exit: result.status, signal: result.signal, error: result.error?.message ?? null });
    write(join(evidence, `${name}.stdout`), result.stdout ?? '');
    write(join(evidence, `${name}.stderr`), result.stderr ?? '');
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, expectedRows.length ? 2 : 0);
    const diagnostics = [...result.stdout.matchAll(/\((\d+),(\d+)\): error TS(\d+):/g)].map(match => ({ line: Number(match[1]), code: Number(match[3]) }));
    assert.deepEqual(diagnostics.map(item => item.line), expectedRows);
    const listed = result.stdout.split('\n').filter(line => line.startsWith(scratch + '/'));
    assert.ok(listed.includes(join(moved, 'cancellation.d.ts')), 'actual moved declaration consumed by compiler');
    assert.ok(!listed.some(filename => filename.endsWith('/cancellation.ts')), 'no source fallback');
    assert.ok(listed.every(filename => filename === join(moved, 'cancellation.d.ts') || filename === join(moved, `${name}-moved.ts`) || filename.startsWith(join(tools, 'typescript/lib') + '/')));
    summaries.push({ name, commit, originalPath, exit: result.status, diagnostics, loadedFiles: listed.map(filename => ({ path: relative(scratch, filename), sha256: sha256(readFileSync(filename)) })) });
  }
  json(join(evidence, 'summary.json'), { supplementalReplayNotNewControls: true, summaries });
  json(join(evidence, 'moved-after.json'), inventory(moved));
  json(join(evidence, 'tools-after.json'), inventory(tools));
  assert.deepEqual(inventory(moved), before);
  assert.deepEqual(inventory(tools), toolsBefore);
  json(join(evidence, 'scratch-before-removal.json'), inventory(scratch));
  json(join(evidence, 'processes.json'), processes);
  write(join(evidence, 'driver.mjs.data'), readFileSync(fileURLToPath(import.meta.url)));
  rmSync(scratch, { recursive: true });
  json(join(evidence, 'cleanup.json'), { enumeratedBeforeRemoval: true, path: scratch, absent: !existsSync(scratch) });
} catch (error) {
  json(join(evidence, `error-${Date.now()}.json`), { message: error.message, stack: error.stack, processes });
  throw error;
}
