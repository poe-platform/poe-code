import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { ROOT, REPO, verifyRecipe, frozenDocuments } from './integrity.mjs';
import { exactJson, fingerprint, verifyTree, writeNew } from '../core.mjs';
import { authenticate, authenticateGit, diskArtifact, moveInstalled, freshGrant, validateGrant } from './admission.mjs';
import { normalize } from './cases.mjs';
import { supervise } from './supervisor.mjs';

export async function admit(recipeCommit, args) {
  assert.equal(args.length, 6, 'HANDOFF_JSON BYTES SHA256 ROOT_AUTH_JSON BYTES SHA256');
  const [file, count, digest, authorityFile, authorityCount, authorityDigest] = args;
  const handoff = await exactJson(path.resolve(file), { bytes: Number(count), sha256: digest });
  const authority = await exactJson(path.resolve(authorityFile), { bytes: Number(authorityCount), sha256: authorityDigest });
  assert.equal(authority.action, 'RUN_DIFFERENT_XAN_REVIEW');
  assert.equal(authority.handoffSha256, digest); assert.equal(authority.preparationRecipe, recipeCommit);
  assert.equal(authority.candidate, handoff.candidate.commit); assert.equal(authority.sourceInspectionRouted, true);
  assert.equal(authority.authority, 'ROOT_COORDINATOR');
  assert.equal(handoff.classification, 'ROOT_ROUTED_IMMUTABLE_CANDIDATE');
  await verifyTree(handoff.artifactRoot, handoff.selected);
  const result = await authenticate(handoff, entry => diskArtifact(handoff.artifactRoot, entry), 'CANDIDATE');
  await authenticateGit(handoff, REPO);
  for (const layout of Object.values(handoff.layouts)) await verifyTree(layout.root, layout.entries);
  return { handoff, result, authority: { path: path.resolve(authorityFile), bytes: Number(authorityCount), sha256: authorityDigest }, handoffSha256: digest };
}

export async function runCandidate(recipeCommit, args) {
  const admitted = await admit(recipeCommit, args);
  const { handoff } = admitted;
  const seal = await verifyRecipe(); const documents = await frozenDocuments(seal); const rows = normalize(documents);
  const cohort = JSON.parse(await readFile(path.join(ROOT, 'COHORT.json'), 'utf8'));
  const destination = path.join(ROOT, `candidate-${handoff.candidate.commit}`); await mkdir(destination);
  await writeNew(path.join(destination, 'ADMISSION.json'), admitted.result);
  const results = [];
  for (const label of ['SOURCE', 'INSTALLED_MOVED']) {
    const layout = handoff.layouts[label]; let root = layout.root;
    if (label === 'INSTALLED_MOVED') { const parent = path.join(destination, 'installed'); await mkdir(parent); root = await moveInstalled(layout, parent); }
    const job = { authorization: 'ROOT_ROUTED_CANDIDATE', authority: admitted.authority, handoffSha256: admitted.handoffSha256,
      recipeCommit, candidate: handoff.candidate.commit, layout: label, root, entries: layout.entries, entry: layout.entry, adapter: layout.adapter,
      builtins: layout.builtins, factoryExport: handoff.module.factoryExport, options: handoff.module.options, rows, documents,
      jobs: cohort.controls.filter(control => control.kind === 'case').map(control => control.job) };
    const jobFile = path.join(destination, `${label}.json`); await writeNew(jobFile, job); const identity = await fingerprint(jobFile);
    const reads = [...seal.files.map(entry => path.join(ROOT, entry.path)), path.join(ROOT, 'RECIPE-SEAL.json'), ...seal.helpers.map(entry => path.join(ROOT, entry.path)), ...seal.tools.map(entry => entry.path), jobFile, admitted.authority.path, root];
    const args = ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw', ...reads.map(name => `--allow-fs-read=${name}`), path.join(ROOT, 'worker.mjs'), jobFile, String(identity.bytes), identity.sha256];
    const receipt = await supervise({ executable: process.execPath, args, cwd: root, directory: path.join(destination, `run-${label}`), timeoutMs: 60000, rawBytes: 16 * 1024 * 1024, kind: label });
    results.push({ label, ...receipt });
    await verifyTree(root, layout.entries); await verifyTree(handoff.artifactRoot, handoff.selected); await verifyRecipe();
    if (!receipt.reaped) break;
  }
  const result = { candidate: handoff.candidate.commit, results, exitCode: results.length !== 2 || results.some(result => result.code !== 0 || result.overflow || result.timeout) ? 1 : 0,
    scope: 'DIFFERENT_MODULE_REVIEW_NOT_FULL_PACKAGE_OR_SUPERIORITY', fullDefaultResourceGate: false };
  await writeNew(path.join(destination, 'RESULT.json'), result); return result;
}

export async function runSelectedBuild(recipeCommit, args) {
  const admitted = await admit(recipeCommit, args);
  const { handoff } = admitted;
  assert.ok(handoff.build.execution && handoff.build.execution.compiler && handoff.build.execution.argv);
  const compiler = handoff.selected.find(entry => entry.path === handoff.build.execution.compiler && entry.role === 'tool');
  assert.ok(compiler, 'selected actual compiler entry');
  const output = path.join(ROOT, `build-${handoff.candidate.commit}`); const grant = await freshGrant(output);
  const reads = handoff.selected.map(entry => path.join(handoff.artifactRoot, entry.path));
  validateGrant(grant, reads);
  const argv = handoff.build.execution.argv.map(token => token === '$OWNED_EMISSION' ? output : token);
  assert.ok(argv.every(token => typeof token === 'string' && !token.includes('$OWNED_EMISSION')));
  const compilerArgs = ['--permission', '--disallow-code-generation-from-strings', ...reads.map(name => `--allow-fs-read=${name}`), `--allow-fs-write=${output}`,
    path.join(handoff.artifactRoot, compiler.path), ...argv];
  const directory = path.join(ROOT, `build-receipt-${handoff.candidate.commit}`);
  const receipt = await supervise({ executable: process.execPath, args: compilerArgs, cwd: handoff.artifactRoot, directory, timeoutMs: 60000, rawBytes: 16384, kind: 'FUTURE_ACTUAL_SELECTED_COMPILER' });
  await verifyTree(handoff.artifactRoot, handoff.selected); await verifyRecipe();
  if (receipt.code === 0 && !receipt.overflow && !receipt.timeout) {
    const outputs = await exactJson(path.join(handoff.artifactRoot, handoff.build.outputManifest.path), handoff.build.outputManifest);
    await verifyTree(output, outputs);
  }
  return { receipt, emission: grant, exitCode: receipt.code === 0 && !receipt.overflow && !receipt.timeout ? 0 : 1, runtimeAcceptance: false };
}
