import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { census, digest, tarInventory } from '../candidate-v1/boundary-app.mjs';
import { verifyTool } from '../candidate-v1/npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.dirname(here), repository = path.resolve(own, '../../..');
const product = 'c0adae539c736db0e4023d401562ce958d9ebb00', evidence = '90811f46e54b771ee6d30002fd10cb1b5cdf7bc7';
let gitCalls = 0;
const git = (...args) => { assert.ok(++gitCalls <= 300); return execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 64 * 1024 * 1024 }); };
const read = name => fs.readFileSync(path.join(own, name));
function capsule(name, encodedSha, decodedSha) {
  const encoded = read(name); assert.equal(digest(encoded), encodedSha);
  const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }); assert.equal(digest(decoded), decodedSha); return JSON.parse(decoded);
}
const oldReview = capsule('candidate-v1/OBSERVER-V2-REVIEW-01.json.gz.base64', '23a49e2ed9f0784a2916e2807d99fee39ef50253e87b842320d03855912694de', '2207411e59a995b71ad79b9d3ceaf7e1c296eff029b802250fff803191f32ef3');
const oldManifest = JSON.parse(Buffer.from(oldReview.records['MECHANISMS-MANIFEST.json'].base64, 'base64'));
const oldPackage = capsule('candidate-v1/ADMISSION-02.json.gz.base64', '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a', 'adfc29d7b8df6b8fd350e4cc39eeb00fde0301bb13eda2be87a1e41000972288');
const oldTar = Buffer.from(oldPackage.packageBase64, 'base64'); assert.equal(digest(oldTar), oldManifest.packageSha256);
const authorPath = 'tests/shell/indexed-arrays-author-20260828/s06-v2';
const authorSealBytes = git('show', `${evidence}:${authorPath}/SUCCESSOR-SEAL.json`), seal = JSON.parse(authorSealBytes);
const encoded = git('show', `${evidence}:${authorPath}/successor-capture-01.json.gz.base64`);
const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }), author = JSON.parse(decoded);
const tar = Buffer.from(author.package.base64, 'base64'); assert.equal(digest(tar), 'e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3');
const priorInventory = tarInventory(oldTar), inventory = tarInventory(tar); assert.equal(Object.keys(inventory).length, 862); assert.deepEqual(Object.keys(inventory), Object.keys(priorInventory));
const changes = Object.keys(inventory).filter(name => JSON.stringify(inventory[name]) !== JSON.stringify(priorInventory[name]));
for (const name of changes) assert.equal(inventory[name].mode, priorInventory[name].mode);
const publicDeclarations = Object.keys(inventory).filter(name => name.endsWith('.d.ts') && !name.startsWith('dist/shell/arrays/'));
for (const name of publicDeclarations) assert.deepEqual(inventory[name], priorInventory[name]);
assert.deepEqual(inventory['package.json'], priorInventory['package.json']);
const approved = ['src/shell/parser.ts', 'src/shell/runtime.ts', 'src/shell/arrays/syntax.ts'];
const source = oldManifest.sourceProjection.map(entry => {
  const commit = approved.includes(entry.path) ? product : entry.commit, bytes = git('show', `${commit}:${entry.path}`);
  if (!approved.includes(entry.path)) assert.equal(digest(bytes), entry.sha256);
  const next = { ...entry, commit, bytes: bytes.length, sha256: digest(bytes), blob: approved.includes(entry.path) ? seal.sourceOverlays[entry.path].blob : entry.blob };
  if (approved.includes(entry.path)) assert.equal(next.sha256, seal.sourceOverlays[entry.path].sha256);
  return next;
});
assert.equal(source.length, 269);
assert.equal(digest(fs.readFileSync(oldManifest.node.path)), oldManifest.node.sha256); assert.equal(process.execPath, oldManifest.node.path); assert.equal(process.version, oldManifest.node.version);
const toolBytes = git('show', '8fa48028:tests/shell/dotglob-independent-20260828/stack-binding-v1/BINDING.json'), toolBinding = JSON.parse(toolBytes);
for (const tool of toolBinding.typeTools) assert.deepEqual(Object.fromEntries(Object.entries(census(tool.root)).filter(([, item]) => !item.directory)), tool.inventory.files);
const npmEncoded = read('candidate-v1/NPM-TOOL-INVENTORY.json.gz.base64'); assert.equal(digest(npmEncoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const npmDecoded = gunzipSync(Buffer.from(npmEncoded.toString(), 'base64')); assert.equal(digest(npmDecoded), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce'); const npm = verifyTool(JSON.parse(npmDecoded));
const rows = JSON.parse(read('review-v3/VECTORS.json')), holdouts = JSON.parse(read('executor-v1/HOLDOUTS.json'));
const semanticIds = [...rows.splice, ...rows.zeroView].map(row => row.id), holdoutIds = holdouts.semantic.filter(row => !row.status).map(row => row.id);
const mechanismIds = ['M01','M02','M03','M04','M05','M06','M07','M09','M10','M11','M12','M13','M14','M15','M18','M19','M20'];
const typeIds = ['public','ast','negative-option','negative-limit','negative-export','option-inverse','limit-inverse','export-inverse','original-public','ast-negative'];
const roles = ['executor-v1/worker.mjs','executor-v1/run.mjs','executor-v1/supervisor.mjs','executor-v1/semantic.mjs','candidate-v1/boundary-app.mjs','candidate-v1/types-v2.mjs','candidate-v1/observer-v2.mjs','candidate-v1/terminal-adapter-v2.mjs','candidate-v1/mechanism-adapter-v1.mjs','candidate-v1/layout-adapter-v2.mjs','candidate-v1/npm-tool.mjs','review-v3/VECTORS.json','review-v3/CONTROLS.json','executor-v1/HOLDOUTS.json','executor-v1/BASELINE.json','s06-successor-v1/semantic-registration-v2.mjs','s06-successor-v1/compiled-mutation-v2.mjs','s06-successor-v1/AST-COMPAT-v1.json'];
const fixtures = ['candidate-v1/public-v2.mts.fixture', ...['ast','negative-option','negative-limit','negative-export','option-inverse','limit-inverse','export-inverse','public','ast-negative'].map(name => `executor-v1/${name}.mts.fixture`)];
const roleBindings = [...roles, ...fixtures].map(name => ({ path: name, bytes: read(name).length, sha256: digest(read(name)) }));
const originalSemantic = read('executor-v1/semantic.mjs').toString(), correctedSemantic = read('s06-successor-v1/semantic-registration-v2.mjs').toString();
const inserted = '    const definitions = api.createAgentCommands();\n    assert.equal(definitions.length, 77, "exact admitted registry");\n    const matches = definitions.filter(definition => definition.name === "printf");\n    assert.equal(matches.length, 1, "exactly one actual printf definition");\n    shell.register(matches[0]);\n';
assert.equal(correctedSemantic.split(inserted).length, 2); assert.equal(correctedSemantic.replace(inserted, ''), originalSemantic);
function memberBytes(name) {
  const raw = gunzipSync(tar, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= raw.length && raw[offset];) {
    const member = raw.subarray(offset, offset + 100).toString().split('\0')[0].slice(8), size = inventory[member].bytes;
    if (member === name) return raw.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Missing declared member');
}
const mutationSpecs = [
  { id: 'U01', member: 'dist/shell/arrays/ledger.js', replacements: [{ before: 'count > Number.MAX_SAFE_INTEGER - cursor', after: 'count > Number.MAX_SAFE_INTEGER' }, { before: '            const count = requested === true ? 1 : requested;', after: '            __arrayMutantHit();\n            const count = requested === true ? 1 : requested;' }] },
  { id: 'U02', member: 'dist/shell/arrays/bindings.js', replacements: [{ before: '        if (--watch.observers !== 0)', after: '        __arrayMutantHit();\n        if (--watch.observers !== -1)' }] },
  { id: 'U04', member: 'dist/shell/arrays/bindings.js', replacements: [{ before: '        if (--this.references === 0)\n            this.admission.release();', after: '        __arrayMutantHit();\n        if (--this.references >= 0)\n            this.admission.release();' }] },
  { id: 'U12', member: 'dist/shell/arrays/ledger.js', replacements: [{ before: '        return this.completion;', after: '        __arrayMutantHit();\n        return this.completion.then(() => undefined);' }] }
].map(specification => {
  const original = memberBytes(specification.member); assert.notEqual(original.at(-1), 10); let text = original.toString();
  for (const replacement of specification.replacements) { assert.equal(text.split(replacement.before).length, 2); text = text.replace(replacement.before, () => replacement.after); }
  const prefix = `import { createHash as __arrayHash } from 'node:crypto';\nimport { readFileSync as __arrayRead } from 'node:fs';\nimport { fileURLToPath as __arrayPath } from 'node:url';\nlet __arrayHits = 0;\nfunction __arrayMutantHit() { if (++__arrayHits === 1) process.stdout.write(JSON.stringify({ activation: { id: ${JSON.stringify(specification.id)}, path: __arrayPath(import.meta.url), sha256: __arrayHash('sha256').update(__arrayRead(new URL(import.meta.url))).digest('hex'), hits: 1 } }) + '\\n'); }\n`;
  const changed = Buffer.from(prefix + text + '\n');
  return { ...specification, originalSha256: digest(original), originalBytes: original.length, mode: inventory[specification.member].mode, prefix, finalLF: true, changedSha256: digest(changed), changedBytes: changed.length };
});
const jobs = [];
for (const layout of ['source-build','installed','moved']) {
  for (const [cohort, ids] of [['semantic', semanticIds], ['holdouts', holdoutIds], ['mechanical', mechanismIds], ['operations', ['P01','P02','P06','P07']]]) jobs.push({ id: `${layout}/${cohort}`, kind: 'runtime', layout, cohort, ids, supervisedProcesses: 2, outerMs: 180000, outerMaxBytes: 2097152, workerMs: 30000, workerMaxBytes: 1048576, gitShowCeiling: 269 });
  for (const id of typeIds) jobs.push({ id: `${layout}/types/${id}`, kind: 'types', supervisedProcesses: 1, timeoutMs: 30000, maxBytes: 2097152 });
}
for (const [id, timeoutMs] of [['selected-build',120000],['exact-pack',120000],['offline-install',90000]]) jobs.push({ id, kind: 'tool', supervisedProcesses: 1, timeoutMs, maxBytes: 2097152 });
for (const [id, ids] of [['positive-before',['M01','M04','M06','M07']],['U01',['M01']],['U02',['M04']],['U04',['M06']],['U12',['M07']],['positive-after',['M01','M04','M06','M07']]]) jobs.push({ id: `mutants/${id}`, kind: 'runtime-control', ids, supervisedProcesses: 2, outerMs: 180000, outerMaxBytes: 2097152, workerMs: 30000, workerMaxBytes: 1048576, gitShowCeiling: 269 });
const binding = { status: 'DATA-authenticated scope only; no successor execution or stage admission; dispatch root GO absent', product, evidence, selectedComposition: seal.sourceTree, selectedSource: source, selectedProjectionSha256: digest(Buffer.from(JSON.stringify(source))), package: { sha256: digest(tar), bytes: tar.length, files: 862, inventory, changedFromOld: changes.map(name => ({ path: name, before: priorInventory[name], after: inventory[name] })), publicDeclarationsUnchanged: publicDeclarations.length, metadataUnchanged: true }, sourceCapsule: { commit: evidence, path: `${authorPath}/successor-capture-01.json.gz.base64`, encodedSha256: digest(encoded), decodedSha256: digest(decoded), sealSha256: digest(authorSealBytes) }, tools: { node: oldManifest.node, typeInventorySource: { commit: '8fa48028', path: 'tests/shell/dotglob-independent-20260828/stack-binding-v1/BINDING.json', sha256: digest(toolBytes) }, typeTools: toolBinding.typeTools, npm: { root: npm.root, decodedSha256: digest(npmDecoded), links: npm.links, inventoryPath: 'candidate-v1/NPM-TOOL-INVENTORY.json.gz.base64', encodedSha256: digest(npmEncoded) } }, roles: roleBindings, candidateAdapterRebinding: { from: oldManifest.candidate, to: product, files: ['candidate-v1/terminal-adapter-v2.mjs','candidate-v1/mechanism-adapter-v1.mjs'], scope: 'exact single exported candidate literal replacement only, to be sealed before future dispatch' }, jobs, bounds: { jobs: jobs.length, supervisedProcesses: jobs.reduce((total, job) => total + job.supervisedProcesses, 0), coordinatorContainedGitChildren: jobs.reduce((total, job) => total + (job.gitShowCeiling ?? 0), 0), nominalSerialTimeoutMs: jobs.reduce((total, job) => total + (job.outerMs ?? job.timeoutMs), 0), note: 'Finite job data, not an already implemented whole coordinator. Existing per-child fences remain; termination/drain grace additional, no OS absolute-time promise. Metadata preparation Git ceiling300 separately; no candidate executed.' }, uninstantiated: { mechanical: ['M08','M16','M17','M21','M22'], partialMechanical: ['M03','M07','M14','M15','M20'], operations: ['P03','P04','P05','P08','P09','P10'], mutations: ['U03','U05','U06','U07','U08','U09','U10','U11'], astRuntime: ['AST01','AST02','AST03','AST04'], newS06Reversion: 'required; no concrete variant yet', additionalTwentyNeighborsFromProposal: 'not instantiated or included in69 supervised-process queue', wholeCoordinator: 'not dispatchable: root GO, future physical app censuses, new type receipts and successor adapter/header bindings required' }, preparatoryGitCalls: gitCalls, actualSuccessorExecutions: 0 };
for (const [name, value] of [['MUTATION-BYTES-v2.json', mutationSpecs], ['SCOPE-BINDING-v2.json', binding]]) {
  const text = JSON.stringify(value, null, 2) + '\n'; execFileSync('apply_patch', [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path.join(here, name)}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 30000, maxBuffer: 1024 * 1024 });
}
console.log(JSON.stringify({ status: binding.status, projection: binding.selectedProjectionSha256, changes, publicDeclarations: publicDeclarations.length, node: oldManifest.node.sha256, jobs: jobs.length, bounds: binding.bounds, gitCalls, mutatedBytesComputedAsData: mutationSpecs.map(({ id, changedBytes, changedSha256 }) => ({ id, changedBytes, changedSha256 })), successorExecutions: 0 }));
