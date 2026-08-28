import { exact, need, ownValue, TOOLS, OBSERVER_ARGS, OBSERVER_ENV } from './finite.mjs';
import { admitRecipe } from './recipe.mjs';
import { profileBinding, wrapperRequest, dispatchActual } from './fence.mjs';
import { acceptH11 } from './account.mjs';
import { loadWholeH11 } from './whole-h11.mjs';

export function createNativeBridge(records, host, ledger) {
  need(host.mode === 'SYNTHETIC_ONLY', 'no real host implemented or authorized');
  let prepared = false;
  const usedRoots = new Set();
  return {
    async revalidate(packet) {
      exact(packet, { schema: 'git-native-bridge-v4-synthetic' }, 'inert packet, never GO');
      await host.guard('source-tool-pre');
      prepared = true;
    },
    async runH11(recipe, packet) {
      exact(packet, { schema: 'git-native-bridge-v4-synthetic' });
      admitRecipe(recipe, records);
      need(prepared && !usedRoots.has(recipe.cwd), 'single bound root invocation');
      prepared = false; usedRoots.add(recipe.cwd);
      const root = recipe.cwd.slice(0, -5), profile = profileBinding(root, records), wrapped = wrapperRequest(recipe, profile);
      const expectedSpawn = { cwd: recipe.cwd, env: recipe.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] };
      const bindOwned = role => (identity, handle) => ledger.admit(role, identity, handle);
      const spawn = (executable, args, options) => {
        exact(executable, recipe.executable); exact(args, recipe.args); exact(options, expectedSpawn, 'original request before wrapper insertion');
        let owned;
        const child = host.spawnOwned(wrapped, (identity, handle) => {
          need(!owned, 'single synchronous ownership callback'); owned = bindOwned('target-wrapper')(identity, handle);
        });
        need(owned && owned.handle === child && child.pid === owned.pid, 'wrapper handle bound before return');
        for (const input of [child.stdout, child.stderr]) input.on('data', bytes => {
          try { ledger.charge(owned, bytes.length); }
          catch (reason) { ledger.failure.record(reason); child.kill('SIGKILL'); }
        });
        child.once('close', (status, signal) => ledger.close(owned, status, signal));
        return child;
      };
      const execFileSync = (executable, args, options) => {
        exact(executable, TOOLS.ps, 'no unknown helper exec'); exact(args, OBSERVER_ARGS);
        const timeout = ownValue(options, 'timeout');
        need(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2000, 'H11 observer timeout');
        exact(options, { encoding: 'utf8', timeout, maxBuffer: 8388608 }, 'historical observer request only');
        const request = { executable: TOOLS.ps, args: [...OBSERVER_ARGS], options: { encoding: 'utf8', timeout: Math.min(timeout, ledger.remaining()), maxBuffer: ledger.remainingBytes(), env: { ...OBSERVER_ENV }, stdio: ['ignore', 'pipe', 'pipe'] } };
        need(request.options.timeout > 0 && request.options.maxBuffer > 0, 'observer within shared remaining ceiling');
        let owned;
        const result = host.observeOwned(request, (identity, handle) => {
          need(!owned, 'single observer ownership callback'); owned = bindOwned('observer')(identity, handle);
        }, bytes => ledger.charge(owned, bytes.length), (status, signal) => ledger.close(owned, status, signal));
        need(owned && owned.closed && typeof result === 'string', 'owned observer closed before publication');
        ledger.failure.throwIfFailed();
        return result;
      };
      const source = Buffer.from(records.records.supervisor.base64, 'base64').toString('utf8');
      const bindings = host.h11Bindings({ spawn, execFileSync }, recipe);
      const h11 = await loadWholeH11(source, bindings, host.globals());
      let receipt;
      try {
        receipt = await h11.supervise(recipe.executable, recipe.args, recipe);
        for (const cause of receipt.faultCauses ?? []) ledger.failure.record(cause);
        ledger.failure.throwIfFailed(); acceptH11(receipt);
        exact(receipt.executable, recipe.executable); exact(receipt.args, recipe.args); exact(receipt.cwd, recipe.cwd);
      } catch (reason) {
        if (!ledger.failure.hasFailure || ledger.failure.primary !== reason) ledger.failure.record(reason);
      } finally {
        try { await host.guard('source-tool-post'); } catch (reason) { ledger.failure.record(reason); }
      }
      ledger.failure.throwIfFailed();
      return { ...receipt, actualRole: wrapped, profile, originalH11QualificationDoesNotQualifyWrapper: true };
    },
    dispatchActual,
  };
}
