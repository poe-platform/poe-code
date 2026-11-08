import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const repo = realpathSync(join(here, '../../../../..'));
assert.equal(repo, '/Users/kjopek/Workspace/safe-bash');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(readFileSync(join(here, 'FREEZE.json')));
for (const [name, digest] of Object.entries(frozen.files)) assert.equal(hash(readFileSync(join(here, name))), digest);
const scratch = mkdtempSync('/tmp/fraction-semantics-source-');
const snapshot = join(scratch, 'snapshot');
const output = join(scratch, 'output');
mkdirSync(snapshot); mkdirSync(output);
const records = [];
const exec = (program, args, cwd = scratch, timeout = 120000) => {
  const started = performance.now();
  const result = spawnSync(program, args, { cwd, env: { LC_ALL: 'C', TZ: 'UTC0', PATH: '/usr/bin:/bin' }, timeout, maxBuffer: 16 * 1024 * 1024 });
  const record = { program, args, cwd, status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdoutHex: result.stdout?.toString('hex') ?? '', stderrHex: result.stderr?.toString('hex') ?? '', milliseconds: performance.now() - started };
  records.push(record);
  return record;
};
const checked = (...args) => { const result = exec(...args); assert.equal(result.status, 0, JSON.stringify(result)); return Buffer.from(result.stdoutHex, 'hex'); };
const inventory = (directory, prefix = '') => Object.fromEntries(readdirSync(directory).sort().flatMap(name => {
  const path = join(directory, name), relative = prefix + name;
  return statSync(path).isDirectory() ? Object.entries(inventory(path, relative + '/')) : [[relative, hash(readFileSync(path))]];
}));
let manifest = { startedAt: new Date().toISOString(), identity: frozen.identity, commit: frozen.commit, scratch, records };
try {
  const archive = join(scratch, 'source.tar');
  checked('/usr/bin/git', ['archive', '--format=tar', '--output=' + archive, frozen.commit, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], repo);
  checked('/usr/bin/tar', ['-xf', archive, '-C', snapshot]);
  const sourceBefore = inventory(snapshot);
  const cases = JSON.parse(readFileSync(join(here, 'cases.frozen.json')));
  assert.equal(sourceBefore['src/commands/time-env/format.ts'], cases.formatHash);
  const tree = checked('/usr/bin/git', ['rev-parse', frozen.commit + '^{tree}'], repo).toString().trim();
  const expectedPaths = checked('/usr/bin/git', ['ls-tree', '-r', '--name-only', frozen.commit, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], repo).toString().trim().split('\n');
  assert.deepEqual(Object.keys(sourceBefore).sort(), expectedPaths.sort());
  for (const path of expectedPaths) assert.equal(sourceBefore[path], hash(checked('/usr/bin/git', ['show', frozen.commit + ':' + path], repo)), path);
  checked(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(snapshot, 'tsconfig.build.json'), '--typeRoots', join(repo, 'node_modules/@types')]);
  const dist = inventory(join(snapshot, 'dist'));
  writeFileSync(join(output, 'dist-hashes.json'), JSON.stringify(dist, null, 2) + '\n');
  const sourceAfter = Object.fromEntries(Object.entries(inventory(snapshot)).filter(([path]) => !path.startsWith('dist/')));
  assert.deepEqual(sourceAfter, sourceBefore);
  const run = exec(process.execPath, ['--max-old-space-size=256', join(here, 'consumer.mjs'), snapshot, output, here], scratch, 60000);
  for (const name of readdirSync(output)) copyFileSync(join(output, name), join(here, name), 1);
  writeFileSync(join(here, 'consumer.stdout'), Buffer.from(run.stdoutHex, 'hex'), { flag: 'wx' });
  writeFileSync(join(here, 'consumer.stderr'), Buffer.from(run.stderrHex, 'hex'), { flag: 'wx' });
  const sourceFinal = Object.fromEntries(Object.entries(inventory(snapshot)).filter(([path]) => !path.startsWith('dist/')));
  assert.deepEqual(sourceFinal, sourceBefore);
  assert.deepEqual(inventory(join(snapshot, 'dist')), dist);
  manifest = { ...manifest, tree, archiveSha256: hash(readFileSync(archive)), sourceBefore, sourceAfter, sourceFinal,
    sourceUnchanged: true, compilerConfigUnchanged: true, distUnchanged: true, resultStatus: run.status,
    typecheck: 'Pinned full committed src compiled under unchanged config; installed TypeScript and @types/node are read-only development tooling.',
    archiveScope: 'Every src file plus committed package.json and both tsconfigs; no source overlay, private engine, runtime patch, package installation or old/new corpus replay.',
    compilerSha256: hash(readFileSync(join(repo, 'node_modules/typescript/lib/_tsc.js'))), nodeSha256: hash(readFileSync(process.execPath)) };
  console.log(Buffer.from(run.stdoutHex, 'hex').toString());
} finally {
  rmSync(scratch, { recursive: true, force: true });
  manifest.finishedAt = new Date().toISOString();
  manifest.temporaryRemoved = true;
  manifest.records = records.filter(record => !(record.program === '/usr/bin/git' && record.args[0] === 'show')).map(record => ({ ...record,
    stdoutHex: record.args.some(argument => argument.endsWith('consumer.mjs')) ? '[see consumer.stdout]' : record.stdoutHex }));
  writeFileSync(join(here, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}
