import fs from 'node:fs/promises';
import path from 'node:path';
import { demand, regular, under, sha256, writeExclusive } from './primitives.mjs';
import { materializeFiles, packageGuard, movedGuard } from './materialize.mjs';

export function loadedControls(state, packageMap) {
  const groups = new Map();
  const stocks = new Map();
  const originalRows = packageMap.files;
  async function decoded(mutant) {
    const encoded = (await regular(under(state.harnessRoot, mutant.postimage.path), mutant.postimage)).body;
    const body = Buffer.from(encoded.toString('utf8').trim(), 'base64');
    demand(body.length === mutant.decoded.bytes && sha256(body) === mutant.decoded.sha256, 'LOADED_POSTIMAGE');
    return body;
  }
  async function trace(receipt, root, target, expected) {
    const streams = receipt.child.raw.filter(row => row.stream === 'stderr');
    const parts = [];
    for (const row of streams) parts.push((await regular(under(state.root, row.path), { ...row, mode: 0o600 })).body);
    const text = Buffer.concat(parts).toString('utf8');
    const rows = text.split('\n').filter(line => line.startsWith('{"role":"M1B_ACTUAL_MODULE_LOAD",')).map(line => JSON.parse(line));
    demand(rows.some(row => row.role === 'M1B_ACTUAL_MODULE_LOAD' && row.path === under(root, target) && row.sha256 === expected), 'ACTUAL_LOADED_ENTRY_REQUIRED');
    await state.budget.record('actual-loaded-entry-proof', { batch: receipt.batch, root, target, sha256: expected, stderr: streams, proofRole: 'ACTUAL_LOADER_RETURNED_ENROLLED_BODY_NOT_HASH_DENIAL' });
  }
  return {
    async prepare(batch, ordinaryRoot) {
      const control = batch.control;
      if (control === null) return { root: ordinaryRoot, control: null };
      if (control.stage === 'STOCK') return { root: ordinaryRoot, control };
      const key = batch.layout + ':' + control.group;
      const mutant = state.recipe.mutants.find(row => row.id === control.group);
      demand(mutant, 'LOADED_TRANSFORM_SELECTION');
      if (control.stage === 'MUTANT') {
        if (stocks.get(key) !== true) return { unrun: 'SAME_LAYOUT_STOCK_NOT_PASS', control, key };
        demand(!groups.has(key) && state.budget.active.size === 0, 'MUTANT_REAP_AND_SINGLE_ROOT');
        const target = originalRows.find(row => row.path === mutant.target);
        demand(target?.sha256 === mutant.preimageSha256, 'LOADED_PREIMAGE');
        const replacement = await decoded(mutant);
        const rows = originalRows.map(row => row.path === mutant.target ? { ...row, bytes: replacement.length, sha256: sha256(replacement) } : row);
        const staging = path.join(state.root, 'mutants', batch.layout + '-' + control.group + '-staging');
        const root = path.join(state.root, 'mutants', batch.layout + '-' + control.group);
        await packageGuard(ordinaryRoot, originalRows);
        const bytes = rows.reduce((total, row) => total + row.bytes, 0);
        demand(bytes <= 8388608, 'ISOLATED_PACKAGE_GRANT');
        state.budget.reserveWork(8388608 - bytes);
        await materializeFiles(staging, rows, row => row.path === mutant.target ? replacement : regular(under(ordinaryRoot, row.path), row).then(value => value.body), state.budget);
        await packageGuard(staging, rows);
        await fs.rename(staging, root);
        await movedGuard(staging, root, rows);
        const group = { root, rows, mutant, stage: 'MUTANT', mutantPassed: false, grant: 8388608 };
        groups.set(key, group);
        await state.budget.record('loaded-isolated-projection', { batch: batch.id, layout: batch.layout, origin: ordinaryRoot, stagingNowAbsent: staging, physicalRoot: root, physicallyMovedBeforeInvocation: true, files: rows.length, target: mutant.target, preimage: target.sha256, postimage: mutant.decoded.sha256 });
        return { root, control, key, mutant };
      }
      demand(control.stage === 'RESTORE', 'LOADED_STAGE');
      const group = groups.get(key);
      if (!group) return { unrun: 'MUTANT_NOT_ADMITTED', control, key };
      demand(group.stage === 'MUTANT_REAPED' && state.budget.active.size === 0 && state.budget.unsafe === null, 'RESTORE_KNOWN_REAP');
      await packageGuard(group.root, group.rows);
      const original = originalRows.find(row => row.path === mutant.target);
      const body = (await regular(under(ordinaryRoot, original.path), original)).body;
      const filename = under(group.root, original.path);
      const handle = await fs.open(filename, 'r+');
      try { await handle.writeFile(body); await handle.truncate(body.length); await handle.chmod(original.mode); await handle.sync(); }
      finally { await handle.close(); }
      group.rows = originalRows;
      group.stage = 'RESTORED';
      await packageGuard(group.root, originalRows);
      await state.budget.record('same-root-restoration', { batch: batch.id, physicalRoot: group.root, target: original.path, mode: original.mode, bytes: original.bytes, sha256: original.sha256, knownPriorMutantRetirement: true, newWorkerRequired: true });
      return { root: group.root, control, key, mutant };
    },
    async complete(batch, prepared, receipt) {
      if (prepared.control === null) return;
      const { control, key, mutant } = prepared;
      if (control.stage === 'STOCK') {
        for (const member of control.members) {
          const entry = state.recipe.mutants.find(row => row.id === member.group);
          demand(entry, 'STOCK_TRANSFORM');
          await trace(receipt, prepared.root, entry.target, entry.preimageSha256);
          stocks.set(batch.layout + ':' + member.group, receipt.completed.some(row => row.id === member.caseId && row.status === 'PASS'));
        }
        return;
      }
      const passed = receipt.completed.length === batch.ids.length && receipt.completed.every(row => row.status === 'PASS') && receipt.child.code === 0;
      const expected = control.stage === 'MUTANT' ? mutant.decoded.sha256 : mutant.preimageSha256;
      await trace(receipt, prepared.root, mutant.target, expected);
      const group = groups.get(key);
      demand(group && receipt.child.closed && state.budget.active.size === 0 && state.budget.unsafe === null, 'LOADED_RETIREMENT');
      await packageGuard(group.root, group.rows);
      if (control.stage === 'MUTANT') { group.stage = 'MUTANT_REAPED'; group.mutantPassed = passed; return; }
      await state.budget.record('loaded-cycle', { layout: batch.layout, transform: control.group, physicalRoot: group.root, stockPassed: stocks.get(key) === true, mutantPassed: group.mutantPassed, restorationPassed: passed, restoredKillCycle: stocks.get(key) === true && group.mutantPassed && passed, qualification: 'Dedicated loaded behavior witness, not ordinary stock pass or hash/import-denial credit.' });
      await fs.rm(group.root, { recursive: true });
      demand(await fs.lstat(group.root).then(() => false, error => error.code === 'ENOENT'), 'CONTROL_DELETE_BARRIER');
      state.budget.releaseDeletedWork(group.grant);
      groups.delete(key);
    },
    async guardRemaining() { for (const group of groups.values()) await packageGuard(group.root, group.rows); }
  };
}
