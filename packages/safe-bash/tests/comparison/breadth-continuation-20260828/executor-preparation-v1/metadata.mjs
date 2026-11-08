import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { boundFile, hash, relativeName, errorRecord, requireThat } from './core.mjs';

export function originalProjection(root) {
  const manifestBytes = readFileSync(resolve(root, 'MANIFEST.json'));
  requireThat(hash(manifestBytes) === '19526e0eb11478107b73026bdcc5d3b309f4cfb38c57a93c7cfea1672e75e923', 'ORIGINAL_MANIFEST', 'a045139b');
  const manifest = JSON.parse(manifestBytes);
  for (const entry of manifest.files) boundFile(resolve(root, relativeName(entry.path)), entry);
  return { originalManifestSha256: hash(manifestBytes), originalFilesUnchanged: manifest.files.length + 1, appendedDirectory: 'executor-preparation-v1', originalValidatorNotRewritten: true };
}
export function gitJson(repository, git, binding) {
  const bytes = execFileSync(git, ['show', `${binding.commit}:${binding.path}`], { cwd: repository, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  requireThat(bytes.length === binding.bytes && hash(bytes) === binding.sha256, 'GIT_BINDING', binding.path);
  return JSON.parse(bytes);
}
export function available(repository, root, preparation) {
  const original = originalProjection(root);
  for (const tool of preparation.tools) boundFile(tool.path, tool);
  const git = preparation.tools.find(tool => tool.role === 'git').path;
  const old = gitJson(repository, git, preparation.references.execution);
  const target = gitJson(repository, git, preparation.references.target);
  const errors = [];
  const checked = [];
  const forbidden = [];
  const closure = old.engines['just-bash'].closure;
  for (const entry of closure.files) {
    if (entry.path.split('/').some(part => part.toUpperCase() === 'AGENTS.MD')) {
      forbidden.push({ ...entry, contentRead: false, materialized: false, reason: 'AGENTS_FORBIDDEN' });
      continue;
    }
    try {
      relativeName(entry.path);
      const filename = resolve(closure.root, entry.path);
      const receipt = boundFile(filename, entry);
      checked.push({ path: entry.path, ...receipt });
    } catch (error) { errors.push({ path: entry.path, error: errorRecord(error) }); }
  }
  const artifacts = [];
  for (const [role, filename, expected] of [
    ['comparator-tarball', resolve(old.baselineTar.root, old.baselineTar.path), old.baselineTar],
    ['accepted-target-pack', target.pack.physical, target.pack],
  ]) {
    try { artifacts.push({ role, path: filename, ...boundFile(filename, expected), present: true }); }
    catch (error) { artifacts.push({ role, path: filename, present: false, error: errorRecord(error) }); }
  }
  const runnerFiles = [];
  for (const name of ['breadth.mjs', 'observe-load.mjs', 'reuse/breadth-assess.mjs']) {
    const entry = old.runner.files.find(file => file.path === name);
    try { runnerFiles.push({ path: name, ...boundFile(resolve(old.runner.root, name), entry) }); }
    catch (error) { runnerFiles.push({ path: name, error: errorRecord(error) }); }
  }
  const packageEntry = closure.files.find(file => file.path === old.engines['just-bash'].packageJson);
  const packageMetadata = JSON.parse(boundFile(resolve(closure.root, packageEntry.path), packageEntry, true).data);
  requireThat(packageMetadata.name === 'just-bash' && packageMetadata.version === '3.4.2', 'COMPARATOR_VERSION', packageMetadata.version);
  return {
    kind: 'read-only-availability-not-installation', original,
    comparator: { root: closure.root, declaredFiles: closure.files.length, authenticatedRegularFiles: checked.length, authenticatedBytes: checked.reduce((sum, entry) => sum + entry.bytes, 0), orderedObservationSha256: hash(JSON.stringify(checked)), forbidden, errors, namespaceCensusPerformed: false, completeOldClosureAuthenticated: forbidden.length === 0 && errors.length === 0, name: packageMetadata.name, version: packageMetadata.version },
    target: { candidate: target.candidate, packSha256: target.pack.sha256, declaredPackageMembers: target.packageFiles.length, packageMembersReextracted: false },
    artifacts, oldAdapterBindings: runnerFiles, productImports: 0, installs: 0, nativeOracles: 0,
  };
}
