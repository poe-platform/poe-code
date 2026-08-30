import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { owned, save, sha256 } from './support.mjs';
import { registryTruth } from './review-checks.mjs';

const inputs = JSON.parse(await readFile(resolve(owned, 'inputs.json')));
const native = JSON.parse(await readFile(resolve(owned, 'native-role-corrected.json')));
const baseline = JSON.parse(await readFile(resolve(owned, 'baseline-6e3e316.json')));
const summaries = [];
for (const context of ['original', 'canonical']) for (const cohort of ['discovery', 'differential', 'syntax', 'gaps', 'closure', 'control']) for (const profile of ['gnu53', 'apple32']) {
  const rows = baseline.records.filter(row => row.context === context && row.cohort === cohort);
  if (!rows.length) continue;
  const checks = rows.map(row => row.comparisons.find(comparison => comparison.profile === profile));
  summaries.push({ context, cohort, profile, denominator: rows.length, fullTupleExact: checks.filter(check => check.rawExact).length, streamsExact: checks.filter(check => check.streamsExact).length, originalFieldShape: checks.filter(check => check.originalFieldShape).length });
}
const stripModes = entries => Object.fromEntries(Object.entries(entries).map(([path, { mode, ...value }]) => [path, value]));
const routed = [];
for (const prior of inputs.routed) {
  let id, context, profile;
  if (prior.classification === 'historical-bash32-profile') { id = prior.name.replace('historical-3.2/', 'discovery/'); context = 'canonical'; profile = 'apple32'; }
  else if (prior.classification === 'registered-command-label') { id = prior.name.replace('closure primary: ', 'closure/'); context = 'canonical'; profile = 'gnu53'; }
  else { id = `${prior.path.includes('current-gaps') ? 'gaps' : 'differential'}/${prior.name.split(': ')[1]}`; context = 'original'; profile = 'apple32'; }
  const current = baseline.records.find(row => row.context === context && row.id === id);
  assert.ok(current);
  const comparison = current.comparisons.find(comparison => comparison.profile === profile);
  assert.equal(comparison.originalFieldShape, false);
  const entry = { originalName: prior.name, id, context, profile, valid: current.valid, currentMatchesOriginalComparedFields: comparison.originalFieldShape, current: current.result.actual, native: comparison.expected };
  if (prior.classification === 'bash-native-profile') {
    const old = label => JSON.parse(prior.originalObserved.detail.split('\n').find(line => line.startsWith(`    ${label}: `)).slice(label.length + 6));
    const historical = old('Bash'), virtual = old('virtual');
    const shape = tuple => ({ stdoutBase64: tuple.stdout, stderrBase64: tuple.stderr, exitCode: tuple.status, files: stripModes(tuple.effects) });
    const select = tuple => ({ stdoutBase64: tuple.stdoutBase64, stderrBase64: tuple.stderrBase64, exitCode: tuple.exitCode, files: tuple.files });
    entry.originalNativeReproduced = isDeepStrictEqual(shape(comparison.expected), select(historical));
    entry.originalVirtualReproduced = isDeepStrictEqual(shape(current.result.actual), select(virtual));
    assert.ok(entry.originalNativeReproduced); assert.ok(entry.originalVirtualReproduced);
  }
  routed.push(entry);
}
const discrepancies = baseline.records.filter(row => row.context === 'canonical' && !row.comparisons[0].originalFieldShape && !['closure/query-V-verbose', 'closure/type-multiple-status', 'control/registry-truth'].includes(row.id)).map(row => ({ id: row.id, current: row.result.actual, expectedGNU: row.comparisons[0].expected, source: inputs.rows.find(specimen => specimen.id === row.id).source, original: baseline.records.find(candidate => candidate.context === 'original' && candidate.id === row.id).result.actual }));
const classification = baseline.records.filter(row => row.context === 'canonical' && ['closure/query-V-verbose', 'closure/type-multiple-status', 'control/registry-truth'].includes(row.id)).map(row => ({ id: row.id, nativeRawMatch: row.comparisons[0].streamsExact, safePluginMatch: registryTruth(row.id, row.result.launch.cwd, row.result.actual, row.result.registry), actualRegistry: row.result.registry }));
save('review-summary.json', { capturedAt: new Date().toISOString(), baselineSha256: sha256(await readFile(resolve(owned, 'baseline-6e3e316.json'))), nativeSha256: sha256(await readFile(resolve(owned, 'native-role-corrected.json'))), summaries, routed, classification, discrepancies, originalSyntaxAssertionResults: baseline.records.filter(row => row.cohort === 'syntax' && row.context === 'original').map(row => ({ id: row.id, pass: row.result.actual.status === 2 && row.result.actual.stdout === '' && row.result.actual.stderr !== '' && Object.keys(row.result.actual.effects).length === 0 })), warning: 'Preparation only; no candidate inspected or accepted. OriginalFieldShape is the old compared field set, not extra-mode parity. Discovery/closure witnesses use the explicit canonical named wrapper, while the nine diagnostic witnesses replay the original direct API context.' });
console.log(JSON.stringify({ routedHistoricalLossesReproduced: routed.length, oldNineStrictNativeAndVirtualRecordsReproduced: routed.filter(row => row.originalNativeReproduced && row.originalVirtualReproduced).length, canonicalStatusDiscrepancies: discrepancies.map(row => row.id), safePluginControls: classification.filter(row => row.safePluginMatch).length }));
