import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, '../../../..');
export const auditCommit = '96db59ac7d355d1a94422634b4c4f53d00932ad9';
export const auditPath = 'benchmarks/reports/current-integration/jq-delta-classification.json';
export const handoffPath = 'benchmarks/reports/current-integration/HANDOFF.md';
export const cohortFiles = [
  ['native-vectors.json', 'independent', 140],
  ['supplement-vectors.json', 'independent', 15],
  ['phase2-vectors.json', 'additive', 62],
  ['phase2-extra-vectors.json', 'additive', 6],
  ['exponent-vectors.json', 'additive', 9],
  ['overflow-comparison-vectors.json', 'additive', 4],
].map(([name, cohort, count]) => ({ path: `tests/commands/structured-stress/independent-increment/${name}`, cohort, count }));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const bytesResult = ({ status, stdoutHex, stderrHex }) => ({ status, stdoutHex, stderrHex });
export const git = args => {
  const result = spawnSync('git', args, { cwd: root, shell: false, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
export function frozenFile(path) {
  const bytes = readFileSync(resolve(root, path));
  assert.deepEqual(bytes, git(['show', `${auditCommit}:${path}`]), `immutable audit changed: ${path}`);
  return bytes;
}
export function addArtifact(name, document) {
  assert.match(name, /^[a-z0-9][a-z0-9.-]*$/u);
  const path = resolve(directory, name);
  assert.equal(existsSync(path), false, `never overwrite evidence: ${path}`);
  const text = `${JSON.stringify(document, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(digest(readFileSync(path)), digest(text));
  return digest(text);
}
export function sourceSnapshot() {
  const files = {};
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files[relative(root, child)] = digest(readFileSync(child));
      else throw new Error(`unexpected nonregular source: ${child}`);
    }
  };
  walk(resolve(root, 'src'));
  const hashEntries = entries => digest(entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, hash]) => `${path}\0${hash}\n`).join(''));
  return {
    productSha256: hashEntries(Object.entries(files)),
    structuredSha256: hashEntries(Object.entries(files).filter(([path]) => path.startsWith('src/commands/structured/'))),
    files,
    head: git(['rev-parse', 'HEAD']).toString().trim(),
    status: git(['status', '--short']).toString(),
    tooling: Object.fromEntries(['package.json', 'package-lock.json', 'tsconfig.json'].map(path => [path, digest(readFileSync(resolve(root, path)))])),
  };
}
