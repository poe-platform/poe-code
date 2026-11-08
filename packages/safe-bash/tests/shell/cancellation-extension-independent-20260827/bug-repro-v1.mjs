import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const { createRootCancellationLink, prepareChildCancellation, activateChildCancellation, subscribeCancellation,
  selectCancellationOutcome, selectRuntimeCancellationOutcome } = await import(pathToFileURL(process.env.CANCELLATION_MODULE).href);
const bounds = depth => ({ depth, maxDepth: 8, resourceLimit: 24 });
const thrown = (reason, report) => ({ kind: 'throw', reason, report });
test('B01 post-freeze diagnostic expansion of failing frozen E07, not a new independent family', () => {
  const rows = [];
  for (const role of ['budget-control', 'pipeline-control']) {
    const caller = new AbortController();
    const outerSignal = new AbortController();
    const control = new AbortController();
    const local = new AbortController();
    const root = createRootCancellationLink({ callerSignal: caller.signal, admission: bounds(0) });
    const outer = activateChildCancellation(prepareChildCancellation(root, { signal: outerSignal.signal }, bounds(1)));
    const stage = activateChildCancellation(prepareChildCancellation(outer, undefined, bounds(2), [{ role, signal: control.signal }]));
    const inner = activateChildCancellation(prepareChildCancellation(stage, { signal: local.signal }, bounds(3)));
    try {
      let origin;
      subscribeCancellation(inner, observed => { origin ??= observed; });
      control.abort('control-failure');
      const report = selectRuntimeCancellationOutcome(inner, thrown('control-failure'), origin).report;
      assert.ok(report);
      outerSignal.abort('outer-cancel');
      const cases = [
        ['runtime-observed', selectRuntimeCancellationOutcome(inner, thrown('control-failure'), origin), 'control-failure'],
        ['runtime-reported', selectRuntimeCancellationOutcome(stage, thrown('control-failure', report)), 'control-failure'],
        ['runtime-unproven', selectRuntimeCancellationOutcome(inner, thrown('control-failure')), 'control-failure'],
        ['accepted-stage1', selectCancellationOutcome(inner, thrown('control-failure')), 'control-failure'],
      ];
      caller.abort('root-cancel');
      cases.push(['actual-root', selectRuntimeCancellationOutcome(inner, thrown('control-failure'), origin), 'root-cancel']);
      for (const [route, selection, expected] of cases) {
        rows.push({ role, route, kind: selection.outcome.kind, actual: selection.outcome.reason, expected, reportRole: selection.report?.origin.role ?? null });
      }
    } finally { inner.close(); stage.close(); outer.close(); root.close(); }
  }
  console.log(JSON.stringify({ pinnedE07Diagnostic: rows }));
  assert.deepEqual(rows.filter(row => row.actual !== row.expected || row.kind !== 'throw'), [], 'authenticated control failures must not become invoke cancellation');
});
