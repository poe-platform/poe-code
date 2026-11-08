import { describeFailures } from './event-writer.mjs';

export async function finalizeCell({ failures, actions, writer, audit, id, workers }) {
  let cleanupFailed = false;
  for (const action of actions) {
    try { await action.run(); }
    catch (reason) { cleanupFailed = true; failures.record(reason, action.phase); }
  }
  const result = () => ({ event: 'result', id, status: failures.snapshot().present ? 'FAIL' : 'PASS', retired: !cleanupFailed, failure: describeFailures(failures.snapshot()), workers });
  if (writer) {
    try { writer.emit(result()); }
    catch (reason) { failures.record(reason, 'event-terminal'); }
    try { writer.close(); }
    catch (reason) { cleanupFailed = true; failures.record(reason, 'event-close'); }
  }
  try { audit.emit({ event: 'cell-final', id, status: failures.snapshot().present ? 'FAIL' : 'PASS', retired: !cleanupFailed, failure: describeFailures(failures.snapshot()), eventWriter: writer?.snapshot() ?? null }); }
  catch (reason) { failures.record(reason, 'final-audit'); }
  return { exitCode: failures.snapshot().present ? 1 : 0, retired: !cleanupFailed, failures: failures.snapshot() };
}
