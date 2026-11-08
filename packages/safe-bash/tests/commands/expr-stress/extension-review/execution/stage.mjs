import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvidence, git, json, owned, root, sha256, verifyFrozen } from './review.mjs';

const cleanEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
let interrupted = false;
export async function command(binary, args, cwd, timeoutMs = 120000) {
  assert(!interrupted, 'subprocess admission closed');
  return await new Promise(resolveResult => {
    const child = spawn(binary, args, { cwd, env: cleanEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = [];
    let bytes = 0, failure = null;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const interrupt = () => { interrupted = true; failure = 'interrupted'; kill(); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const timer = setTimeout(() => { failure = `deadline ${timeoutMs}ms`; kill(); }, timeoutMs);
    for (const [stream, target] of [[child.stdout, output], [child.stderr, errors]]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= 8 * 1024 * 1024) target.push(Buffer.from(chunk));
      else { failure = 'output exceeded 8MiB'; kill(); }
    });
    child.on('error', error => { failure = error.message; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      resolveResult({ binary, args, cwd, timeoutMs, status, signal, failure, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() });
    });
  });
}
function filesAt(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), relativePath = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `symlink in authenticated product tree ${path}`);
    return stat.isDirectory() ? filesAt(path, relativePath) : [{ path: relativePath, sha256: sha256(readFileSync(path)) }];
  });
}
export async function stage(commit, label, kind = 'candidate') {
  assert(kind === 'candidate' || kind === 'baseline');
  if (kind === 'baseline') assert.equal(commit, '8f19a9d5bb244ff6c095b7117e6d0738fdf40421');
  assert(/^[0-9a-f]{40}$/.test(commit), 'full explicit candidate commit required');
  assert.equal(git('rev-parse', `${commit}^{commit}`).toString().trim(), commit);
  assert(!commit.startsWith('85675366'), 'historical nonregex candidate is not extension acceptance');
  assert(label && /^[a-z0-9][a-z0-9-]{0,79}$/.test(label));
  const receiptPath = `${owned}/${label}/stage.json`;
  assert(!existsSync(join(root, owned, label)), 'unique stage label required');
  const freezes = verifyFrozen();
  const handoff = readFileSync('/tmp/expr-extension-author-candidate.txt');
  if (kind === 'candidate') assert(handoff.toString().includes(commit), 'commit absent from author handoff');
  const sourceRoot = mkdtempSync(join(tmpdir(), 'expr-final-archive-'));
  const destinationRoot = mkdtempSync(join(tmpdir(), 'expr-final-moved-'));
  const source = join(sourceRoot, 'source');
  mkdirSync(source);
  const receipt = { schema: 1, startedAt: new Date().toISOString(), commit, sourceTreeGitId: git('rev-parse', `${commit}:src`).toString().trim(), handoffSha256: sha256(handoff), handoffText: handoff.toString(), sourceRoot, destinationRoot, source, freezes, commands: [], status: 'BLOCKED', runtimeExecuted: false };
  receipt.kind = kind;
  const run = async (binary, args, cwd, timeoutMs) => {
    const result = await command(binary, args, cwd, timeoutMs);
    receipt.commands.push(result);
    assert.equal(result.failure, null, json(result));
    assert.equal(result.signal, null, json(result));
    assert.equal(result.status, 0, json(result));
    return result;
  };
  try {
    const archive = join(sourceRoot, 'candidate.tar');
    await run('git', ['archive', '--format=tar', `--output=${archive}`, commit], root, 60000);
    receipt.archiveSha256 = sha256(readFileSync(archive));
    await run('/usr/bin/tar', ['-xf', archive, '-C', source], sourceRoot, 60000);
    const productInputs = filesAt(join(source, 'src'));
    receipt.sourceFiles = productInputs;
    receipt.sourceTreeSha256 = sha256(json(productInputs));
    for (const item of productInputs) assert.equal(item.sha256, sha256(git('show', `${commit}:src/${item.path}`)));
    const buildInputs = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
    receipt.buildInputs = buildInputs.filter(path => existsSync(join(source, path))).map(path => ({ path, sha256: sha256(readFileSync(join(source, path))) }));
    for (const item of receipt.buildInputs) assert.equal(item.sha256, sha256(git('show', `${commit}:${item.path}`)));
    receipt.devtools = ['typescript/lib/tsc.js', 'typescript/lib/_tsc.js', 'typescript/package.json', '@types/node/package.json', 'tsx/package.json'].filter(path => existsSync(join(root, 'node_modules', path))).map(path => ({ path, sha256: sha256(readFileSync(join(root, 'node_modules', path))) }));
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    await run(process.execPath, [join(source, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], source);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json')));
    assert.equal(manifest.name, 'virtual-bash');
    assert.deepEqual(manifest.dependencies ?? {}, {}, 'zero runtime dependencies required');
    receipt.packageExports = manifest.exports;
    receipt.exprPackageSubpath = manifest.exports?.['./commands/expr'] ?? null;
    const pack = await run('npm', ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', sourceRoot], source);
    const packed = JSON.parse(pack.stdout);
    assert.equal(packed.length, 1);
    assert.equal(basename(packed[0].filename), packed[0].filename);
    receipt.pack = packed[0];
    const tarball = join(sourceRoot, packed[0].filename);
    receipt.packageSha256 = sha256(readFileSync(tarball));
    const origin = join(sourceRoot, 'install-origin');
    mkdirSync(origin);
    await run('npm', ['install', '--prefix', origin, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', tarball], origin);
    const moved = join(destinationRoot, 'consumer');
    renameSync(origin, moved);
    assert(!existsSync(origin));
    const installed = join(moved, 'node_modules/virtual-bash');
    receipt.installed = installed;
    receipt.installedFiles = filesAt(installed);
    receipt.installedArtifactSha256 = sha256(json(receipt.installedFiles));
    receipt.exprStandalonePath = join(installed, 'dist/commands/expr/index.js');
    if (kind === 'candidate') assert(existsSync(receipt.exprStandalonePath));
    receipt.importQualification = 'NOT RUN. Installed standalone file path only; no expr package-subpath/default/root export claim.';
    assert.deepEqual(filesAt(join(source, 'src')), productInputs, 'archive product input changed or appended');
    assert.equal(sha256(readFileSync(archive)), receipt.archiveSha256);
    assert.deepEqual(verifyFrozen(), freezes);
    receipt.status = 'STAGED ONLY; candidate-specific binding, runtime, controls, declarations, mutations NOT RUN';
    receipt.integrity = { sourceOriginalAndNewEntriesChecked: true, entireArchiveTreeAppendProof: false, archiveContainerUnchanged: true };
  } catch (error) {
    receipt.failure = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    receipt.completedAt = new Date().toISOString();
    receipt.adapterSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
    addEvidence(receiptPath, receipt);
  }
  console.log(json({ receiptPath, status: receipt.status, failure: receipt.failure, source, installed: receipt.installed }));
  if (receipt.failure) process.exitCode = 1;
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stage(...process.argv.slice(2));
