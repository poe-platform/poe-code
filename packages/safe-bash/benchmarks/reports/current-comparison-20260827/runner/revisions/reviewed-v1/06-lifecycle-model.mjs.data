export const expandedCaps = Object.freeze({
  startupMs: 15000, guestMs: 5000, requestMs: 10000,
  settlementMs: 1000, snapshotMs: 1000, disposeMs: 1000, naturalCloseMs: 1000,
  termGraceMs: 1000, killCloseMs: 1000, watchdogSlackMs: 1000,
  parentTotalMs: 28000, maxOutputBytes: 4 * 1024 * 1024,
  maxSnapshotBytes: 32 * 1024 * 1024, maxDiagnosticBytes: 65536,
  maxReportBytes: 64 * 1024 * 1024, maxEvents: 4096,
});

export function auditLifecycle(events, caps = expandedCaps) {
  const failures = [];
  const phaseNames = ["launch", "ready", "request-start", "exec-start", "guest-result", "exec-settled", "snapshot-complete", "dispose-start", "dispose-settled", "ipc-disconnected", "child-exit", "stdio-close", "resource-census"];
  const failureNames = ["cancel", "term", "kill", "late-promise", "unhandled-rejection", "worker-leak", "watchdog-expired", "capture-overflow", "engine-error"];
  const phases = new Map();
  const allowedNames = new Set([...phaseNames, ...failureNames]);
  if (!Array.isArray(events) || events.length > caps.maxEvents) return { status: "MODEL_FAIL", failures: ["event array/count"], realProcessEvidence: false };
  let previousTime = -1;
  let previousPhase = -1;
  for (const event of events) {
    if (!event || !allowedNames.has(event.type) || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs < previousTime) {
      failures.push("unknown event or nonmonotonic mock clock");
      continue;
    }
    previousTime = event.atMs;
    if (failureNames.includes(event.type)) failures.push(`sticky failure: ${event.type}`);
    const index = phaseNames.indexOf(event.type);
    if (index >= 0) {
      if (index <= previousPhase || phases.has(event.type)) failures.push(`duplicate/out-of-order phase: ${event.type}`);
      previousPhase = index;
      phases.set(event.type, event);
    }
  }
  for (const phase of phaseNames) if (!phases.has(phase)) failures.push(`missing phase: ${phase}`);
  const withinDeadline = (start, end, limit) => {
    if (phases.has(start) && phases.has(end) && phases.get(end).atMs - phases.get(start).atMs > limit) failures.push(`deadline: ${start} -> ${end}`);
  };
  if (phases.has("launch") && phases.get("launch").atMs !== 0) failures.push("launch must anchor the mock clock");
  withinDeadline("launch", "ready", caps.startupMs);
  withinDeadline("exec-start", "guest-result", caps.guestMs);
  withinDeadline("guest-result", "exec-settled", caps.settlementMs);
  withinDeadline("exec-settled", "snapshot-complete", caps.snapshotMs);
  withinDeadline("snapshot-complete", "dispose-start", 0);
  withinDeadline("dispose-start", "dispose-settled", caps.disposeMs);
  withinDeadline("dispose-settled", "resource-census", caps.naturalCloseMs);
  withinDeadline("request-start", "resource-census", caps.requestMs);
  withinDeadline("launch", "resource-census", caps.parentTotalMs);
  if (phases.has("child-exit")) {
    const exit = phases.get("child-exit");
    if (exit.code !== 0 || exit.signal !== null || exit.forced !== false) failures.push("child did not close naturally with exit 0");
  }
  if (phases.has("guest-result")) {
    const result = phases.get("guest-result");
    if (result.observationComplete !== true || result.assertionsMatch !== true) failures.push("guest observation missing or failing");
    for (const [field, cap] of [["outputBytes", caps.maxOutputBytes], ["snapshotBytes", caps.maxSnapshotBytes], ["diagnosticBytes", caps.maxDiagnosticBytes], ["reportBytes", caps.maxReportBytes]]) {
      if (!Number.isSafeInteger(result[field]) || result[field] < 0 || result[field] > cap) failures.push(`capture limit/unknown: ${field}`);
    }
  }
  if (phases.has("resource-census")) {
    const census = phases.get("resource-census");
    if (census.complete !== true || census.children !== 0 || census.workers !== 0 || census.sockets !== 0 || census.unsettledPromises !== 0) failures.push("owned resource census incomplete or leaked");
  }
  return { status: failures.length ? "MODEL_FAIL" : "MODEL_CLEAN", failures, realProcessEvidence: false };
}

export function fallbackSchedule(failureAtMs, launchAtMs = 0, caps = expandedCaps) {
  if (!Number.isSafeInteger(failureAtMs) || !Number.isSafeInteger(launchAtMs) || launchAtMs < 0 || failureAtMs < launchAtMs) throw new Error("Invalid mock clock");
  const watchdogAtMs = launchAtMs + caps.parentTotalMs;
  const termAtMs = Math.min(failureAtMs, watchdogAtMs);
  const killAtMs = Math.min(termAtMs + caps.termGraceMs, watchdogAtMs);
  return {
    termAtMs, killAtMs, stopWaitingAtMs: Math.min(killAtMs + caps.killCloseMs, watchdogAtMs),
    watchdogAtMs, watchdogAlreadyExpired: failureAtMs > watchdogAtMs,
    outcomeAfterFallback: "FAIL_NOT_CLEANED_PASS", realSignalsSent: 0,
  };
}
