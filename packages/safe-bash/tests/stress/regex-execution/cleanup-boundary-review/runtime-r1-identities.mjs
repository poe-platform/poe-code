import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const runtime = '1b133a8662a32ee84524794842074c9c98d5f6c3';
const registration = '01aa1bffe0568cc6787d5ff8e0331e024a787385';
const fixture = '10273352f8d65d929cbf5a23e69119414dacee60';
const contract = '07acb1a4d30b7592cf247a0220250317be4e2038';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const show = (commit, path) => git('show', `${commit}:${path}`);
const freezePath = resolve(owned, 'evidence/runtime-r1-freeze.json');
const buildPath = resolve(owned, 'evidence/runtime-r1-build.json');
const freeze = JSON.parse(await readFile(freezePath));
const build = JSON.parse(await readFile(buildPath));
assert.equal(freeze.commit, runtime);
assert.equal(freeze.mode, 'runtime-handoff');
assert.equal(build.status, 0);
const snapshot = resolve(owned, '.temporary/runtime-r1');
for (const entry of freeze.identities) {
  assert.equal(hash(show(runtime, entry.path)), entry.sha256);
  assert.equal(hash(await readFile(resolve(snapshot, entry.path))), entry.sha256);
}
for (const entry of build.emitted) assert.equal(hash(await readFile(resolve(snapshot, entry.path))), entry.sha256);
const identities = [];
for (const [commit, paths] of [
  [registration, ['src/commands/grep.ts', 'src/commands/search/rg.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/README.md']],
  [fixture, ['tests/commands/regex-execution/followup/messageerror.test.ts']],
  [contract, ['src/contracts/command.ts', 'src/contracts/command.md']],
  [runtime, ['src/shell/cleanup.ts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'tests/shell/invocation-cleanup-setup.test.ts']],
]) {
  git('merge-base', '--is-ancestor', commit, runtime);
  for (const path of paths) {
    const bytes = show(commit, path);
    assert.equal(hash(show(runtime, path)), hash(bytes), path);
    identities.push({ path, commit, runtimeCommit: runtime, sha256: hash(bytes), identicalAtRuntime: true });
    if (path.startsWith('tests/')) {
      const target = resolve(snapshot, path);
      await mkdir(dirname(target), { recursive: true });
      try { await writeFile(target, bytes, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(hash(await readFile(target)), hash(bytes)); }
    }
  }
}
const packedRoot = resolve(owned, '.temporary/runtime-r1-packed-old-five/production-continuation-review/node_modules/virtual-bash');
const graph = [];
async function visit(path) {
  if (graph.some(entry => entry.path === path)) return;
  const bytes = await readFile(resolve(packedRoot, path));
  assert.equal(hash(bytes), build.emitted.find(entry => entry.path === path)?.sha256, path);
  const imports = [...bytes.toString().matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/gu)].map(match => match[1]);
  graph.push({ path, sha256: hash(bytes), imports });
  for (const specifier of imports) {
    if (specifier.startsWith('.')) {
      const target = resolve(packedRoot, dirname(path), specifier);
      assert.ok(target.startsWith(`${packedRoot}/`));
      await visit(target.slice(packedRoot.length + 1));
    } else assert.ok(specifier.startsWith('node:'), specifier);
  }
}
await visit('dist/commands/regex-execution/worker.js');
const protocol = await import(new URL(`file://${resolve(snapshot, 'dist/commands/regex-execution/protocol.js')}`));
const protocolSource = show(runtime, 'src/commands/regex-execution/protocol.ts').toString();
assert.match(protocolSource, /requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2/u);
const nativeRoot = 'tests/commands/regex-execution/continuation/artifacts/native';
const nativeData = (await readdir(nativeRoot, { recursive: true })).map(path => `${nativeRoot}/${path}`).filter(path => /\/dialect-[^/]+\/(?:alpha|beta|ab|🙂|a|d)\.ts$/u.test(path)).sort();
const dataIdentities = await Promise.all(nativeData.map(async path => ({ path, sha256: hash(await readFile(path)), provenance: 'existing ignored native DATA, not git-tracked runtime source' })));
assert.equal(dataIdentities.length, 6);
assert.ok(dataIdentities.every(entry => entry.sha256 === '74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8'));
const harnessPaths = ['freeze.mjs', 'build.mjs', 'old-five.mjs', 'runtime.mjs', 'registration.mjs', 'guard.mjs', 'audit.mjs'];
const harnesses = await Promise.all(harnessPaths.map(async path => ({ path, sha256: hash(await readFile(resolve(owned, path))) })));
const record = { runtime, registration, fixture, contract, time: new Date().toISOString(), sourceManifestSha256: hash(await readFile(freezePath)), buildManifestSha256: hash(await readFile(buildPath)), sourceFiles: freeze.identities.length, compiledFiles: build.emitted.length, identities, harnesses, packedRoot, staticWorkerGraph: graph, protocolExports: Object.keys(protocol), defaults: { activeMs: 1000, startupMs: 3000, leases: 2 }, immutableNativeData: dataIdentities, globalTypecheck: 'NOT RUN: six immutable DATA files retain TS2304 qualification; Faraday alone owns root configuration', riskConsumed: 0 };
await writeFile(resolve(owned, 'evidence/runtime-r1-combination.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sourceFiles: record.sourceFiles, compiledFiles: record.compiledFiles, combinationIdentities: identities.length, staticWorkerGraph: graph.length, nativeData: dataIdentities.length }));
