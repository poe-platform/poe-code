import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const scope = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scope, '../../..');
const candidates = {
  b494: 'b494675c34dc289f4ad4b10a9201e1211eb0a7d8',
  current: '954406871fae381b1c69441b34946a224201d7ad',
};
const label = process.argv[2];
assert.ok(Object.hasOwn(candidates, label), 'Choose b494 or current; revisions are pinned, never HEAD');
const revision = candidates[label];
const attempt = process.argv[3] ?? 'v1';
assert.match(attempt, /^v[1-9][0-9]*$/);
const output = join(scope, 'evidence', attempt === 'v1' ? label : `${label}-${attempt}`);
mkdirSync(output, { recursive: true });
assert.ok(!existsSync(join(output, 'START.json')), 'Use a new reviewed evidence destination, never overwrite a cohort');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceTools = realpathSync(join(repository, 'node_modules'));
const launcherBefore = hash(readFileSync(join(sourceTools, 'typescript/bin/tsc')));
const json = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const git = args => {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const scratch = mkdtempSync(join(mkdirSync(join(scope, '.runs'), { recursive: true }) ?? join(scope, '.runs'), `${label}-`));
const snapshot = join(scratch, 'snapshot');
mkdirSync(snapshot);
const tracked = git(['ls-tree', '-rz', revision]).toString().split('\0').filter(Boolean).map(line => {
  const delimiter = line.indexOf('\t');
  const header = line.slice(0, delimiter);
  const path = line.slice(delimiter + 1);
  const [mode, type, object] = header.split(' ');
  assert.equal(type, 'blob');
  assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
  return { mode, object, path };
});
assert.ok(!tracked.some(entry => entry.path.startsWith('dist/') || entry.path.startsWith('node_modules/')));
json('START.json', { revision, label, observedHead: git(['rev-parse', 'HEAD']).toString().trim(), startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, processExecutable: process.execPath, processExecutableSha256: hash(readFileSync(process.execPath)), scratch, snapshot, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), trackedFiles: tracked.length, policy: 'Entire git archive; no mutable source fallback, no tests, network, installation or private engine access. Existing development tools copied as regular files; literal tracked symlinks never followed by the census.' });

function censusTracked() {
  return tracked.map(entry => {
    const absolute = join(snapshot, entry.path);
    const stat = lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), entry.mode === '120000', entry.path);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
    const object = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(object, entry.object, `Tracked input changed: ${entry.path}`);
    return { ...entry, bytes: bytes.length, sha256: hash(bytes) };
  });
}

