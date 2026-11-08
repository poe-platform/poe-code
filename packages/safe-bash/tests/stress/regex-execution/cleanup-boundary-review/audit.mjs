import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const label = process.argv[2];
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '')) throw new Error('snapshot label required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const manifest = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`)));
const build = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-build.json`)));
const mismatches = [];
for (const entry of [...manifest.identities, ...build.emitted]) {
  if (hash(await readFile(resolve(owned, '.temporary', label, entry.path))) !== entry.sha256) mismatches.push(entry.path);
}
for (const entry of manifest.identities) if (hash(git('show', `${entry.commit ?? manifest.commit}:${entry.path}`)) !== entry.sha256) mismatches.push(`git:${entry.path}`);
for (const entry of [...manifest.historical, ...manifest.contract]) {
  if (hash(git('show', `${entry.commit}:${entry.path}`)) !== entry.sha256) mismatches.push(`historical:${entry.path}`);
}
for (const entry of manifest.historical) if (hash(await readFile(entry.path)) !== entry.sha256) mismatches.push(`historical-worktree:${entry.path}`);
const baseline = JSON.parse(await readFile(resolve(owned, 'evidence/baseline-freeze.json')));
const baselinePaths = new Map(baseline.identities.map(entry => [entry.path, entry.sha256]));
const differences = manifest.identities.filter(entry => baselinePaths.get(entry.path) !== entry.sha256).map(entry => entry.path);
const rootPaths = ['src/index.ts', 'src/plugins/index.ts', 'package.json'];
const rootDelta = rootPaths.filter(path => differences.includes(path));
const regexSource = ['src/commands/grep.ts', 'src/commands/search/rg.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/README.md'];
if (manifest.mode === 'registration-overlay') assert.ok(differences.every(path => regexSource.includes(path)), 'registration overlay must not consume unhanded-off runtime');
const protocol = 'src/commands/regex-execution/protocol.ts';
const prior = JSON.parse(await readFile('tests/stress/regex-execution/production-continuation-review/evidence/candidate-freeze.json'));
const baselineMatchesPriorRegex = ['src/commands/regex-execution/client.ts', protocol, 'src/commands/grep.ts', 'src/commands/search/rg.ts'].every(path => baselinePaths.get(path) === prior.identities.find(entry => entry.path === path)?.sha256);
const output = { label, sourceCommit: manifest.commit, time: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, sourceFiles: manifest.identities.length, emittedFiles: build.emitted.length, approvedContractAndHistorical: manifest.contract.length + manifest.historical.length, differences, rootDelta, baselineMatchesPriorRegex, unchangedDefaultPolicy: baselinePaths.get(protocol) === manifest.identities.find(entry => entry.path === protocol)?.sha256, mismatches, riskConsumed: 0, additionalSix: 'UNUSED', defaultAcceptance: false };
await writeFile(resolve(owned, 'evidence', `${label}-audit.json`), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(output));
if (mismatches.length) process.exitCode = 1;
