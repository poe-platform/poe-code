import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/runtime-error-adjudication');
const prior = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const correctionOnly = process.argv[2] === '--group2-harness-correction';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(resolve(owned, 'EXPECTATIONS.md'))), 'd0d2aaea2142d47248d33964df3fad69a89731a443ac298013ca134a4ccf0b77');
const provenance = [];
for (const [label, commit] of [['baseline', '07acb1a4d30b7592cf247a0220250317be4e2038'], ['runtime-r1', '1b133a8662a32ee84524794842074c9c98d5f6c3']]) {
  const freezeBytes = await readFile(resolve(prior, 'evidence', `${label}-freeze.json`));
  const buildBytes = await readFile(resolve(prior, 'evidence', `${label}-build.json`));
  const freeze = JSON.parse(freezeBytes);
  const build = JSON.parse(buildBytes);
  assert.equal(freeze.commit, commit);
  assert.equal(build.sourceCommit, commit);
  assert.equal(build.status, 0);
  for (const entry of [...freeze.identities, ...build.emitted]) assert.equal(hash(await readFile(resolve(prior, '.temporary', label, entry.path))), entry.sha256, `${label}: ${entry.path}`);
  for (const path of ['src/shell/runtime.ts', 'src/shell/shell.ts', 'src/contracts/command.md', 'src/shell/types.ts']) {
    const entry = freeze.identities.find(identity => identity.path === path);
    assert.equal(hash(execFileSync('git', ['show', `${commit}:${path}`], { maxBuffer: 1024 * 1024 })), entry.sha256);
  }
  provenance.push({ label, commit, sourceFilesVerified: freeze.identities.length, compiledFilesVerified: build.emitted.length, freezeSha256: hash(freezeBytes), buildSha256: hash(buildBytes), relevant: [...freeze.identities, ...build.emitted].filter(entry => ['src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/types.ts', 'src/shell/cleanup.ts', 'src/contracts/command.md', 'dist/shell/runtime.js', 'dist/shell/shell.js', 'dist/shell/cleanup.js'].includes(entry.path)) });
}
const fixtureCommit = '10273352f8d65d929cbf5a23e69119414dacee60';
const fixture = execFileSync('git', ['show', `${fixtureCommit}:tests/stress/regex-execution/cleanup-boundary-review/runtime.mjs`], { encoding: 'utf8', maxBuffer: 65536 });
const marker = "await check('public:primary-error-and-abort-during-drain-identities', async () => {\n";
const originalBody = fixture.split(marker)[1].split('\n});')[0];
const copied = await readFile(resolve(owned, 'original-group.mjs'), 'utf8');
assert.equal(copied.slice(copied.indexOf('\n') + 1, copied.lastIndexOf('\n}')), originalBody);
const claim = { time: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, provenance, fixtureCommit, fixtureSha256: hash(fixture), originalBodySha256: hash(originalBody), originalBodyByteEqual: true, registrationCommit: '01aa1bffe0568cc6787d5ff8e0331e024a787385', files: {}, strictUnhandled: true, watchdogMs: 15000, outputCap: 16384, heapMb: 128, riskConsumed: 0, broadTests: false, mainResultsCertified: false };
if (correctionOnly) claim.correction = { group: 2, originalEvidenceSha256: hash(await readFile(resolve(owned, 'results.json'))), reason: 'Read AggregateError.errors on captured public outcome, not Node AssertionError.actual copy; preserve original assertion body.' };
for (const name of ['EXPECTATIONS.md', 'controls.mjs', 'original-group.mjs', 'run.mjs']) claim.files[name] = hash(await readFile(resolve(owned, name)));
const childResult = await new Promise(resolveResult => {
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=128', resolve(owned, 'controls.mjs'), ...(correctionOnly ? ['--group2-harness-correction'] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
  const state = { pid: child.pid, stdout: '', stderr: '', killed: false, events: [] };
  let bytes = 0;
  const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
  const timer = setTimeout(() => kill('exact child watchdog'), claim.watchdogMs);
  for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream.on('data', chunk => { bytes += chunk.length; if (bytes > claim.outputCap) kill('output cap'); else state[name] += chunk; });
    stream.on('close', () => state.events.push(`${name}-close`));
  }
  child.on('error', error => { state.spawnError = String(error); });
  child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
  child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ ...state, code, signal }); });
});
let result;
try { result = JSON.parse(childResult.stdout); } catch {}
await writeFile(resolve(owned, correctionOnly ? 'results-group2-correction.json' : 'results.json'), JSON.stringify({ claim, child: childResult, result }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ groups: result?.groups, passed: result?.passed, code: childResult.code, killed: childResult.killed, originalPreserved: result?.observations.find(observation => observation.details?.original)?.details.original }));
if (childResult.code !== 0 || childResult.killed || !result?.pass) process.exitCode = 1;
