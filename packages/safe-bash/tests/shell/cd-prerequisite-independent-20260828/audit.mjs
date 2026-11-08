import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, '../../..');
export const ownPath = relative(root, directory);
export const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
export const provider = 'ca1d33424b94a21ae0f40a36412fd8191611e2df';
export const review = '2ec9bcdafce7964769e87ed6fe681ea0936f266a';
export const evidence = 'd0b2557e1cb443b94d595c8a4cdd468f94c2601c';
export const preseal = '317128ddbce8ac9d321870f46957c33bca257612';
export const policy2 = '882085678862a23cfeef6505fa41a03891743439';
export const policy3 = '7728401ccb7bfa8f1961ffe100ca5617f3a6b553';
export const compositionTree = '7c68831a81fc49c94ad9177e58ca9fd7d0aca352';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
export const blob = (commit, path) => git(['show', `${commit}:${path}`]);
export const json = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
export const exclusiveJson = (name, value) => writeFileSync(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

export const protectedRoots = [
  'AGENTS.md', 'package.json', 'package-lock.json', 'src/index.ts',
  'src/shell', 'src/contracts', 'src/fs/memory', 'src/fs/real', 'src/fs/readonly',
  'src/fs/mount', 'src/fs/s3', 'src/fs/webdav',
  'tests/shell/cd-prerequisite-20260828',
  'tests/shell/directory-stack-design-20260828',
  'tests/fs/webdav/directory-access-independent-20260828',
];

export function inventory(paths, excluded = new Set()) {
  const entries = {};
  const visit = path => {
    if (excluded.has(path)) return;
    const full = resolve(root, path);
    const stat = lstatSync(full, { throwIfNoEntry: false });
    if (!stat) { entries[path] = { kind: 'absent' }; return; }
    if (stat.isSymbolicLink()) { entries[path] = { kind: 'symlink', target: readlinkSync(full) }; return; }
    if (stat.isDirectory()) {
      entries[path] = { kind: 'directory', mode: stat.mode & 0o777 };
      for (const name of readdirSync(full).sort()) visit(`${path}/${name}`);
      return;
    }
    assert(stat.isFile(), `unsupported inventory entry ${path}`);
    entries[path] = { kind: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(full)) };
  };
  for (const path of paths) visit(path);
  return entries;
}

export function foreignIndex() {
  const raw = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).toString().split('\0');
  const entries = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (!raw[index + 1].startsWith(`${ownPath}/`)) entries.push(`${raw[index]}\t${raw[index + 1]}`);
  }
  return entries.sort();
}

const baseInputs = [
  'src/index.ts', 'package.json', 'src/shell/index.ts', 'src/shell/runtime.ts',
  'src/shell/shell.ts', 'src/shell/types.ts', 'src/contracts/index.ts',
  'src/contracts/filesystem.ts', 'src/contracts/filesystem.md', 'src/contracts/command.ts',
  'src/contracts/command.md', 'src/contracts/plugin.ts', 'src/contracts/io.ts', 'src/contracts/errors.ts',
  'src/contracts/path.ts', 'src/fs/memory/index.ts', 'src/fs/real/index.ts',
  'src/fs/readonly/index.ts', 'src/fs/mount/index.ts', 'src/fs/s3/filesystem.ts',
  'src/fs/webdav/index.ts', 'tests/fs/webdav/mock.ts',
];
const authorDirectory = 'tests/shell/cd-prerequisite-20260828';
const providerDirectory = 'tests/fs/webdav/directory-access-independent-20260828/review-ca1d3342';

export function committedInputs() {
  const routes = [
    ...baseInputs.map(path => [baseline, path]),
    ...['src/fs/webdav/webdav.ts', 'src/fs/webdav/README.md'].map(path => [provider, path]),
    ...['FREEZE.json', 'README.md', 'cases.json', 'run.mjs'].map(name => [preseal, `${authorDirectory}/${name}`]),
    ...['HANDOFF.md', 'observations-01.json.gz.base64'].map(name => [evidence, `${authorDirectory}/${name}`]),
    [policy2, `${authorDirectory}/AUTHOR-POLICY-v2.md`],
    [policy2, `${authorDirectory}/AUTHOR-POLICY-v2-SEAL.json`],
    [policy3, `${authorDirectory}/AUTHOR-POLICY-v3-DETAILS.md`],
    ...['REPORT.md', 'BINDING.json'].map(name => [review, `${providerDirectory}/${name}`]),
    [evidence, 'tests/integration/combined77-stage2-independent-20260828/actual-01.json.gz.base64'],
  ];
  return routes.map(([commit, path]) => {
    const bytes = blob(commit, path);
    return { commit, path, blob: git(['rev-parse', `${commit}:${path}`]).toString().trim(), bytes: bytes.length, sha256: sha256(bytes) };
  });
}

