import { BASE, IDS, exact, need, failureState, ownedRoot, ownValue } from './finite.mjs';
import { acceptH11 } from './account.mjs';
import { admitRecipe } from './recipe.mjs';

export function guardCensus(actual, expected) {
  exact(actual, expected, 'append-aware source/tool/profile/fixture path-type-mode-length-hash census');
}
export function publication(actual, root, name) {
  ownedRoot(root);
  need(['terminal.json', 'failure.json'].includes(name), 'reserved terminal publication only');
  exact(actual, { path: `${root}/capture/${name}`, resolvedPath: `${root}/capture/${name}`, exclusive: true, regular: true, nlink: 1, mode: 0o600, owned: true, closed: true, fsynced: true, noSymlinkAncestors: true }, 'exclusive owned durable publication');
}
export async function collectSix(recipes, records, nativeAdapter, host, ledger) {
  need(host.mode === 'SYNTHETIC_ONLY', 'collector has no real host implementation');
  exact(recipes.map(recipe => ownValue(recipe, 'id')), IDS, 'six original workflows; no version probe');
  const failures = failureState(), assertions = [], outcomes = [];
  const packet = { schema: 'git-native-bridge-v4-synthetic' };
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= Promise.resolve().then(() => host.cleanup(ledger.children));
  try {
    for (const recipe of recipes) {
      admitRecipe(recipe, records); ledger.begin(recipe.id);
      const expected = await host.expectedCensus(recipe);
      guardCensus(await host.census(recipe, 'pre'), expected);
      let receipt, beforeFailure = false;
      try {
        await nativeAdapter.revalidate(packet);
        receipt = await nativeAdapter.runH11(recipe, packet);
        acceptH11(receipt);
      } catch (reason) { failures.record(reason); beforeFailure = true; }
      try { ledger.finish(); } catch (reason) { failures.record(reason); }
      try { guardCensus(await host.census(recipe, 'post'), expected); } catch (reason) { failures.record(reason); }
      if (failures.hasFailure || beforeFailure) break;
      const row = records.workflows.find(item => item.id === recipe.id);
      const raw = await host.capture(recipe);
      try { exact(raw, { stdoutBase64: row.stdoutBase64, stderrBase64: row.stderrBase64 }, 'ordinary exact observation after trusted closure'); }
      catch (reason) { assertions.push({ id: recipe.id, reason }); }
      outcomes.push({ id: recipe.id, recipe, receipt, raw });
    }
  } catch (reason) { failures.record(reason); }
  try { await cleanup(); } catch (reason) { failures.record(reason); }
  try { ledger.closure(); ledger.failure.throwIfFailed(); } catch (reason) { failures.record(reason); }
  const terminal = { schema: 'git-native-collector-v4-synthetic', exitCode: failures.hasFailure || assertions.length ? 1 : 0, outcomes, assertions, hasFailure: failures.hasFailure, primary: failures.primary, secondary: failures.secondary, resources: ledger.receipt(), actualNative: 'SIX_UNRUN', evidenceRoot: `${BASE}/owned/os-review-01` };
  try {
    ledger.check();
    publication(await host.persist(terminal), terminal.evidenceRoot, 'terminal.json');
    ledger.check();
  } catch (reason) { failures.record(reason); terminal.exitCode = 1; }
  if (failures.hasFailure) {
    terminal.hasFailure = true; terminal.primary = failures.primary; terminal.secondary = failures.secondary;
    try { await host.failureReceipt(terminal); } catch (reason) { failures.record(reason); terminal.secondary = failures.secondary; }
    failures.throwIfFailed();
  }
  return terminal;
}