function censusDirectory(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Unexpected generated/tool symlink: ${path}`);
    if (entry.isDirectory()) return censusDirectory(path, base);
    const bytes = readFileSync(path);
    return [{ path: relative(base, path), bytes: bytes.length, sha256: hash(bytes) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function copyRegularTools(source, destination) {
  const resolved = realpathSync(source);
  assert.ok(resolved === sourceTools || resolved.startsWith(`${sourceTools}/`), `Tool target escaped the existing dependency tree: ${source}`);
  const stat = lstatSync(resolved);
  if (stat.isDirectory()) {
    mkdirSync(destination);
    for (const name of readdirSync(resolved)) copyRegularTools(join(resolved, name), join(destination, name));
  } else {
    assert.ok(stat.isFile());
    writeFileSync(destination, readFileSync(resolved), { flag: 'wx', mode: stat.mode & 0o777 });
  }
}

function compressed(name, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const stored = Buffer.from(`${gzipSync(bytes, { level: 9 }).toString('base64')}\n`);
  writeFileSync(join(output, `${name}.json.gzbase64`), stored, { flag: 'wx' });
  return { path: `${name}.json.gzbase64`, encoding: 'gzip-base64', bytes: bytes.length, sha256: hash(bytes), storedSha256: hash(stored) };
}

function command(name, executable, args) {
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd: snapshot, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  writeFileSync(join(output, `${name}.stdout.log`), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(join(output, `${name}.stderr.log`), result.stderr ?? '', { flag: 'wx' });
  const diagnostics = [...(result.stdout ?? '').matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)].map(match => ({ path: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5] }));
  const record = { executable, args, cwd: snapshot, status: result.status, signal: result.signal, error: result.error?.message ?? null, elapsedMs: performance.now() - start, stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''), diagnostics };
  json(`${name}.json`, record);
  assert.equal(result.error, undefined, `${name} tooling failure`);
  return record;
}

try {
  const archivePath = join(scratch, 'source.tar');
  const descriptor = openSync(archivePath, 'wx');
  const archive = spawnSync('git', ['archive', revision], { cwd: repository, stdio: ['ignore', descriptor, 'pipe'], timeout: 120000 });
  closeSync(descriptor);
  assert.equal(archive.status, 0, archive.stderr?.toString());
  const archiveSha256 = hash(readFileSync(archivePath));
  const extract = spawnSync('tar', ['-xf', archivePath, '-C', snapshot], { timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(extract.status, 0, extract.stderr?.toString());
  const inputs = compressed('tracked-inputs', censusTracked());
  assert.ok(!existsSync(join(snapshot, 'dist')));
  copyRegularTools(sourceTools, join(snapshot, 'node_modules'));
  const compiler = join(snapshot, 'node_modules/typescript/bin/tsc');
  assert.ok(lstatSync(join(snapshot, 'node_modules/.bin/tsc')).isFile());
  writeFileSync(join(snapshot, 'node_modules/.bin/tsc'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(compiler)} "$@"\n`, { mode: 0o755 });
  const tools = compressed('development-tools', censusDirectory(join(snapshot, 'node_modules')));
  const versions = { typescript: JSON.parse(readFileSync(join(snapshot, 'node_modules/typescript/package.json'))).version, nodeTypes: JSON.parse(readFileSync(join(snapshot, 'node_modules/@types/node/package.json'))).version };
  const cold = command('cold-typecheck', 'npm', ['run', 'typecheck']);
  assert.ok(!existsSync(join(snapshot, 'dist')), 'Cold noEmit unexpectedly produced dist');
  command('cold-files', process.execPath, [compiler, '--noEmit', '--listFilesOnly', '--pretty', 'false']);
  const build = command('build', 'npm', ['run', 'build']);
  const buildArtifacts = existsSync(join(snapshot, 'dist')) ? compressed('build-artifacts', censusDirectory(join(snapshot, 'dist'))) : null;
  const warm = command('warm-typecheck', 'npm', ['run', 'typecheck']);
  command('warm-files', process.execPath, [compiler, '--noEmit', '--listFilesOnly', '--pretty', 'false']);
  const probeDirectory = join(snapshot, 'diagnostic-probes');
  mkdirSync(probeDirectory);
  const config = files => ({ extends: '../tsconfig.json', include: [], exclude: [], files });
  const consumerFiles = [
    '../tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts',
    '../tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts',
    '../tests/integration/adapter-tools/atomic-webdav-profile/controls.ts',
  ];
  writeFileSync(join(probeDirectory, 'consumers.json'), JSON.stringify(config(consumerFiles)));
  const consumers = command('maintained-consumers-built', process.execPath, [compiler, '--noEmit', '-p', 'diagnostic-probes/consumers.json', '--pretty', 'false']);
  assert.equal(consumers.status, 0, 'The three maintained consumers must really compile, not be omitted');
  const badEncoder = 'export function encode(this: TextEncoder, text: string): Uint8Array { return this.encode(text); }\n';
  writeFileSync(join(probeDirectory, 'encoder-original.ts'), badEncoder);
  writeFileSync(join(probeDirectory, 'encoder-import.ts'), 'import type { TextEncoder } from "node:util";\n' + badEncoder);
  writeFileSync(join(probeDirectory, 'encoder-negative.ts'), 'import type { TextEncoder } from "node:util";\nexport function encode(this: TextEncoder): Uint8Array { return this.encode(42); }\n');
  for (const name of ['original', 'import', 'negative']) {
    writeFileSync(join(probeDirectory, `encoder-${name}.json`), JSON.stringify(config([`encoder-${name}.ts`])));
    const check = command(`encoder-${name}`, process.execPath, [compiler, '--noEmit', '-p', `diagnostic-probes/encoder-${name}.json`, '--pretty', 'false']);
    if (name === 'import') assert.equal(check.status, 0);
    else assert.deepEqual(check.diagnostics.map(entry => entry.code), [name === 'original' ? 'TS2749' : 'TS2345']);
  }
  const restored = join(probeDirectory, 'restored-contracts');
  mkdirSync(restored);
  const historical = 'tests/commands/filesystem-inspection-stress/tree/sealed/inputs';
  const restoredFiles = [];
  for (const name of readdirSync(join(snapshot, historical)).filter(name => name.endsWith('.ts'))) {
    const restoredName = name.replace('src__contracts__', '');
    writeFileSync(join(restored, restoredName), readFileSync(join(snapshot, historical, name)), { flag: 'wx' });
    restoredFiles.push(`restored-contracts/${restoredName}`);
  }
  writeFileSync(join(probeDirectory, 'restored.json'), JSON.stringify(config(restoredFiles)));
  const restoredCheck = command('historical-layout-restored', process.execPath, [compiler, '--noEmit', '-p', 'diagnostic-probes/restored.json', '--pretty', 'false']);
  assert.equal(restoredCheck.status, 0, 'Same historical bytes must typecheck when their relative layout is restored');
  const probes = compressed('probe-inputs', censusDirectory(probeDirectory));
  const after = compressed('tracked-after', censusTracked());
  assert.equal(after.sha256, inputs.sha256, 'Source/config/evidence changed during typing');
  assert.equal(hash(readFileSync(join(sourceTools, 'typescript/bin/tsc'))), launcherBefore);
  json('SUMMARY.json', { revision, archiveSha256, versions, inputs, tools, buildArtifacts, probes, after, sourceLauncherUnchanged: launcherBefore, cold: { status: cold.status, diagnostics: cold.diagnostics.length }, build: { status: build.status, diagnostics: build.diagnostics.length }, warm: { status: warm.status, diagnostics: warm.diagnostics.length }, coldOnly: cold.diagnostics.filter(entry => !warm.diagnostics.some(other => JSON.stringify(other) === JSON.stringify(entry))), finishedAt: new Date().toISOString() });
  console.log(JSON.stringify({ label, revision, cold: cold.diagnostics.length, build: build.status, warm: warm.diagnostics.length }));
} catch (error) {
  json('FAILURE.json', { name: error.name, message: error.message, stack: error.stack });
  throw error;
} finally {
  assert.ok(realpathSync(scratch).startsWith(`${realpathSync(join(scope, '.runs'))}/`));
  rmSync(scratch, { recursive: true, force: true });
  json('CLEANUP.json', { scratch, removed: !existsSync(scratch), finishedAt: new Date().toISOString(), children: 'Synchronous bounded archive, extraction, npm/compiler children only; no services/test workers started.' });
}
