import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, candidate, frozen, repository, sha } from './review.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const boundary = JSON.parse(readFileSync(join(frozen, 'boundary.json')));
const source = readFileSync(join(candidate, base, 'candidate-profile-73/public.mjs'), 'utf8');
const assertions = source.slice(source.indexOf('const expected = '), source.indexOf('for (const name of ["tac"'));
const check = new Function('assert', 'names', assertions);
const definitions = JSON.parse(readFileSync(join(frozen, 'cases.json'))).cases.filter(row => row.group === 'defaults');
const results = definitions.map(definition => {
  const names = [...boundary.defaultNames];
  if (definition.id === 'defaults-old70') names.splice(70);
  if (boundary.excludedDefaults.some(name => definition.id === 'defaults-' + name)) names[0] = definition.id.slice('defaults-'.length);
  const frozenInput = [...names]; let accepted = true, rejection;
  try { check(assert, [...names].sort()); } catch (error) { accepted = false; rejection = String(error.stack); }
  assert.equal(accepted, definition.expected === 'accept');
  return { ...definition, status: 'PASS', observed: accepted ? 'accept' : 'reject', frozenInput, suppliedSortedNames: [...names].sort(), rejection, target: base + 'candidate-profile-73/public.mjs#exact-name-assertions', method: 'exact-frozen-mutations-through-candidate-assertions' };
});
assert.equal(sha(readFileSync(join(candidate, base, 'candidate-profile-73/public.mjs'))), sha(source));
const previousManifestBytes = readFileSync(join(owned, 'MANIFEST.json'), 'utf8');
const previousManifest = JSON.parse(previousManifestBytes);
const supplement = { at: new Date().toISOString(), scope: 'Exact frozen default mutation positions: truncate at70; replace index0. Initial different-position mutants remain additional controls in RAW, not substitutes for these exact cases.', sourceSha256: sha(source), assertionSha256: sha(assertions), assertions, frozenCasesSha256: sha(readFileSync(join(frozen, 'cases.json'))), results, previousManifestSha256: sha(previousManifestBytes), previousManifest };
const matrixBefore = readFileSync(join(owned, 'CASE_MATRIX.json'), 'utf8'), matrix = JSON.parse(matrixBefore);
for (const row of matrix.results.filter(row => row.group === 'defaults')) { row.priorRawReceipt = row.rawReceipt; row.rawReceipt = 'DEFAULTS_SUPPLEMENT.json#' + row.id; row.method = 'exact-frozen-mutations-through-candidate-assertions'; }
const matrixAfter = JSON.stringify(matrix, null, 2) + '\n', supplementBytes = JSON.stringify(supplement, null, 2) + '\n';
const manifest = { ...previousManifest, exactDefaultsSupplement: true, files: Object.fromEntries(readdirSync(owned).filter(path => path !== 'MANIFEST.json').map(path => { const bytes = path === 'CASE_MATRIX.json' ? Buffer.from(matrixAfter) : readFileSync(join(owned, path)); return [path, { sha256: sha(bytes), bytes: bytes.length, mode: lstatSync(join(owned, path)).mode & 0o777 }]; })) };
manifest.files['DEFAULTS_SUPPLEMENT.json'] = { sha256: sha(supplementBytes), bytes: Buffer.byteLength(supplementBytes), mode: 0o644 };
const replace = (name, before, after) => `*** Update File: ${relative(repository, join(owned, name))}\n@@\n` + before.trimEnd().split('\n').map(line => '-' + line).join('\n') + '\n' + after.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n';
const patch = '*** Begin Patch\n*** Add File: ' + relative(repository, join(owned, 'DEFAULTS_SUPPLEMENT.json')) + '\n' + supplementBytes.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n' + replace('CASE_MATRIX.json', matrixBefore, matrixAfter) + replace('MANIFEST.json', previousManifestBytes, JSON.stringify(manifest, null, 2) + '\n') + '*** End Patch\n';
const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr); console.log(applied.stdout); console.log(JSON.stringify({ exactFrozenDefaultCases: results.length, passed: results.length, originalVariantsPreserved: true }));
