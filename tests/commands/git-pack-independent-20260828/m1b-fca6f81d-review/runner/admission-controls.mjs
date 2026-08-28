import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { demand, sha256, writeExclusive, inventory, guard } from './primitives.mjs';
import { sourceRequests, authenticateSources } from './source-admission.mjs';
import { readArchive } from './archive.mjs';
import { materializeFiles, packageGuard, movedGuard } from './materialize.mjs';
import { enrolledUrl } from './load-policy.mjs';

export async function admissionControls(context) {
  const { budget, root, sourceMap, requests, sourceRaw, archive, packageMap, packageFiles, deadline, verifyOrigins, postimage } = context;
  const results = [];
  async function refusal(id, operation, expected, cleanup = async () => {}) {
    budget.admit(deadline);
    const end = Math.min(deadline, budget.now() + 30000);
    await budget.record(`${id}-begin`, { id, role: 'AUTHENTICATION_NOT_PRODUCT_OR_LOADED_KILL', parentElapsedMs: budget.elapsed(), deadlineOffsetMs: end - budget.origin });
    let rejected = false;
    let message = null;
    try { await operation(); }
    catch (error) { rejected = true; message = error instanceof Error ? error.message : 'NON_ERROR'; }
    await budget.record(`${id}-raw`, { rejected, message });
    await cleanup();
    await verifyOrigins();
    demand(budget.now() <= end && budget.active.size === 0 && budget.unsafe === null, 'GUARD_CONTROL_RETIREMENT_OR_DEADLINE');
    const passed = rejected && message.startsWith(expected);
    results.push({ id, passed, rejected, message, role: 'AUTHENTICATION_ONLY' });
    if (!passed) budget.fail(`${id}:ASSERTION`, rejected);
  }
  const changed = () => structuredClone(sourceMap);
  await refusal('G01-wrong-source-origin', () => {
    const map = changed();
    map.inputs[0].commit = '0000000000000000000000000000000000000000';
    return authenticateSources(map, requests, sourceRaw);
  }, 'SELECTED_ORIGIN');
  await refusal('G02-missing-source-path', () => {
    const map = changed(); map.inputs.pop(); return sourceRequests(map);
  }, 'SOURCE_SCHEMA');
  await refusal('G03-extra-source-path', () => {
    const map = changed(); map.inputs.push({ ...map.inputs[0], path: 'unauthorized.txt' }); return sourceRequests(map);
  }, 'SOURCE_SCHEMA');
  await refusal('G04-package-hash', () => {
    const bytes = Buffer.from(archive); bytes[0] ^= 1; return readArchive(bytes, packageMap);
  }, 'ARCHIVE_IDENTITY');
  async function cloned(id, change, expected = 'FULL_PACKAGE_FILES') {
    const isolated = path.join(root, 'guard-controls', id);
    let reserved = 0;
    await refusal(id, async () => {
      const before = budget.work;
      try { await materializeFiles(isolated, packageMap.files, row => packageFiles.get(row.path).body, budget); }
      finally { reserved = budget.work - before; }
      await packageGuard(isolated, packageMap.files);
      await change(isolated);
      return packageGuard(isolated, packageMap.files);
    }, expected, async () => {
      await fs.rm(isolated, { recursive: true, force: true });
      demand(await fs.lstat(isolated).then(() => false, error => error.code === 'ENOENT'), 'GUARD_DELETE');
      budget.releaseDeletedWork(reserved);
    });
  }
  await cloned('G05-README-absent', isolated => fs.unlink(path.join(isolated, 'README.md')));
  await cloned('G06-README-bytes', isolated => fs.writeFile(path.join(isolated, 'README.md'), Buffer.from('not the admitted README\n')));
  await cloned('G07-mode-or-symlink', isolated => fs.chmod(path.join(isolated, 'README.md'), 0o600));
  await cloned('G08-declaration-tamper', isolated => fs.writeFile(path.join(isolated, 'dist/commands/git/index.d.ts'), Buffer.from('export {};\n')));
  await refusal('G09-import-outside-closure', () => {
    const admitted = path.join(root, 'guard-module.js');
    demand(enrolledUrl(pathToFileURL(admitted).href, undefined, new Map([[admitted, {}]]), new Set()) === pathToFileURL(admitted).href, 'LOAD_POSITIVE_POLICY');
    return enrolledUrl('../not-enrolled.js', pathToFileURL(path.join(root, 'guard-module.js')).href, new Map(), new Set());
  }, 'LOAD_NOT_ENROLLED');
  await refusal('G10-installed-not-moved', () => movedGuard(root, path.join(root, 'does-not-exist'), packageMap.files), 'MOVE_OLD_ABSENCE');
  await cloned('G11-mutant-in-ordinary-root', async isolated => {
    await fs.writeFile(path.join(isolated, 'dist/commands/git/pack.js'), postimage);
  });
  await cloned('G12-postrun-new-entry', async isolated => {
    await writeExclusive(path.join(isolated, 'extra-after-admission.txt'), Buffer.alloc(0));
  });
  await budget.record('authentication-controls', { results, variants: 12, symlinkBranch: 'SOURCE_ONLY_NOT_EXECUTED_G07_USES_MODE', productInvocations: 0, nestedChildren: 0 });
  return results;
}
