import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline, acceptedModule, runtime, admission, publicPaths } from './cases.mjs';
import { consumers } from './types.mjs';
import { assertSafeInput } from './predicates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const prior = 'tests/commands/timeout-independent-20260828/repaired-f22-v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => fs.readFileSync(resolve(repo, path));
const write = (name, value) => fs.writeFileSync(resolve(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
for (const name of ['BINDINGS.json', 'MANIFEST.json', 'VALIDATION.json']) assert.equal(fs.existsSync(resolve(here, name)), false, `ALREADY_SEALED:${name}`);
const tools = [
  { path: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', sha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011' },
  { path: '/Applications/Xcode.app/Contents/Developer/usr/bin/git', sha256: '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9' },
];
for (const row of tools) assert.equal(sha(read(row.path)), row.sha256, 'TOOL_BEFORE_GIT');
assert.equal(process.execPath, tools[0].path);
assert.equal(process.version, 'v22.22.2');
const started = new Date().toISOString();
const gitReceipts = [];
const git = args => {
  const bytes = execFileSync(tools[1].path, ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
  gitReceipts.push({ args, bytes: bytes.length, sha256: sha(bytes), status: 0, natural: true });
  return bytes;
};
const protectedFiles = new Map();
const protect = (path, expected) => {
  assert.ok(!path.split('/').some(part => part.toLowerCase() === 'agents.md'));
  const stat = fs.lstatSync(resolve(repo, path));
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'PROTECTED_REGULAR');
  const bytes = read(path), hash = sha(bytes);
  if (expected !== undefined) assert.equal(hash, expected, `PROTECTED_HASH:${path}`);
  protectedFiles.set(path, { path, bytes: bytes.length, sha256: hash });
  return bytes;
};
const oldRecipe = JSON.parse(protect(`${prior}/recipe/MANIFEST.json`, 'af30a8a18b9c3f85148d4feee9f0553e1afce30e22c7d34de577452ae0dc908e'));
for (const [name, hash] of Object.entries(oldRecipe.files)) protect(`${prior}/recipe/${name}`, hash);
const oldEvidence = JSON.parse(protect(`${prior}/EVIDENCE-MANIFEST.json`, '22abdcf6dd027b321c33278a0128adeb5f1584add5bb03c65b009072709391c8'));
for (const row of oldEvidence.files) protect(`${prior}/${row.path}`, row.sha256);
const old = JSON.parse(read(`${prior}/recipe/BINDINGS.json`));
assert.equal(old.baseline, baseline);
assert.equal(old.candidate, acceptedModule);
assert.equal(old.inputs.length, 268);
for (const row of old.protectedRows) protect(row.path, row.sha256);
protect(old.closurePath, 'b4263e32e6b2ea91a7f8eccceb1133a04ef09d614adca2c8021737572dbd0ad7');
const selected = [];
for (const original of old.inputs) {
  assertSafeInput(original);
  const commit = original.path.startsWith('src/commands/timeout/') ? acceptedModule : baseline;
  const tree = git(['ls-tree', commit, '--', original.path]).toString('utf8').trim();
  assert.equal(tree, `${original.mode} blob ${original.blob}\t${original.path}`, 'COMMITTED_INPUT_IDENTITY');
  const bytes = git(['cat-file', 'blob', original.blob]);
  assert.equal(bytes.length, original.bytes);
  assert.equal(sha(bytes), original.sha256);
  selected.push({ ...original, commit });
}
const baselineNames = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString('utf8').trim().split('\n').sort();
assert.deepEqual(baselineNames, selected.filter(row => row.commit === baseline).map(row => row.path).sort());
assert.equal(baselineNames.length, 264);
const inventorySource = [
  'tests/plugins/agent-commands.test.ts', 'src/plugins/index.ts',
  'src/commands/which/index.ts', 'src/commands/which/which.ts',
  'src/commands/text-programs/shared.ts', 'src/commands/text-programs/sed.ts',
  'src/contracts/command.ts', 'src/shell/types.ts',
].map(path => { const bytes = git(['show', `${baseline}:${path}`]); return { commit: baseline, path, bytes: bytes.length, sha256: sha(bytes) }; });
const originalPackage = JSON.parse(git(['show', `${baseline}:package.json`]));
for (const row of protectedFiles.values()) assert.equal(sha(read(row.path)), row.sha256, 'PROTECTED_POST');
for (const row of tools) assert.equal(sha(read(row.path)), row.sha256, 'TOOL_AFTER_GIT');
write('BINDINGS.json', {
  schema: 'timeout-public-prewiring-bindings/1', started, sealedAt: new Date().toISOString(),
  baseline, acceptedModule, acceptedEvidence: '33518147bde6863c3ca60ae14a9c0394f737d54c',
  publicCandidate: null, chronology: 'Accepted module and baseline inspected; no public wiring candidate supplied/inspected; post-module-source, pre-public-candidate.',
  acceptedArchive: old.sourceArchive, acceptedPack: old.pack,
  selectedInputs: selected, publicReplacementPaths: publicPaths, originalPackage, inventorySource,
  tools, toolClosure: { path: old.closurePath, regularFiles: 2274, aliasesMetadataOnly: 12 },
  protectedFiles: [...protectedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)),
  provenance: {
    oldModuleCases: `${prior}/recipe/cases.mjs`,
    acceptedCollisionPredicate: `${prior}/recipe/borrowed-boundary.mjs`,
    acceptedPriorityPredicates: `${prior}/recipe/predicates.mjs`,
    clock: 'tests/commands/timeout-independent-20260828/clock.mjs',
    oldModuleCasesMapping: { R05: ['F02','F03'], R09: ['F06'], R10: ['F10','F30'], R11: ['F07'], R12: ['F08'], R13: ['F22'], R14: ['F22'], R15: ['F15'], R16: ['F15'], R17: ['F15'], R18: ['F15'], R21: ['F23','F29'], R22: ['F16','F18'], R23: ['PC01'], R24: ['PC01'], R25: ['PC02'], R26: ['F24'], R28: ['F29','F32'], R29: ['F28'], R30: ['F05'] },
    newPublicCases: ['R01','R02','R03','R04','R06','R07','R08','R19','R20','R27'],
  },
  gitReceipts, gitChildren: gitReceipts.length, childFailures: 0, productLoads: 0,
  inspectionNotes: ['Two nonexistent metadata-file reads and one unquoted zsh glob were inspection-only failures; no case/build run, no missing bytes reconstructed. Actual metadata subsequently read from recipe/MANIFEST.json.'],
});
const files = ['README.md','cases.mjs','types.mjs','predicates.mjs','seal.mjs','validate.mjs','BINDINGS.json'].map(path => {
  const bytes = fs.readFileSync(resolve(here, path));
  return { path, bytes: bytes.length, sha256: sha(bytes) };
});
write('MANIFEST.json', {
  schema: 'timeout-public-prewiring-freeze/1', sealedAt: new Date().toISOString(),
  baseline, acceptedModule, publicCandidate: null, files,
  runtimeFamilies: runtime.length, typeConsumers: consumers.length,
  positiveTypes: consumers.filter(row => row.expected === 'accept').length,
  negativeTypes: consumers.filter(row => row.expected === 'reject').length,
  admissionFamilies: admission.length, syntheticControls: 36,
  runtimeLayouts: ['authenticated-source','offline-installed-public','physically-moved-public'],
  typeLayouts: ['offline-installed-public','physically-moved-public'],
  actualPublicCases: 0, actualPublicTypes: 0, actualBuilds: 0, native: 0, safeJS: 0,
});
console.log(JSON.stringify({ manifest: relative(repo, resolve(here, 'MANIFEST.json')), sha256: sha(fs.readFileSync(resolve(here, 'MANIFEST.json'))), gitChildren: gitReceipts.length, protectedFiles: protectedFiles.size, productLoads: 0 }));
