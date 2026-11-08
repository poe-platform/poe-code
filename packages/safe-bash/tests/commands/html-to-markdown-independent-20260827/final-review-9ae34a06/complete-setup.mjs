import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, toolInventory } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2]), state = read(join(capture, 'PRE-RUN.json'));
assert(!existsSync(join(capture, 'state.json')));
save(join(capture, 'MAP-COMPARISON-PRE.json'), { at: new Date().toISOString(), driver: hash(readFileSync(new URL(import.meta.url))), supervisor: hash(readFileSync(join(own, 'common.mjs'))), originalSetup: hash(readFileSync(join(own, 'setup.mjs'))), inputs: hash(readFileSync(join(capture, 'PRE-RUN.json'))), limitation: 'Original exact-map comparison failed after successful compile/install. No process is retried. Complete setup only after checking all JS/declaration bytes and every map field except explicitly recorded source-location prefixes.' });
for (const phase of ['compile', 'pack', 'install']) assert.equal(read(join(capture, 'setup', phase + '.receipt.json')).outcome, 'PASS');
for (const [path, digest] of Object.entries(state.sourceBefore)) assert.equal(hash(readFileSync(join(state.build, path))), digest);
for (const [name, digest] of Object.entries(state.scriptsBefore)) assert.equal(hash(readFileSync(join(own, name))), digest);
for (const name of ['typescript', '@types/node', 'undici-types']) assert.deepEqual(inventory(join(state.tools, 'node_modules', name)), state.toolchain[name].files);
assert.deepEqual(toolInventory(state.npmRoot), state.toolchain.npm.files);
assert.equal(hash(readFileSync(process.execPath)), state.toolchain.node.sha256);
assert.equal(hash(readFileSync(state.pandoc)), state.toolchain.pandoc.sha256);
state.compilerInputs = {};
for (const path of readFileSync(join(capture, 'setup/compile.stdout'), 'utf8').trim().split('\n')) { assert(path.startsWith(state.build + '/') || path.startsWith(state.tools + '/')); state.compilerInputs[path] = hash(readFileSync(path)); }
state.installed = join(state.consumer, 'node_modules/virtual-bash');
state.installedBefore = inventory(state.installed); state.emittedBefore = inventory(join(state.build, 'dist'));
const installedDist = inventory(join(state.installed, 'dist'));
assert.deepEqual(Object.keys(installedDist), Object.keys(state.emittedBefore));
const differences = [];
for (const [path, digest] of Object.entries(state.emittedBefore)) {
  if (installedDist[path] === digest) continue;
  assert(path.endsWith('.map'));
  const original = read(join(state.build, 'dist', path)), moved = read(join(state.installed, 'dist', path));
  const normalize = map => ({ ...map, sources: map.sources.map(source => { assert(source.includes('/src/')); return source.slice(source.indexOf('/src/') + 1); }) });
  assert.deepEqual(normalize(original), normalize(moved));
  differences.push({ path, isolatedSHA256: digest, movedSHA256: installedDist[path], isolatedSources: original.sources, movedSources: moved.sources });
}
state.mapComparison = { identicalCodeAndDeclarations: 72, mapsWithOnlySourceLocationDifference: differences };
assert.equal(differences.length, 72);
state.pack = read(join(capture, 'setup/pack.stdout'));
state.independentPackSHA256 = hash(readFileSync(join(state.build, state.pack[0].filename)));
state.packSHA256 = state.suppliedPackSHA256;
assert.equal(hash(readFileSync(join(capture, 'supplied-package.tgz'))), state.packSHA256);
assert.equal(Object.keys(read(join(state.installed, 'package.json')).dependencies ?? {}).length, 0);
state.isolated = join(state.work, 'retired-build'); renameSync(state.build, state.isolated);
state.isolatedBefore = inventory(state.isolated);
mkdirSync(join(state.build, 'src/commands/html-to-markdown'), { recursive: true });
state.poisonedSource = join(state.build, 'src/commands/html-to-markdown/index.ts'); writeFileSync(state.poisonedSource, 'throw new Error("POISONED_RETIRED_SOURCE_MUST_NOT_LOAD");\n');
writeFileSync(join(state.build, 'package.json'), '{"type":"module"}\n');
state.legacyBefore = inventory(state.legacy); state.authorBefore = inventory(state.author);
state.setupCompleted = new Date().toISOString(); save(join(capture, 'state.json'), state);
cpSync(join(own, 'node_modules/setup-run02.log'), join(capture, 'setup-original-failure.log'));
console.log(JSON.stringify({ source: state.source, sourceFiles: state.productSourceFiles, identicalCodeAndDeclarations: 72, locationOnlyMaps: differences.length, actualSuppliedPack: state.packSHA256, independentPack: state.independentPackSHA256 }));
