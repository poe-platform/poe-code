import { createObserver } from './observer.mjs';
import { assess, reason } from './common.mjs';
import { installOffline } from '../../../executor-v3/offline.mjs';

export async function guardedOperation({ view, configuration, body, emit }) {
  const observer = createObserver(configuration);
  let offline, result, primary, primaryPresent = false;
  const cleanup = [];
  try {
    offline = installOffline(view, event => emit({ event: 'outer-offline', ...event }));
    observer.install();
    result = await body(observer.Worker, observer);
  } catch (error) { primaryPresent = true; primary = error; observer.fail('body', error); }
  finally {
    try { await observer.close(); } catch (error) { cleanup.push({ phase: 'observer-close', reason: reason(error) }); }
    try { offline?.close(); } catch (error) { cleanup.push({ phase: 'offline-close', reason: reason(error) }); }
  }
  const receipt = observer.receipt();
  const inheritedOffline = offline?.receipt() ?? null;
  let assessment;
  try { assessment = assess(receipt, { entry: configuration.entry, members: configuration.members, maximumStarts: configuration.maximumStarts, operation: configuration.operation }); } catch (error) { assessment = { qualified: false, schemaError: reason(error) }; }
  assessment.qualified &&= cleanup.length === 0 && inheritedOffline?.pending === 0 && inheritedOffline?.descriptors === 0 && inheritedOffline?.violations.length === 0;
  return { schema: 'BREADTH_REGEX_OPERATION_V1', result, primaryPresent, primary: reason(primary), rawPrimary: primary, receipt, assessment, cleanup, journals: observer.journalReferences(), knownRetired: receipt.closed && receipt.rows.every(row => row.exited), inheritedOffline };
}
