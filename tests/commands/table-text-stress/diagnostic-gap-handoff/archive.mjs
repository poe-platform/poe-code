import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const owned = 'tests/commands/table-text-stress/diagnostic-gap-handoff';
export const review = 'tests/commands/table-text-stress/shared-stdin-review';
export const fix = 'tests/commands/table-text-stress/shared-stdin-fix';
export const targets = ['tests/commands/table-text-stress/corpus.test.ts', 'tests/commands/table-text/differential.test.ts'];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = path => readFileSync(resolve(root, path));
export const json = path => JSON.parse(read(path));
export function save(path, value) {
  assert.ok(path.startsWith(owned + '/'));
  assert.ok(!existsSync(resolve(root, path)), `Refusing evidence overwrite: ${path}`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  assert.ok(text.endsWith('\n'));
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(sha(read(path)), sha(text));
}
export function hashes(paths) {
  return Object.fromEntries([...paths].sort().map(path => [path, existsSync(resolve(root, path)) ? sha(read(path)) : null]));
}
export const drift = (before, after) => Object.keys(before).filter(path => before[path] !== after[path]).map(path => ({ path, before: before[path], after: after[path] }));

function archive() {
  const snapshot = json(`${review}/snapshot-manifest.json`);
  const results = json(`${review}/results.json`);
  const author = json(`${fix}/post-fix.json`);
  const native = json(`${review}/native216.json`);
  const replay = json(`${review}/logs/selected-gnu216.stdout`);
  const expected = json('tests/commands/table-text/gnu-evidence.json');
  assert.equal(replay.total, 216);
  assert.equal(replay.exactPass, 195);
  assert.equal(native.exact, 216);
  assert.equal(author.author.length, 216);
  const provenancePaths = [
    `${review}/snapshot-manifest.json`, `${review}/results.json`, `${review}/first-pass.json`,
    `${review}/dependency-audit.json`, `${review}/source-audit.json`, `${review}/native216.json`,
    `${review}/selected-gnu.ts`, `${review}/native.ts`, `${review}/corrected-alias.mjs`,
    `${review}/logs/selected-gnu216.stdout`, `${review}/logs/built-selected71x2.stdout`,
    `${review}/logs/corrected-original104.stdout`, `${review}/logs/corrected-original311-current-helper.stdout`,
    `${fix}/post-fix.json`, `${fix}/initial-red.json`, `${fix}/support.ts`, `${fix}/replay.ts`,
    'tests/commands/table-text/gnu-evidence.json', 'tests/commands/table-text/cases.ts',
    'tests/commands/table-text/helpers.ts', 'tests/commands/table-text/oracle.ts',
    'tests/commands/table-text-stress/frozen-corpus.json', 'tests/commands/table-text-stress/support.ts',
  ];
  const originals = targets.map((path, index) => {
    const archivePath = `${owned}/originals/${index === 0 ? 'corpus.test.ts' : 'differential.test.ts'}.txt`;
    save(archivePath, read(path).toString());
    return { path, archivePath, sha256: sha(read(path)) };
  });
  const descriptions = {
    38: 'Same missing operand, but errno/stat context, virtual absolute path and wording/case differ; not just argv0.',
    39: 'Same missing operand, but errno/stat context, virtual absolute path and wording/case differ; not just argv0.',
    40: 'Extra EINVAL plus ends in versus ends with wording and missing literal backslash context.',
    41: 'Native full-path argv0 AND unsupported versus unrecognized option, quoting and absent help line; not argv0-only.',
    73: 'Native adds a second input-is-not-in-sorted-order summary line absent from actual.',
    81: 'Same missing operand, but errno/stat context, virtual absolute path and wording/case differ; not just argv0.',
    82: 'Actual generic two-file requirement versus native missing-operand-after-left detail and help line.',
    119: 'Actual ordinal file1 disorder versus native operand name, line2 and offending record a A; context and wording differ.',
    120: 'Actual ordinal file1 disorder versus native operand name, line3 and offending record b B; context and wording differ.',
    121: 'Actual ordinal file1 disorder versus native operand name, line2 and offending record a A; context and wording differ.',
    125: 'Extra EINVAL, field versus field number wording and missing quotes around 0.',
    126: 'Invalid output field versus invalid file number in field spec; field/file distinction and quoting differ.',
    127: 'Generic one-byte/C-locale requirement versus native multi-character-tab diagnostic naming ::.',
    128: 'Extra EINVAL and absent single quotes around left; not prefix-only.',
    129: 'Native full-path argv0 AND unsupported versus unrecognized option, quoting and absent help line; not argv0-only.',
    207: 'Extra EINVAL plus field delimiters versus tabs wording.',
    213: 'Extra EINVAL plus multiple conflicting output delimiters versus multiple output delimiters specified wording.',
  };
  const repros = [];
  for (const [index, observation] of replay.observations.entries()) {
    const row = author.author[index];
    const oracle = expected.observations[index];
    assert.equal(row.fixtureSha256, sha(JSON.stringify(row.fixture)));
    assert.equal(observation.inputSha256, row.fixtureSha256);
    assert.deepEqual(row.expected, oracle);
    assert.deepEqual(native.observations[index], oracle);
    const outputs = value => ({ exitCode: value.exitCode, stdoutHex: value.stdoutHex, stderrHex: value.stderrHex });
    assert.deepEqual(observation.actual, outputs(row.actual));
    assert.deepEqual(outputs(row.native), outputs(oracle));
    if (observation.exact) continue;
    assert.equal(observation.selected, true);
    assert.equal(observation.actual.exitCode, oracle.exitCode);
    assert.equal(observation.actual.stdoutHex, oracle.stdoutHex);
    assert.equal(observation.filesUnchanged, true);
    assert.deepEqual(row.actual.files, row.fixture.files);
    assert.deepEqual(row.native.files, row.fixture.files);
    const actualText = Buffer.from(observation.actual.stderrHex, 'hex').toString();
    const expectedText = Buffer.from(oracle.stderrHex, 'hex').toString();
    const prefix = `${row.fixture.command}: EINVAL: `;
    const prefixOnly = actualText.startsWith(prefix) && actualText.replace(prefix, `${row.fixture.command}: `) === expectedText;
    assert.ok(prefixOnly || descriptions[index]);
    repros.push({
      index, name: row.fixture.name, inputSha256: row.fixtureSha256, fixture: row.fixture,
      setup: { productCwd: '/work', environment: { LC_ALL: 'C' }, filesHex: row.fixture.files, stdinHex: row.fixture.stdinHex, chunkBytes: 7, adapter: 'createMemoryFileSystem', driver: 'tests/commands/table-text/helpers.ts:runTable' },
      actual: { ...observation.actual, stdoutText: Buffer.from(observation.actual.stdoutHex, 'hex').toString(), stderrText: actualText },
      expected: { ...outputs(oracle), stdoutText: Buffer.from(oracle.stdoutHex, 'hex').toString(), stderrText: expectedText },
      effects: { actualFilesHex: row.actual.files, nativeFilesHex: row.native.files, reviewerFilesAndNamespaceUnchanged: observation.filesUnchanged, source: `${fix}/post-fix.json#/author/${index}; ${review}/logs/selected-gnu216.stdout#/observations/${index}`, limitation: 'Captured fixture file bytes and /work namespace only; no uncaptured mode, inode, timestamps, external effects or cursor counts inferred.' },
      native: { profile: expected.target, executable: native.identities[row.fixture.command].binary, argv0: `${native.authorArgv0Directory}/${row.fixture.command}`, args: row.fixture.args, environment: { LC_ALL: 'C', PATH: '/usr/bin:/bin' }, identity: native.identities[row.fixture.command] },
      classification: { kind: prefixOnly ? 'errno-prefix-only' : 'other-text-or-context-difference', evidence: prefixOnly ? 'Removing exactly EINVAL: after the command prefix makes the full raw diagnostic byte-identical. No other change required.' : descriptions[index], waived: false, meaningEquivalenceClaimed: false },
    });
  }
  assert.equal(repros.length, 21);
  assert.equal(repros.filter(row => row.classification.kind === 'errno-prefix-only').length, 4);
  save(`${owned}/repros.json`, { schemaVersion: 1, historicalStrict: { pass: 195, total: 216, diagnosticDifferences: 21 }, classificationCounts: { errnoPrefixOnly: 4, otherTextOrContext: 17, argv0Only: 0 }, repros });
  const shared = author.author.find(row => row.fixture.name === 'comm: shared stdin');
  assert.equal(shared.fixture.stdinHex, '610a610a620a620a630a');
  assert.equal(shared.actual.stdoutHex, '0909610a0909620a630a');
  assert.equal(shared.actual.exitCode, 1);
  assert.equal(shared.actual.stderrHex, '636f6d6d3a202d3a204261642066696c652064657363726970746f720a');
  save(`${owned}/archive-manifest.json`, {
    at: new Date().toISOString(), originals, references: hashes(provenancePaths),
    acceptedCommits: ['6ef0d8d', '7e861c6', '8cb42b8'],
    historical: { strict216: { pass: 195, total: 216 }, selected216: { pass: 216, total: 216 }, builtExact: { pass: 134, total: 142 }, original104: { pass: 103, total: 104 }, original311: { pass: 310, total: 311 }, firstPassAndAliasAudit: 'Unchanged referenced files; not replayed or superseded.' },
    frozenRuntime: { snapshot: snapshot.snapshot, node: snapshot.node, sourceDigest: snapshot.sourceDigest, tableDigest: snapshot.tableDigest, tableHashes: snapshot.tableHashes, helperSha256: snapshot.helperSha256, dependencyHashes: Object.fromEntries(Object.entries(snapshot.manifest).filter(([path]) => path.startsWith('node_modules/') || path === 'package-lock.json' || path === 'package.json')) },
    native: { inputCorpusSha256: native.inputCorpusSha256, casesFileSha256: native.casesFileSha256, evidenceFileSha256: native.evidenceFileSha256, identities: native.identities, authorArgv0Directory: native.authorArgv0Directory, archiveSha256: native.archiveSha256, manualSha256: native.manualSha256, authorBinaryIdentities: author.originalAuthorBinaryIdentities, sourcePins: author.pins },
    originalDriverCommand: results.commands.find(command => command.name === 'corrected-selected-gnu216'),
    originalNativeDriver: { command: 'node --unhandled-rejections=strict --import tsx tests/commands/table-text-stress/shared-stdin-review/native.ts', reference: `${review}/preparation.json`, note: 'Historical original argv0 explicitly supplied; no fresh native capture or oracle edits in diagnostic extraction.' },
    shared, extractionCommand: `node ${owned}/archive.mjs`, reprosSha256: sha(read(`${owned}/repros.json`)),
    frozenRuntimeDataReused: true, newCases: 0, newNativeExecutionsForExtraction: 0,
  });
  console.log(JSON.stringify({ originals, repros: repros.length, prefixOnly: 4, other: 17 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) archive();
