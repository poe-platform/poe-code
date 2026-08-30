import { controls } from './bind.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(directory, '../../../..');
export const control = 'tests/shell/cd-prerequisite-independent-20260828';
export const own = `${control}/review-4641075d`;
export const pins = Object.freeze({
  freeze: 'beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e',
  binding: '2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c',
  ratification: 'ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de',
  baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290',
  provider: 'ca1d33424b94a21ae0f40a36412fd8191611e2df',
  providerReview: '2ec9bcdafce7964769e87ed6fe681ea0936f266a',
  composition: '7c68831a81fc49c94ad9177e58ca9fd7d0aca352',
  nativeFreeze: '317128ddbce8ac9d321870f46957c33bca257612',
  nativeEvidence: 'd0b2557e1cb443b94d595c8a4cdd468f94c2601c',
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
export const blob = (commit, path) => git(['show', `${commit}:${path}`]);
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const save = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' }); };
export const gitHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export const counts = Object.freeze({ command: 82, diagnostic: 4, total: 86, positiveTypes: 10, negativeTypes: 10, invariants: 12, futureControls: 7 });

export function inventory(base, exclude = new Set()) {
  const result = {};
  const walk = (path, name) => {
    if (exclude.has(name)) return;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `symlink not admitted: ${path}`);
    if (stat.isDirectory()) {
      result[name] = { kind: 'directory', mode: stat.mode & 0o777 };
      for (const child of readdirSync(path).sort()) walk(resolve(path, child), name ? `${name}/${child}` : child);
    } else {
      assert(stat.isFile(), `nonregular entry: ${path}`);
      const bytes = readFileSync(path);
      result[name] = { kind: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) };
    }
  };
  walk(base, '');
  return result;
}

export function inherited() { return controls(); }

export async function frozenCases() {
  inherited();
  const data = await import(pathToFileURL(resolve(repo, control, 'cases-v1.mjs')).href);
  assert.equal(data.cases.length, counts.command);
  assert.equal(data.diagnosticCases.length, counts.diagnostic);
  return data;
}

export function deny(message) {
  throw Object.assign(new Error(message), { code: 'CD_REVIEW_ADMISSION_DENIED' });
}

export function authorize(binding, route) {
  if (!binding || binding.state !== 'routed-candidate') deny('No ROOT-routed candidate; no product work admitted');
  const full = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  if (!full(binding.candidateCommit) || !full(binding.candidateComposedTree)) deny('Full candidate/source binding required');
  if (binding.runtime?.path !== 'src/shell/runtime.ts' || !full(binding.runtime.blob) || !hash(binding.runtime.sha256)) deny('Only explicitly bound runtime.ts override admitted');
  if (!full(binding.evidence?.commit) || !full(binding.evidence.blob) || !hash(binding.evidence.sha256) || !binding.evidence.path?.startsWith('tests/')) deny('Full author evidence binding required');
  if (binding.evidence.path.split('/').includes('..')) deny('Evidence path traversal refused');
  if (binding.baseline !== pins.baseline || binding.provider !== pins.provider || binding.composition !== pins.composition) deny('Wrong fixed baseline composition');
  if (route?.authorization !== 'ROOT_EXECUTION_AUTHORIZED' || route.candidateCommit !== binding.candidateCommit || route.bindingSha256 !== sha256(JSON.stringify(binding))) deny('Explicit ROOT execution route bound to this JSON value required');
  if (typeof route.reference !== 'string' || !route.reference.trim()) deny('ROOT route reference required');
  if (JSON.stringify(route.modes) !== JSON.stringify(['source', 'installed', 'moved'])) deny('All three unchanged layouts required');
  if (!route.tools || !hash(route.tools.manifestSha256) || typeof route.tools.manifestPath !== 'string') deny('Pinned regular tool manifest required');
  if (typeof route.outputDirectory !== 'string' || typeof route.authorizedWriteRoot !== 'string') deny('Explicit ROOT-owned isolated output scope required');
  const output = resolve(repo, route.outputDirectory);
  const scope = resolve(repo, route.authorizedWriteRoot);
  if (!scope.startsWith(`${repo}/tests/`) || output !== scope || !output.startsWith(`${resolve(repo, own)}/`)) deny('New isolated output scope outside immutable control tree required');
  return { ...route, outputDirectory: output, authorizedWriteRoot: scope };
}

export function authenticateCandidate(binding) {
  const raw = git(['cat-file', 'commit', binding.candidateCommit]);
  assert.equal(gitHash('commit', raw), binding.candidateCommit);
  for (const [commit, entry] of [[binding.candidateCommit, binding.runtime], [binding.evidence.commit, binding.evidence]]) {
    const bytes = blob(commit, entry.path);
    assert.equal(gitHash('blob', bytes), entry.blob);
    assert.equal(sha256(bytes), entry.sha256);
  }
}

export function foreignStaging() {
  const parts = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).toString().split('\0');
  const entries = [];
  for (let index = 0; index + 1 < parts.length; index += 2) if (!parts[index + 1].startsWith(`${own}/`)) entries.push(`${parts[index]}\t${parts[index + 1]}`);
  return entries.sort();
}

export const ownFile = name => resolve(directory, name);
export const relativeRepo = path => relative(repo, path);
