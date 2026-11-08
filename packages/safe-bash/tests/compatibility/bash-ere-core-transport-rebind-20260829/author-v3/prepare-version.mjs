import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), parent = path.dirname(own), prior = path.join(parent, 'author-v2'), repo = path.resolve(parent, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename) { const stat = fs.lstatSync(filename); assert(stat.isFile() && stat.size <= 16777216); return fs.readFileSync(filename); }
const priorSeal = read(path.join(prior, 'PRESEAL.json'));
assert.equal(sha(priorSeal), 'c0ac00138f379f36a7fabb447ccda25a16788006942ee01f893b67088d3ca5c4');
for (const row of JSON.parse(priorSeal).files) assert.equal(sha(read(path.join(prior, row.path))), row.sha256);
const composition = JSON.parse(read(path.join(parent, 'COMPOSITION.json')));
const pins = new Map(composition.tools.typescript.map(row => [row.path, row]));
const rows = [], packages = [], directories = [];
const modulesRoot = path.join(own, 'type-tools/node_modules');
for (const packageName of ['@types/node', 'undici-types']) {
  const sourceRoot = path.join(repo, 'node_modules', packageName), targetRoot = path.join(modulesRoot, packageName);
  const metadata = JSON.parse(read(path.join(sourceRoot, 'package.json')));
  if (packageName === '@types/node') { assert.equal(metadata.version, '22.20.1'); assert.deepEqual(metadata.dependencies, { 'undici-types': '~6.21.0' }); }
  else { assert.equal(metadata.version, '6.21.0'); assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0); }
  assert(!Object.keys(metadata.peerDependencies ?? {}).length);
  packages.push({ name: packageName, version: metadata.version, dependencies: metadata.dependencies ?? {}, types: metadata.types, typesVersions: metadata.typesVersions ?? null, origin: sourceRoot, isolatedCopy: targetRoot });
  function walk(directory) {
    const relative = path.relative(sourceRoot, directory); directories.push(path.join(packageName, relative)); fs.mkdirSync(path.join(targetRoot, relative), { recursive: true });
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      if (stat.isDirectory()) walk(filename);
      else {
        const bytes = read(filename), pin = pins.get(filename), target = path.join(targetRoot, path.relative(sourceRoot, filename));
        assert(pin, 'original qualified type-tool pin missing: ' + filename); assert.equal(bytes.length, pin.size); assert.equal(sha(bytes), pin.sha256); assert.equal(stat.mode & 511, pin.mode);
        fs.writeFileSync(target, bytes, { flag: 'wx', mode: pin.mode });
        rows.push({ origin: filename, path: target, size: bytes.length, mode: pin.mode, sha256: pin.sha256, originalPinned: true });
      }
    }
  }
  walk(sourceRoot);
}
const typeManifest = { schema: 'CORE_TYPE_TOOL_CLOSURE_V3', provenance: 'Exact existing LOCAL bytes match original qualified composition.tools.typescript pins; newly isolated copies, not inherited runtime acceptance', packages, rows, directories, root: modulesRoot, typeRoots: path.join(modulesRoot, '@types'), compilerResolution: { commandFlag: '--typeRoots', explicitTypes: ['node'], nodeDeclarationPackage: path.join(modulesRoot, '@types/node/package.json'), declaredDependency: path.join(modulesRoot, 'undici-types/package.json'), sourceConfigurationUnchanged: true, strictnessUnchanged: true, ambientTypeRootNotUsed: true }, originalPins: { manifest: path.join(parent, 'COMPOSITION.json'), sha256: sha(read(path.join(parent, 'COMPOSITION.json'))) }, fileCount: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0) };
fs.writeFileSync(path.join(own, 'TYPE-TOOLS.json'), JSON.stringify(typeManifest, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
function replaceOnce(text, before, after) { assert.equal(text.split(before).length, 2, 'version anchor: ' + before); return text.replace(before, after); }
let producer = read(path.join(prior, 'producer.mjs')).toString();
producer = replaceOnce(producer, "from './contract.mjs'", "from '../author-v2/contract.mjs'");
producer = producer.replaceAll("path.join(own, 'CONTRACT-RESULT.json')", "path.join(parent, 'author-v2/CONTRACT-RESULT.json')");
producer = replaceOnce(producer, "['ROOT-DECISION.txt', 'contract.mjs', 'contract-controls.mjs', 'CONTRACT-RESULT.json', 'io.mjs', 'producer.mjs', 'bindings.mjs']", "['ROOT-DECISION.txt', 'TYPE-TOOLS.json', 'io.mjs', 'producer.mjs', 'bindings.mjs']");
producer = replaceOnce(producer, 'userConfig, globalConfig].map', "userConfig, globalConfig, path.join(parent, 'author-v2/contract.mjs'), path.join(parent, 'author-v2/contract-controls.mjs'), path.join(parent, 'author-v2/CONTRACT-RESULT.json')].map");
producer = replaceOnce(producer, "path.join(output, 'empty-types')", "path.join(own, 'type-tools/node_modules/@types')");
producer = producer.replaceAll('CORE_ROOT_AUTHOR_BUILD_V2', 'CORE_ROOT_AUTHOR_BUILD_V3').replaceAll('CORE_ROOT_AUTHOR_PRODUCER_V2', 'CORE_ROOT_AUTHOR_PRODUCER_V3').replaceAll('knownOsMaximum: 56', 'knownOsMaximum: 48');
producer = replaceOnce(producer, '  const tools = composition.tools;\n', `  const typeManifest = JSON.parse(read(path.join(own, 'TYPE-TOOLS.json')));
  for (const row of typeManifest.rows) { verify(row); verify(row, row.origin); }
  const typeRows = inventory(typeManifest.root).rows;
  assert.equal(typeRows.length, typeManifest.rows.length);
  for (const row of typeRows) { const expected = typeManifest.rows.find(item => item.path === path.join(typeManifest.root, row.path)); assert(expected); assert.equal(row.sha256, expected.sha256); assert.equal(row.size, expected.size); }
  const tools = composition.tools;
`);
const causeCode = `  const failed = JSON.parse(read(path.join(parent, 'author-v2/FAILED-EMIT-DIFF.json')));
  const allowed = new Set(composition.sources.filter(row => row.revision === SOURCE_COMMIT).flatMap(row => { const stem = row.path.replace(/^src\\//, 'dist/').replace(/\\.ts$/, ''); return [stem + '.js', stem + '.js.map', stem + '.d.ts', stem + '.d.ts.map']; }));
  const foreign = emit.filter(row => row.status !== 'unchanged' && !allowed.has(row.path));
  const causes = [...new Set([...failed.rows.filter(row => row.status !== 'unchanged').map(row => row.path), ...emit.filter(row => row.status !== 'unchanged').map(row => row.path)])].sort().map(filename => { const current = emit.find(row => row.path === filename), old = failed.rows.find(row => row.path === filename); return { path: filename, failedStatus: old?.status ?? null, qualifiedStatus: current?.status ?? null, kind: current?.kind ?? null, sourceCause: allowed.has(filename) ? 'Exact accepted owner.ts/root.ts overlay emission; source/maps/declarations enumerated individually' : current?.status === 'unchanged' ? 'Disappears with corrected pinned Node-type resolution; corresponding product source unchanged' : 'UNEXPECTED_FOREIGN_EMIT_CHANGE', failedAfter: old?.after ?? null, qualifiedAfter: current?.after ?? null, baseline: current?.before ?? null }; });
  write.json(path.join(output, 'EMIT-CAUSES.json'), { compilerExit: 0, failedCompilerExit: 2, priorFailureCommit: '58ba544b0c702ff47ff7b623f05afb1229ffe3ca', failedChangedPaths: failed.counts.changed, qualifiedChangedPaths: emit.filter(row => row.status !== 'unchanged').length, foreign, rows: causes });
  assert.equal(foreign.length, 0, 'UNEXPECTED_FOREIGN_EMIT_CHANGE: package blocked');
`;
producer = replaceOnce(producer, "  write.json(path.join(output, 'COMPILED-INVENTORY.json'), compiled);", causeCode + "  write.json(path.join(output, 'COMPILED-INVENTORY.json'), compiled);");
producer = replaceOnce(producer, 'selection, compilerInvocations: 1', "selection, typeTools: digest(path.join(own, 'TYPE-TOOLS.json')), emitCauses: digest(path.join(output, 'EMIT-CAUSES.json')), compilerInvocations: 1");
let io = read(path.join(prior, 'io.mjs')).toString();
io = replaceOnce(io, '2026-08-29T16:08:17Z', '2026-08-29T16:23:05Z');
let bindings = read(path.join(prior, 'bindings.mjs')).toString();
const files = [['producer.mjs', producer], ['io.mjs', io], ['bindings.mjs', bindings]];
const patch = '*** Begin Patch\n' + files.map(([name, text]) => '*** Add File: ' + path.join(own, name) + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
fs.writeFileSync(path.join(own, 'version.patch'), patch, { flag: 'wx' });
console.log(JSON.stringify({ typeClosure: { packages, files: rows.length, bytes: typeManifest.bytes, allOriginalPinsMatched: true }, generatedVersionPatch: path.join(own, 'version.patch') }));
