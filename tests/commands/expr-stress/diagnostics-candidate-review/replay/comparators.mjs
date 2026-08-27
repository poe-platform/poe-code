import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { addEvidence, owned, root, originalCommit, originalBase, extensionCommit, extensionBase, git, sha256, verifyFrozen } from './review.mjs';
import { command } from './stage.mjs';

if (process.argv[2] !== 'capture') { verifyFrozen(); console.log('Read-only verification; explicit capture required.'); process.exit(0); }
const destination = `${owned}/frozen-comparators`;
assert(!existsSync(destination));
for (const [id, commit, base] of [['original95', originalCommit, originalBase], ['extension-original20', extensionCommit, extensionBase]]) {
  const bytes = git('show', `${commit}:${base}/runner.mjs.data`);
  const runner = `${destination}/${id}-runner.mjs`;
  addEvidence(runner, bytes.toString());
  const reportPath = `${owned}/acceptance-diagnostics/${id}-report.json`;
  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes);
  const projected = { ...report, profiles: report.profiles.filter(profile => profile.id.startsWith('gnu-')) };
  const inputPath = `${destination}/${id}-gnu-report.json`;
  addEvidence(inputPath, projected);
  const result = await command(process.execPath, [runner, 'compare', inputPath], root);
  addEvidence(`${destination}/${id}-comparison.json`, { source: `${commit}:${base}/runner.mjs.data`, sourceSha256: sha256(bytes), inputPath, derivedFromSha256: sha256(reportBytes), projection: 'GNU-only envelope required by unchanged frozen comparator. Every GNU row unchanged; Apple retained separately in source report.', ...result });
  assert.equal(result.status, 1);
  assert.equal(result.failure, null);
  assert.equal(result.signal, null);
  assert(JSON.parse(result.stdout).comparison.length === 2);
}
const stage = JSON.parse(readFileSync(`${owned}/candidate-diagnostics/stage.json`));
const path = 'tests/commands/grep-aliases/native.test.ts';
const result = await command(process.execPath, ['--import', 'tsx', '--test', path], stage.source);
addEvidence(`${destination}/opt-in-native-regressions.json`, { sourceCommit: stage.commit, path, sha256: sha256(readFileSync(join(stage.source, path))), configured: { GREP_ALIASES_NATIVE: process.env.GREP_ALIASES_NATIVE ?? null, GREP_ALIASES_GNU_NATIVE: process.env.GREP_ALIASES_GNU_NATIVE ?? null }, ...result, classification: 'Separate optional archived grep-alias native checks retain opt-in skips. They do not replace mandatory exact GNU expr native qualification.' });
assert.equal(result.status, 0);
verifyFrozen();
console.log(JSON.stringify({ originalComparator: 1, extensionComparator: 1, optionalNativeStatus: result.status, optionalSummary: result.stdout.slice(-220) }));
