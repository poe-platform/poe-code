import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { posix, resolve } from 'node:path';
import { emitReport, regularBytes, repo, same, sha256 } from './offline.mjs';

const definitions = {
  original: { harness: '0294afb6e690433aed994868e5ed437ecf58ae48', evidence: '8e09db96b51248137648cd5fd6093e4bc08f2b59', path: 'benchmarks/reports/expanded-20260827/native-corrected/native.json' },
  'scratch-aligned': { harness: 'd1b10a375a13f031f9f604a64395cd507f21a071', evidence: 'd1b10a375a13f031f9f604a64395cd507f21a071', path: 'benchmarks/reports/expanded-20260827/native-scratch-aligned/native.json' },
};
const gitBlob = (revision, path) => execFileSync('git', ['show', `${revision}:${path}`], { cwd: repo, timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
const textAt = (revision, name) => gitBlob(revision, `benchmarks/expanded/${name}`).toString('utf8');
const report = { schema: 1, kind: 'STATIC_GIT_JSON_PROFILE_AUDIT', createdAt: new Date().toISOString(), productExecutions: 0, definitions, profiles: {}, differences: [] };

function differences(before, after, path = '$') {
  if (same(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => differences(before[key], after[key], `${path}/${key}`));
  }
  return [{ path, before: before ?? null, after: after ?? null, beforePresent: before !== undefined, afterPresent: after !== undefined }];
}

try {
  assert.ok(process.argv.length === 2 || process.argv.length === 4 && process.argv[2] === '--out');
  const goldens = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const blob = gitBlob(definition.evidence, definition.path);
    assert.equal(sha256(await regularBytes(resolve(repo, definition.path))), sha256(blob), `historical artifact drift: ${name}`);
    const golden = JSON.parse(blob);
    goldens[name] = golden;
    assert.equal(golden.recipeCount, 224);
    assert.equal(golden.performanceCount, 4);
    assert.equal(golden.observations.length, 228);
    assert.equal(new Set(golden.observations.map(row => row.id)).size, 228);
    assert.equal(golden.invalidCount, 0);
    const sourceChecks = Object.entries(golden.sourceHashes).map(([file, expected]) => {
      const actual = sha256(gitBlob(definition.harness, `benchmarks/expanded/${file}`));
      assert.equal(actual, expected, `historically versioned source mismatch: ${name}/${file}`);
      return { file, sha256: actual };
    });
    for (const recipe of [...golden.recipes, ...golden.performanceRecipes]) assert.equal(golden.observations.find(row => row.id === recipe.id)?.recipeHash, sha256(JSON.stringify(recipe)));
    const tests = textAt(definition.harness, 'harness.test.mjs');
    const requiredFixtures = [...new Set([...tests.matchAll(/new URL\("([^"\n]+\.json)"/gu)].map(match => posix.normalize(posix.join('benchmarks/expanded', match[1]))))];
    const fixtureChecks = requiredFixtures.map(path => ({ path, sha256: sha256(gitBlob(definition.evidence, path)), availableAtHarnessRevision: sha256(gitBlob(definition.harness, path)) }));
    for (const fixture of fixtureChecks) assert.equal(fixture.sha256, fixture.availableAtHarnessRevision);
    const harnessPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', definition.harness, '--', 'benchmarks/expanded'], { cwd: repo, timeout: 10000, encoding: 'utf8' }).trim().split('\n');
    const harnessFiles = Object.fromEntries(harnessPaths.map(path => [path, sha256(gitBlob(definition.harness, path))]));
    report.profiles[name] = { goldenSha256: sha256(blob), harnessFiles, sourceChecks, requiredFixtures: fixtureChecks, testSourceSha256: sha256(tests), testNames: [...tests.matchAll(/test\("([^"]+)"/gu)].map(match => match[1]) };
  }
  const before = goldens.original;
  const after = goldens['scratch-aligned'];
  report.differences = differences(before, after);
  const changedTopKeys = Object.keys(before).filter(key => !same(before[key], after[key]));
  assert.deepEqual(changedTopKeys.sort(), ['createdAt', 'observations', 'projections', 'sourceHashes'].sort());
  assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort());
  for (const key of ['recipes', 'performanceRecipes', 'toolIdentities', 'primaryProfile']) assert.deepEqual(after[key], before[key]);
  const changedRows = [];
  for (const [index, row] of after.observations.entries()) {
    const original = before.observations[index];
    assert.equal(row.id, original.id);
    const { entries: previousEntries, ...previousFields } = original;
    const { entries: currentEntries, ...currentFields } = row;
    assert.deepEqual(currentFields, previousFields, `non-entry golden delta: ${row.id}`);
    if (!same(previousEntries, currentEntries)) changedRows.push(row.id);
  }
  assert.deepEqual(changedRows, ['command/patch/dry-run']);
  const previous = before.observations.find(row => row.id === changedRows[0]);
  const current = after.observations.find(row => row.id === changedRows[0]);
  const { tmp, ...retained } = previous.entries;
  assert.deepEqual(tmp, { type: 'directory' });
  assert.deepEqual(current.entries, retained);
  const oldCommon = textAt(definitions.original.harness, 'common.mjs');
  const newCommon = textAt(definitions['scratch-aligned'].harness, 'common.mjs');
  const comparator = text => text.slice(text.indexOf('export function compare('), text.indexOf('export function bytesEvidence('));
  assert.ok(comparator(oldCommon));
  assert.equal(comparator(oldCommon), comparator(newCommon));
  const oldEngine = textAt(definitions.original.harness, 'engine.mjs');
  const newEngine = textAt(definitions['scratch-aligned'].harness, 'engine.mjs');
  assert.equal(newEngine, oldEngine.replace('  await fs.mkdir(fixtureRoot,', '  await fs.mkdir("/tmp", { recursive: true });\n  await fs.mkdir(fixtureRoot,'));
  for (const name of ['recipes.mjs', 'session.mjs', 'inventory.mjs', 'server.mjs', 'transport.mjs']) assert.equal(textAt(definitions.original.harness, name), textAt(definitions['scratch-aligned'].harness, name), `unexpected semantic module change: ${name}`);
  report.assertionReview = {
    comparatorUnchanged: true, engineDeltaOnlyPrecreatedScratch: true, unchangedModules: ['recipes.mjs', 'session.mjs', 'inventory.mjs', 'server.mjs', 'transport.mjs'],
    replacement: 'Historical corrected-source-to-CURRENT-harness check removed; this verifier checks old hashes against0294afb and aligned hashes againstd1b10a3. New test retains recipe/output/status assertions and requires exactly one empty tmp-directory delta. Required native-first/native-corrected/aligned fixtures verified from git without running tests.',
    patchSha256: sha256(execFileSync('git', ['diff', definitions.original.harness, definitions['scratch-aligned'].harness, '--', 'benchmarks/expanded/harness.test.mjs'], { cwd: repo, timeout: 10000 })),
  };
  report.result = 'PASS_STATIC_PROFILE_DELTA_ONLY';
} catch (error) {
  report.result = 'FAIL_STATIC_PROFILE_AUDIT';
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
}
await emitReport(report, process.argv[2] === '--out' ? process.argv[3] : undefined);
