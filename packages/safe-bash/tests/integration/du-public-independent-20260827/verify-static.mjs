import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertReplayBindings, requiredBindingKeys } from './binding-contract.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));

function walk(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `no symlink: ${path}`);
    if (stat.isDirectory()) return walk(path);
    assert.ok(stat.isFile(), `regular file: ${path}`);
    return [relative(root, path).replaceAll('\\', '/')];
  });
}

const files = walk(root);
for (const file of files) {
  assert.ok(!/(^|\/)AGENTS\.md$/u.test(file), 'no copied instructions');
  assert.ok(!/\.(?:ts|mts|cts|tsx)$/u.test(file), 'no loose TypeScript');
  assert.ok(!/(^|\/)(?:node_modules|dist|\.cache|tmp|\.git)(\/|$)/u.test(file), 'no generated product/cache artifacts');
  assert.match(file, /\.(?:md|mjs|json|ts\.data)$/u, 'explicit fixture classification');
  if (file.endsWith('.json')) json(file);
  if (file.endsWith('.mjs')) {
    const check = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(check.status, 0, `${file}: ${check.stderr}`);
  }
}

const inventory = json('cases.json');
assert.equal(inventory.schemaVersion, 1);
assert.equal(inventory.cases.length, 29);
assert.equal(new Set(inventory.cases.map(entry => entry.id)).size, 29);
const categories = {};
const readiness = {};
for (const entry of inventory.cases) {
  assert.match(entry.id, /^[PTREL]\d{2}$/u);
  assert.ok(entry.assertion.length > 60);
  assert.ok(entry.requires.length > 0);
  assert.ok(files.includes(entry.fixture), entry.fixture);
  categories[entry.category] = (categories[entry.category] ?? 0) + 1;
  readiness[entry.readiness] = (readiness[entry.readiness] ?? 0) + 1;
}
assert.deepEqual(categories, { package: 6, types: 5, registration: 7, examples: 3, lifecycle: 8 });
assert.deepEqual(readiness, { callable: 8, 'blocked-spec': 17, 'staged-types': 4 });
const publicSource = readFileSync(join(root, 'public-cases.mjs'), 'utf8');
for (const entry of inventory.cases.filter(entry => entry.readiness === 'callable')) {
  assert.ok(publicSource.includes(`await run('${entry.id}',`), `missing callable ${entry.id}`);
}
assert.equal((publicSource.match(/await run\('/gu) ?? []).length, 8);
assert.ok(!publicSource.includes("from 'virtual-bash"), 'public modules supplied only by admitted supervisor');
assert.ok(!/\bimport\s*\(/u.test(publicSource), 'no implicit product import');

const template = json('bindings.template.json');
assert.equal(template.state, 'pre-public-candidate-freeze');
assert.deepEqual(Object.keys(template.required).sort(), [...requiredBindingKeys].sort());
assert.ok(Object.values(template.required).every(value => value === null));
assert.throws(() => assertReplayBindings(template), /freeze alone never authorizes execution/u);
const premature = structuredClone(template);
premature.state = 'root-authorized-public-replay';
assert.throws(() => assertReplayBindings(premature), /UNBOUND/u);

const controls = json('type-controls.json');
assert.equal(controls.controls.length, 4);
for (const control of controls.controls) {
  assert.equal(inventory.cases.find(entry => entry.id === control.case)?.fixture, control.file);
  const source = readFileSync(join(root, control.file), 'utf8');
  assert.ok(!/@ts-(?:ignore|expect-error|nocheck)|\bas any\b/u.test(source));
  for (const diagnostic of control.diagnostics) assert.ok(source.split('\n')[diagnostic.line - 1]?.length > 0);
}
assert.equal(Object.keys(json('lifecycle.json').requiredMappings).length, 8);
const provenance = json('inspection.json');
assert.equal(provenance.role, 'inspection-only; not candidate admission');
assert.equal(provenance.semanticCandidateExecutions, 0);
for (const source of provenance.files) {
  assert.match(source.liveSha256, /^[a-f0-9]{64}$/u);
  assert.match(source.liveGitBlob, /^[a-f0-9]{40}$/u);
  assert.equal(source.sameAsInspectionCommit, source.liveGitBlob === source.committedGitBlob);
}

const manifest = json('MANIFEST.json');
assert.deepEqual(manifest.excluded, ['MANIFEST.json']);
assert.equal(manifest.role, 'self-excluded immutable freeze bytes; not candidate evidence');
const selected = files.filter(file => file !== 'MANIFEST.json');
assert.deepEqual(manifest.files.map(entry => entry.path), selected, 'detect changed, removed AND new paths');
for (const entry of manifest.files) {
  const bytes = readFileSync(join(root, entry.path));
  assert.equal(entry.bytes, bytes.length, entry.path);
  assert.equal(entry.sha256, sha256(bytes), entry.path);
  assert.equal(entry.gitBlob, gitBlob(bytes), entry.path);
}
assert.equal(manifest.count, selected.length);
console.log(JSON.stringify({ kind: 'static-freeze-verification-only', cases: 29, categories, readiness, semanticCandidateExecutions: 0, public75Claimed: false, manifestCount: manifest.count, manifestSha256: sha256(readFileSync(join(root, 'MANIFEST.json'))) }, null, 2));
