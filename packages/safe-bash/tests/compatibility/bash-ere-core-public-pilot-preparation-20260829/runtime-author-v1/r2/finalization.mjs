import { ledger, describeLedger } from './core.mjs';

export async function finalizeInvocation({ run, descriptors, close, ownership, retained, ownerRoot, emergency, report }) {
  const failures = ledger();
  ownerRoot.failures = failures.state;
  let result;
  try { result = await run(failures); }
  catch (reason) {
    failures.add(reason, 'coordinator');
    try { await emergency({ event: 'coordinator-stop', failure: describeLedger(failures.state) }); }
    catch (secondary) { failures.add(secondary, 'emergency-publication'); }
  } finally {
    for (const descriptor of descriptors) {
      try { close(descriptor); }
      catch (reason) { failures.add(reason, 'journal-close'); }
    }
    try { if (ownership.every(row => row.receipt.retired === true)) retained.delete(ownerRoot); }
    catch (reason) { failures.add(reason, 'retention-bookkeeping'); }
  }
  if (failures.state.present) {
    try { report({ event: 'coordinator-finalization-failure', failure: describeLedger(failures.state) }); }
    catch (reason) { failures.add(reason, 'outer-failure-publication'); }
    throw failures.state.reason;
  }
  return result;
}
