import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addJSON, command, directory, env, git, hash, inventory, json, root } from './common.mjs';

assert.equal(process.argv[2], '--baseline-once');
assert.ok(!existsSync(path.join(directory, 'baseline-01.json')));
const freezeCommit = 'c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb';
const manifest = json('FREEZE-MANIFEST.json');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'expr-history-freeze-v4-baseline-'));
const source = path.join(scratch, 'source');
const compiled = path.join(scratch, 'compiled');
mkdirSync(source);
const record = { started: new Date().toISOString(), baseline: manifest.baseline.commit, freezeCommit, scratch, node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, platform: { platform: os.platform(), release: os.release(), arch: os.arch() }, commands: [] };
let sourceBefore;
let compiledBefore;
try {
  for (const entry of manifest.entries) if (entry.kind === 'file') assert.equal(hash(readFileSync(path.join(directory, entry.path))), entry.sha256, entry.path);
  const archive = git(['archive', '--format=tar', manifest.baseline.commit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
  record.archiveSha256 = hash(archive);
  const extraction = spawnSync('/usr/bin/tar', ['-xf', '-', '-C', source], { input: archive, timeout: 20000, maxBuffer: 65536 });
  assert.equal(extraction.status, 0, String(extraction.stderr));
  sourceBefore = inventory(source);
  assert.deepEqual(sourceBefore.filter(entry => entry.kind === 'file').map(({ path: filename, sha256 }) => ({ path: filename, sha256 })).sort((left, right) => left.path.localeCompare(right.path)), manifest.baseline.files.map(({ path: filename, sha256 }) => ({ path: filename, sha256 })).sort((left, right) => left.path.localeCompare(right.path)));
  const compiler = path.join(root, 'node_modules/typescript/lib/tsc.js');
  record.compiler = { path: compiler, sha256: hash(readFileSync(compiler)), package: JSON.parse(readFileSync(path.join(root, 'node_modules/typescript/package.json'))).version };
  const build = command(process.execPath, [compiler, '-p', path.join(source, 'tsconfig.build.json'), '--outDir', compiled, '--typeRoots', path.join(root, 'node_modules/@types')], { cwd: source, timeout: 120000, maxBuffer: 1024 * 1024 });
  record.commands.push(build);
  assert.equal(build.status, 0, Buffer.from(build.stdoutHex, 'hex').toString());
  copyFileSync(path.join(source, 'package.json'), path.join(compiled, 'package.json'));
  compiledBefore = inventory(compiled);
  record.sourceBefore = sourceBefore;
  record.compiledBefore = compiledBefore;
  record.workerSourceSha256 = hash(readFileSync(path.join(source, 'src/commands/expr/bre-worker.ts')));
  record.commandSourceSha256 = hash(readFileSync(path.join(source, 'src/commands/expr/index.ts')));
  record.workerCompiledSha256 = hash(readFileSync(path.join(compiled, 'commands/expr/bre-worker.js')));
  record.probeSha256 = hash(readFileSync(path.join(directory, 'baseline-probe.mjs')));
  record.runnerSha256 = hash(readFileSync(path.join(directory, 'run-baseline.mjs')));
  const provenance = path.join(scratch, 'provenance.json');
  writeFileSync(provenance, JSON.stringify(record), { flag: 'wx' });
  const patchExecutable = spawnSync('/usr/bin/which', ['apply_patch'], { encoding: 'utf8' });
  assert.equal(patchExecutable.status, 0);
  const probe = command(process.execPath, [path.join(directory, 'baseline-probe.mjs'), compiled, provenance], { cwd: scratch, env: { ...env, PATH: `${path.dirname(patchExecutable.stdout.trim())}:/usr/bin:/bin` }, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  record.commands.push(probe);
  if (probe.stdoutHex) record.capture = JSON.parse(Buffer.from(probe.stdoutHex, 'hex').toString());
  assert.equal(probe.status, 0, Buffer.from(probe.stderrHex, 'hex').toString());
} catch (error) { record.failure = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
  try {
    if (sourceBefore) assert.deepEqual(inventory(source), sourceBefore);
    if (compiledBefore) assert.deepEqual(inventory(compiled), compiledBefore);
    for (const entry of manifest.entries) if (entry.kind === 'file') assert.equal(hash(readFileSync(path.join(directory, entry.path))), entry.sha256, entry.path);
    for (const cohort of manifest.historical) for (const entry of cohort.files) assert.equal(hash(readFileSync(path.join(root, entry.path))), entry.sha256, entry.path);
    record.postIntegrity = { sourceAndCompiledUnchanged: true, addedFilesAndEmptyDirectoriesDetected: true, symlinksRejected: true, frozenAndOriginalEvidenceUnchanged: true, caveat: 'Not a whole live repository append-proof check; unrelated live edits never entered or vetoed archive.' };
  } catch (error) { record.integrityFailure = { name: error.name, message: error.message }; process.exitCode = 1; }
  assert.ok(scratch.startsWith(path.join(os.tmpdir(), 'expr-history-freeze-v4-baseline-')));
  rmSync(scratch, { recursive: true });
  record.cleanup = { ownedScratchRemoved: !existsSync(scratch), sharedDistUsedOrEdited: false, nativeFixturesCreated: false, childrenAwaited: true };
  record.finished = new Date().toISOString();
  addJSON('baseline-01.json', record);
  console.log(JSON.stringify({ failure: record.failure, counts: record.capture?.counts, cleanup: record.cleanup, workers: record.capture?.cleanup }));
}
