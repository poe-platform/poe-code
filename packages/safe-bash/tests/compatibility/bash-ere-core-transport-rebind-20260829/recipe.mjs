import assert from 'node:assert/strict';

export const OVERLAY_PATHS = Object.freeze(['src/commands/regex-execution/ere/transport/owner.ts', 'src/commands/regex-execution/ere/transport/root.ts']);

export function validateComposition(manifest, baseline) {
  assert.equal(manifest.sourceCount, 305);
  assert.equal(manifest.sources.length, 305);
  assert.equal(baseline.sources.length, 305);
  assert.equal(manifest.baseDerivedTree, 'da4e1cc187022255521879b00db2ac77674f79d9');
  const originals = new Map(baseline.sources.map(row => [row.path, row]));
  const seen = new Set();
  let changes = 0;
  for (const row of manifest.sources) {
    assert(!seen.has(row.path) && originals.has(row.path)); seen.add(row.path);
    assert.equal(row.mode, originals.get(row.path).mode);
    if (OVERLAY_PATHS.includes(row.path)) {
      assert.equal(row.revision, '4abbdeec8e34de88ed2cf7bd32be9c06b413c631');
      assert.notEqual(row.blob, originals.get(row.path).blob); changes++;
    } else for (const key of ['blob', 'bytes', 'sha256']) assert.equal(row[key], originals.get(row.path)[key]);
  }
  assert.equal(changes, 2);
  return { inputs: 305, changed: 2, unchanged: 303 };
}

export function fullEmitDelta(before, after) {
  const original = new Map(before.filter(row => row.path.startsWith('dist/')).map(row => [row.path, row]));
  const current = new Map(after.filter(row => row.path.startsWith('dist/')).map(row => [row.path, row]));
  const names = [...new Set([...original.keys(), ...current.keys()])].sort();
  return names.map(name => {
    const old = original.get(name), next = current.get(name);
    return { path: name, kind: name.endsWith('.d.ts.map') ? 'declaration-map' : name.endsWith('.d.ts') ? 'declaration' : name.endsWith('.map') ? 'source-map' : 'javascript-or-other', status: !old ? 'added' : !next ? 'removed' : old.sha256 === next.sha256 && (old.bytes ?? old.size) === (next.bytes ?? next.size) ? 'unchanged' : 'changed', before: old ?? null, after: next ?? null };
  });
}

export function recomputeLogicalBound({ freshLayoutBytes, archiveBytes, retainedLayoutBytes = 21431144 }) {
  for (const value of [freshLayoutBytes, archiveBytes, retainedLayoutBytes]) assert(Number.isSafeInteger(value) && value >= 0);
  const components = { retainedAndFreshLayoutCopies: retainedLayoutBytes + freshLayoutBytes + 1048576, uniqueCellEvents: 210 * 262144, uniqueCellPipesIncludingFinalAudits: 210 * 262144, coordinatorCapture: 8388608, administrativeToolCaptures: 8388608, publicationTails: 4194304, generatedBindingsManifestsMetadata: 16777216, onePublicationCopyOfAllCaptures: 131072000, archivedPackage: archiveBytes, extraMetadataReserve: 8388608 };
  const logicalBytes = Object.values(components).reduce((sum, value) => sum + value, 0);
  assert(logicalBytes <= 536870912);
  return { components, logicalBytes, uniqueCaptureBytes: 131072000, conditional: true, excludes: ['Git internal physical storage', 'allocated disk blocks', 'RSS'] };
}
