import { mkdir, open, rename, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { check, relative, verifyTree, regular, fingerprint, CHUNK, REPO, writeNew } from './core.mjs';
import { gitBytes } from './supervisor.mjs';

export const BASE = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function keys(object, expected) { check(object && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort()), 'HANDOFF_KEYS'); }
export async function admit(handoff) {
  check(handoff !== null && handoff !== undefined, 'CANDIDATE_PENDING');
  keys(handoff, ['version', 'authorization', 'candidate', 'scope', 'selected', 'module', 'layouts', 'pack', 'build', 'reviewGaps']);
  check(handoff.version === 1 && handoff.authorization === 'ROOT_AUTHORIZED_DIFFERENT_MODULE_REVIEW', 'AUTHORIZATION');
  check(handoff.reviewGaps.length === 0, 'REVIEW_GAPS_HELD');
  keys(handoff.candidate, ['commit', 'tree', 'base', 'baseTree', 'allowedDelta']);
  const candidate = handoff.candidate;
  check(candidate.base === BASE && [candidate.commit, candidate.tree, candidate.baseTree].every(fullSha), 'CANDIDATE_IDENTITY');
  check(handoff.scope.registryCount === 77 && handoff.scope.publicXanExport === false && handoff.scope.kind === 'MODULE_ONLY_NOT_PUBLIC_PACKAGE', 'SCOPE');
  check(handoff.scope.registryEvidence && handoff.scope.exportEvidence, 'SCOPE_EVIDENCE_REQUIRED');
  check(Array.isArray(handoff.selected) && handoff.selected.length > 0, 'SELECTED_REQUIRED');
  const all = new Set();
  const roles = new Set();
  for (const entry of handoff.selected) {
    relative(entry.path);
    check(!all.has(entry.path) && ['source', 'build', 'runtime', 'tool'].includes(entry.role), 'SELECTED_ROLE'); all.add(entry.path); roles.add(entry.role);
    check(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/.test(entry.sha256), 'SELECTED_DESCRIPTOR');
    if (entry.role === 'tool') check(typeof entry.origin === 'string' && path.isAbsolute(entry.origin) && ['644', '755'].includes(entry.mode), 'TOOL_DESCRIPTOR');
    else check(['100644', '100755'].includes(entry.gitMode) && fullSha(entry.blob), 'SELECTED_GIT_DESCRIPTOR');
  }
  check(['source', 'build', 'runtime', 'tool'].every(role => roles.has(role)), 'SELECTED_CLOSURE_INCOMPLETE');
  check(Array.isArray(candidate.allowedDelta) && candidate.allowedDelta.length > 0 && new Set(candidate.allowedDelta).size === candidate.allowedDelta.length, 'DELTA_REQUIRED');
  for (const name of candidate.allowedDelta) check(relative(name).startsWith('src/commands/xan/'), 'NON_XAN_DELTA');
  check(handoff.module && all.has(handoff.module.source) && typeof handoff.module.factoryExport === 'string' && handoff.module.factoryExport.length > 0 && handoff.module.shape === 'CommandDefinition', 'API_BINDING_REQUIRED');
  check(handoff.module.apiAuthority && handoff.module.reviewedLoader && handoff.module.workerRequirement === 'none', 'API_REVIEW_REQUIRED');
  check(handoff.build.receipt && handoff.build.inputManifest && handoff.build.outputManifest && handoff.build.compiler && handoff.build.freshEmissionOnly === true, 'BUILD_EVIDENCE_REQUIRED');
  check(handoff.pack.artifact && handoff.pack.manifest && handoff.pack.moduleExports && handoff.pack.scope === 'SELECTED_MODULE_NOT_FULL_PACKAGE', 'PACK_BINDING_REQUIRED');
  check(handoff.layouts.SOURCE && handoff.layouts.INSTALLED_MOVED, 'LAYOUTS_REQUIRED');
  for (const layout of Object.values(handoff.layouts)) {
    check(layout.root && layout.entries && layout.entry && layout.moduleExport && layout.builtins, 'LAYOUT_BINDING_REQUIRED');
    relative(layout.entry);
    check(layout.entries.some(entry => entry.path === layout.entry), 'ENTRY_NOT_SELECTED');
  }
  const trees = (await gitBytes(['rev-parse', `${candidate.commit}^{tree}`, `${BASE}^{tree}`], 82, REPO)).toString().trim().split('\n');
  check(trees[0] === candidate.tree && trees[1] === candidate.baseTree, 'TREE_MISMATCH');
  const delta = (await gitBytes(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', BASE, candidate.commit], 262144, REPO)).toString().split('\0').filter(Boolean).sort();
  check(JSON.stringify(delta) === JSON.stringify([...candidate.allowedDelta].sort()), 'DELTA_MISMATCH');
  for (const entry of handoff.selected.filter(entry => entry.role !== 'tool')) {
    const tree = (await gitBytes(['ls-tree', candidate.commit, '--', entry.path], 2048, REPO)).toString().trim();
    check(tree === `${entry.gitMode} blob ${entry.blob}\t${entry.path}`, 'SELECTED_GIT_IDENTITY', entry.path);
  }
  return { status: 'METADATA_SCREENED_NOT_EXECUTION_ADMITTED', candidate: candidate.commit, fullPackageAccepted: false };
}
export async function physicalMove(layout, parent) {
  await verifyTree(layout.root, layout.entries);
  const stage = path.join(parent, 'installed-original');
  const moved = path.join(parent, 'physically-moved');
  await mkdir(stage, { recursive: false });
  for (const entry of layout.entries) {
    const source = await regular(layout.root, entry.path);
    const destination = path.join(stage, relative(entry.path));
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx', Number.parseInt(entry.mode, 8));
    try {
      for await (const chunk of createReadStream(source, { highWaterMark: CHUNK })) {
        let offset = 0;
        while (offset < chunk.length) { const { bytesWritten } = await handle.write(chunk.subarray(offset)); check(bytesWritten > 0, 'COPY_SHORT'); offset += bytesWritten; }
      }
      await handle.sync();
    } finally { await handle.close(); }
  }
  await verifyTree(stage, layout.entries);
  await rename(stage, moved);
  try { await lstat(stage); check(false, 'ORIGINAL_STILL_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await verifyTree(moved, layout.entries);
  await verifyTree(layout.root, layout.entries);
  await writeNew(path.join(parent, 'MOVE.json'), { original: stage, moved, originalAbsent: true, entries: layout.entries, sourceFallback: false });
  return moved;
}
export async function verifyEvidenceBinding(binding, root) {
  const actual = await fingerprint(await regular(root, binding.path), binding.bytes);
  check(actual.bytes === binding.bytes && actual.sha256 === binding.sha256, 'EVIDENCE_BINDING');
}
