import fs from 'node:fs';
import path from 'node:path';
import { createEvidenceBudget } from './evidence.mjs';
import { createStore, encode } from './records.mjs';
import { createLedger, launchTracked } from './launch-ledger.mjs';
import { supervise } from './supervisor.mjs';
import { assessTerminal, reason } from './report.mjs';
import { requireThat } from '../executor-v4/safety.mjs';

export const allocation = Object.freeze({ combined: 268435456, coordinator: 260046848, collector: 8388608, record: 262144, stream: 65536 });

export async function observeCoordinator({ node, args, cwd, captureRoot, resultRoot, preflight = () => {}, postflight = () => {}, deadline = 4500000, syntheticOnly = false }) {
  const ledger = createLedger(1);
  let budget;
  let store;
  let receipt;
  let primary;
  let primaryPresent = false;
  const cleanup = [];
  let reference = null;
  let qualified = false;
  const select = (phase, error) => { if (!primaryPresent) { primaryPresent = true; primary = { phase, value: reason(error), undefinedValue: error === undefined }; } else cleanup.push({ phase, value: reason(error), undefinedValue: error === undefined }); };
  try {
    fs.mkdirSync(captureRoot, { mode: 0o755 });
    budget = createEvidenceBudget(captureRoot, { limit: allocation.collector });
    store = createStore(captureRoot, { budget });
    await preflight();
    receipt = await launchTracked({ ledger, kind: 'coordinator',
      prepare: async () => { const launch = store.save('LAUNCH.json', { node, args, cwd, resultRoot, allocation, deadline, grace: { term: 2000, kill: 1000 }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], syntheticPermissionNotImplied: true }); return { configSha: launch.sha256 }; },
      supervise: (_prepared, attach) => supervise(node, args, cwd, { deadline, onSpawn: attach }),
      persist: async (_entry, value) => { reference = store.save('COORDINATOR-RECEIPT.json', value); return reference.sha256; },
    });
    qualified = assessTerminal(receipt, resultRoot, { syntheticOnly });
    if (!qualified) throw Object.assign(new Error('COORDINATOR_NOT_QUALIFIED'), { code: 'COORDINATOR_NOT_QUALIFIED' });
  } catch (error) { select('body', error); }
  finally {
    try { await ledger.closeAll(); } catch (error) { select('cleanup', error); }
    try { await postflight(); } catch (error) { select('postflight', error); }
    try { budget?.audit({ partial: primaryPresent }); } catch (error) { select('evidence', error); }
  }
  let summaryReference = null;
  try {
    const summary = { schema: 'BREADTH_V7_OUTER', qualified: qualified && !primaryPresent, unsafe: primaryPresent, primaryPresent, primary, cleanup, reference, children: ledger.entries, allocation, evidence: budget?.snapshot() ?? null, originalFailureUnchanged: true };
    if (store) summaryReference = store.save('OUTER.json', summary);
    else throw new Error('OUTER_STORE_UNAVAILABLE');
    budget.audit({ partial: primaryPresent });
  } catch (error) { select('summary', error); }
  return { qualified: qualified && !primaryPresent, primaryPresent, primary, cleanup, reference, summaryReference, ledger: ledger.entries, receipt, evidence: budget?.snapshot() ?? null };
}