export function authenticate(inputs) {
  for (const entry of inputs) assert.equal(sha256(blob(entry.commit, entry.path)), entry.sha256, entry.path);
  const sealed = JSON.parse(blob(preseal, `${authorDirectory}/FREEZE.json`));
  for (const [name, hash] of Object.entries(sealed.fixtures)) {
    assert.equal(sha256(blob(preseal, `${authorDirectory}/${name}`)), hash);
    assert.deepEqual(blob(preseal, `${authorDirectory}/${name}`), blob(evidence, `${authorDirectory}/${name}`));
  }
  const binding = JSON.parse(blob(review, `${providerDirectory}/BINDING.json`));
  assert.equal(binding.composition.composedTree, compositionTree);
  for (const proof of Object.values(binding.commits)) {
    const raw = Buffer.from(proof.base64, 'base64');
    assert.equal(createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex'), proof.commit);
  }
  return { compositionTree, looseTreeObjectRequired: false, rawCommitProofs: Object.keys(binding.commits).length };
}

if (process.argv[2] === '--before') {
  const inputs = committedInputs();
  const proof = authenticate(inputs);
  exclusiveJson('INPUTS-v1.json', { schema: 'cd-independent-inputs/v1', capturedAt: new Date().toISOString(), inputs, proof });
  exclusiveJson('PROTECTED-BEFORE-v1.json', {
    schema: 'cd-protected/v1', capturedAt: new Date().toISOString(), roots: protectedRoots,
    entries: inventory(protectedRoots), foreignIndex: foreignIndex(),
    scope: 'Selected protected membership including empty directories, not an all-workspace/scratch absence proof',
  });
  console.log('Read-only input authentication and protected before-snapshot captured. No product execution.');
}

if (process.argv[2] === '--after') {
  const before = json('PROTECTED-BEFORE-v1.json');
  const entries = inventory(before.roots);
  assert.deepEqual(entries, before.entries, 'protected bytes/membership changed');
  assert.deepEqual(foreignIndex(), before.foreignIndex, 'foreign index changed');
  authenticate(json('INPUTS-v1.json').inputs);
  exclusiveJson('PROTECTED-AFTER-v1.json', { schema: 'cd-protected-after/v1', capturedAt: new Date().toISOString(), entries, foreignIndex: foreignIndex(), identical: true });
}

if (process.argv[2] === '--seal') {
  const excluded = new Set([`${ownPath}/MANIFEST-v1.json`]);
  exclusiveJson('MANIFEST-v1.json', {
    schema: 'cd-independent-membership/v1', sealedAt: new Date().toISOString(),
    excluded: [...excluded], entries: inventory([ownPath], excluded),
    selfBinding: 'Git commit binds this manifest; no other owned exclusions. Empty-directory additions detected.',
  });
}

if (process.argv[2] === '--exposures') {
  const inputs = committedInputs();
  authenticate(inputs);
  const commits = [...new Set(inputs.map(entry => entry.commit))].map(commit => {
    const raw = git(['cat-file', 'commit', commit]);
    assert.equal(createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex'), commit);
    return { commit, sha256: sha256(raw), metadata: raw.toString() };
  });
  const liveBindings = inputs.filter(entry => entry.commit === baseline || entry.commit === provider).map(entry => ({
    path: entry.path, baselineCommit: entry.commit, baselineSha256: entry.sha256,
    liveSha256: sha256(readFileSync(resolve(root, entry.path))),
    liveMatchesAcceptedBlob: sha256(readFileSync(resolve(root, entry.path))) === entry.sha256,
  }));
  exclusiveJson('EXPOSURES-v1.json', {
    schema: 'cd-independent-exposure/v1', capturedAt: new Date().toISOString(), commits, inputs, liveBindings,
    baselineBodiesInspected: [
      'src/shell/runtime.ts:60-110,272-307,320-340,470-525,666-690,949-978,1100,1129,1160-1247,1246-1376,2090-2122 and targeted declaration/operation locations',
      'src/shell/shell.ts:163-304', 'src/shell/types.ts', 'src/contracts/command.ts',
      'src/contracts/command.md:1-100', 'src/contracts/filesystem.md:283-327',
      'src/contracts/filesystem.ts:public signatures', 'src/contracts/errors.ts',
      'src/contracts/io.ts:1-45', 'src/contracts/path.ts:1-49', 'src/contracts/plugin.ts:1-68',
      'src/fs/memory/index.ts:1-80,142-151,453-468', 'src/fs/readonly/index.ts:1-116',
      'src/fs/mount/index.ts:1-95,470-488', 'tests/fs/webdav/mock.ts:33-54 and declaration/operation locations',
    ],
    acceptedProviderBodyInspected: 'ca1d webdav.ts:1-132,272-321,326,544-548,588-620,985-1026; declaration/operation locations',
    disclosure: 'Selected baseline bodies and exported signatures, not preinspection of all prior code. Other bound inputs were hashed/metadata-read only. Accepted package runtime bytes were authenticated but never imported.',
    runtimeStillBaseline: liveBindings.find(entry => entry.path === 'src/shell/runtime.ts').liveMatchesAcceptedBlob,
    prospectiveCandidateInspected: false, productExecution: false, nativeRuns: 0, providerRuns: 0,
    limits: 'PRECODE relative to a future ROOT-routed candidate. No claim that untracked/unrouted scratch does not exist elsewhere. Moving HEAD/root exports are not execution inputs.',
  });
}
