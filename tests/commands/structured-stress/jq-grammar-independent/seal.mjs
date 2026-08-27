import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { git } from '../jq-42-independent-review/common.mjs';
import { loadEvidence, transports } from '../jq-42-independent-review/evidence.mjs';
import { addFile, artifact, directory, root, digest, newTransports } from './common.mjs';

assert.equal(existsSync(join(directory, 'manifest.json')), false, 'never reseal frozen evidence');
const acceptedEvidenceCommit = 'bb1ceabef3a3a4c3791af64d9efb7384f6ca773f';
const acceptedSourceCommit = '0278a3032d7851de4c2f5141bbc863cdf310c39d';
const acceptedStructuredSha256 = '30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f';
const historicalPaths = git(['ls-tree', '-r', '--name-only', acceptedEvidenceCommit, '--', 'tests/commands/structured', 'tests/commands/structured-stress']).toString().trim().split('\n');
const historicalFiles = Object.fromEntries(historicalPaths.map(path => {
  const bytes = readFileSync(join(root, path));
  assert.deepEqual(bytes, git(['show', `${acceptedEvidenceCommit}:${path}`]), `historical evidence changed: ${path}`);
  return [path, digest(bytes)];
}));
const base = 'tests/commands/structured-stress/';
const parse = path => JSON.parse(readFileSync(join(root, path)));
const native = parse(`${relative(root, directory)}/native-frozen.json`);
const main = loadEvidence();
const legacy = parse(`${base}jq-42-independent-review/legacy-native-proof.json`);
const legacyReport = parse(`${base}jq-42-independent-final/r2-legacy.json`);
const selector = parse(`${base}jq-42-independent-final/r1-selector.json`);
assert.equal(selector.failures.length, 22);
assert.deepEqual(legacyReport.summary.legacy, { exact: 45, diagnosticOnly: 43, statusOrStdout: 6, routeTransportAgreement: true });
const baselineRows = legacyReport.results.filter(row => row.route === 'direct' && row.transport === 'whole');
const canonicalFile = name => {
  if (name.startsWith('strict UTF-8 rejection')) return `${base}independent-increment/safety.test.ts`;
  if (name.startsWith('raw native:')) return `${base}raw-input.test.ts`;
  if (name.startsWith('malformed UTF-8 preserves')) return 'tests/commands/structured/cli.test.ts';
  if (name.startsWith('valid large decimals')) return 'tests/commands/structured/resources.test.ts';
  return `${base}safety.test.ts`;
};
artifact('canonical-red-inventory.json', {
  recordedAt: new Date().toISOString(), acceptedEvidenceCommit, acceptedSourceCommit, acceptedStructuredSha256,
  selectorPath: `${base}jq-42-independent-final/r1-selector.json`, selectorSha256: historicalFiles[`${base}jq-42-independent-final/r1-selector.json`],
  tapPath: selector.tapPath, tapSha256: selector.tapSha256, selector: selector.selector,
  historicalResultPath: `${base}jq-42-independent-final/r2-legacy-red.json`, historicalResult: { tests: 22, pass: 0, fail: 22 },
  proposalStatus: 'NOT PROVIDED / NOT REVIEWED. No canonical delta is approved. Preserve all historical fixtures and dated results.',
  entries: selector.failures.map(name => {
    const path = canonicalFile(name);
    const probes = legacy.probes.filter(probe => probe.assertion === name);
    assert.ok(probes.length, `no native evidence mapped for ${name}`);
    const rows = probes.map(probe => baselineRows.find(row => row.id === probe.id));
    assert.ok(rows.every(Boolean));
    const exact = rows.filter(row => row.pass).map(row => row.id);
    const diagnostic = rows.filter(row => !row.pass && row.differingFields.every(field => field === 'stderrHex')).map(row => row.id);
    const acceptance = rows.filter(row => row.differingFields.some(field => field !== 'stderrHex')).map(row => row.id);
    return { name, file: path, fileSha256: historicalFiles[path], nativeProbeIds: probes.map(probe => probe.id),
      baselineNativeExact: exact, baselineRealDiagnosticDifferences: diagnostic, baselineRealAcceptanceDifferences: acceptance,
      preliminaryClassification: diagnostic.length || acceptance.length
        ? 'MIXED: canonical expectation needs assertion-level native review, but real implementation differences also remain; never waive the whole test.'
        : 'Canonical red despite all mapped native probes matching: stale expectation candidate under this accepted native profile, not an approved test edit.',
      reviewRequirement: 'Compare every proposed assertion delta against immutable native status/stdout/stderr and preserve unaffected malformed-input, division-by-zero, prefix, binary and budget assertions.' };
  }),
});
const ownedFiles = Object.fromEntries(readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
  const path = join(directory, entry.name);
  return [relative(root, path), digest(readFileSync(path))];
}));
artifact('manifest.json', { recordedAt: new Date().toISOString(), phase: 'PREP ONLY; no new virtual outputs used',
  acceptedEvidenceCommit, acceptedSourceCommit, acceptedStructuredSha256, historicalFiles, ownedFiles,
  counts: {
    grammar: { vectors: native.cases.length, executions: native.cases.reduce((sum, vector) => sum + 2 * newTransports(vector).length, 0) },
    main: { vectors: main.vectors.length, executions: main.vectors.reduce((sum, vector) => sum + 2 * transports(vector).length, 0) },
    legacy: { vectors: legacy.probes.length, executions: legacy.probes.length * 4 },
  },
  baseline: { main: { vectors: 256, executions: 790, pass: 790 }, original42Included: { vectors: 42, executions: 84, pass: 84 },
    legacy: { vectors: 94, exact: 45, nonexact: 49, diagnosticOnly: 43, acceptance: 6, executions: 376, pass: 180 }, canonicalRed: 22 },
  nativeCaptureBeforeVirtualImport: true,
  limits: 'Frozen historical files must remain byte-identical; canonical proposals are reviewed separately before changes. No source approval, full parity, product closure, timing claim or superiority claim.' });
const manifestSha256 = digest(readFileSync(join(directory, 'manifest.json')));
addFile(join(directory, 'MANIFEST.sha256'), `${manifestSha256}  manifest.json\n`);
console.log(JSON.stringify({ manifestSha256, historicalFiles: historicalPaths.length, canonicalRed: selector.failures.length, nativeVectors: native.cases.length }));
