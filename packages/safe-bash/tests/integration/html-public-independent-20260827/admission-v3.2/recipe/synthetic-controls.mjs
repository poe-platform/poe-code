import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { json, readJson } from "./telemetry.mjs";
import { terminalPredicate } from "./terminal-predicate.mjs";

function syntheticRecord(signal) {
  const token = "11111111-1111-4111-8111-111111111111";
  const status = signal ? null : 1;
  const caller = { token, control: "consumer-failure", consumerPid: 101, producerPid: 102, chunks: 16, code: "V3_CONSUMER_FAILURE", message: "CONTROL_BOUNDARY:V3_CONSUMER_FAILURE" };
  const terminal = { status, signal, stderr: "synthetic Error: write EPIPE; NOT historical evidence", timedOut: false, stderrOverflow: false };
  const events = [
    { type: "producer-spawn" }, { type: "caller-failure", ...caller },
    { type: "consumer-pipe-close", destroyed: true },
    { type: "producer-exit", status, signal }, { type: "producer-close", status, signal },
    { type: "core-settled", stdoutDestroyed: true },
  ].map((event, index) => ({ sequence: index + 1, ...event }));
  return {
    synthetic: true, control: "consumer-failure", pid: 101, producerPid: 102,
    started: "2026-08-27T00:00:00.000Z", harnessSettlementAt: "2026-08-27T00:00:00.010Z",
    code: 17, signal: null, closeObserved: true, consumerState: { pid: 101, state: "absent" }, producerState: { pid: 102, state: "absent" },
    membersAtClose: [], remainingGroupMembers: [], signalsSent: [], unexpected: [],
    forwardedFailureCode: caller.code, forwardedFailureMessage: caller.message,
    consumer: { value: {
      pid: 101, failure: { code: caller.code, message: caller.message, process: terminal }, flow: { chunks: 16 },
      consumerObservation: { token, consumerPid: 101, producerPid: 102, caller, sameFailureObject: true, producerAtSettlement: "absent", events, spawn: { pid: 102, consumerPid: 101, stdio: ["ignore", "pipe", "pipe"] } },
    } },
    producer: { value: { pid: 102, ppid: 101, status, signal, uncaught: signal ? null : {
      event: "uncaughtExceptionMonitor", pid: 102, ppid: 101, token, origin: "uncaughtException",
      error: { name: "Error", code: "EPIPE", syscall: "write", errno: -32 },
      stdoutErrorMonitorObserved: true, stdoutErrorSameObject: true, stdoutDestroyed: false, stdoutFd: 1, caller: structuredClone(caller), callerReadError: null,
    } } },
  };
}

export function runSyntheticControls(output, policy) {
  const cases = readJson(fileURLToPath(new URL("./SYNTHETIC-CASES.json", import.meta.url)));
  const inputs = cases.map(control => {
    const record = syntheticRecord(control.base === "SIGTERM" ? "SIGTERM" : null);
    for (const [path, value] of control.changes ?? []) {
      const parts = path.split(".");
      let target = record;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = value;
    }
    return { ...control, record };
  });
  json(join(output, "SYNTHETIC-INPUTS.json"), { synthetic: true, note: "Invented predicate inputs only; no process, historical or runtime proof", inputs });
  const rows = [];
  for (const input of inputs) {
    const actual = terminalPredicate(input.record, policy);
    rows.push({ name: input.name, expectedAccepted: input.accepted, expectedReason: input.reason, actual, expectedOutcome: actual.accepted === input.accepted && actual.reason === input.reason });
    if (!rows.at(-1).expectedOutcome) break;
  }
  const result = { synthetic: true, declared: cases.length, executed: rows.length, expectedOutcomes: rows.filter(row => row.expectedOutcome).length, unexecuted: cases.slice(rows.length).map(row => row.name), allExpected: rows.length === cases.length && rows.every(row => row.expectedOutcome), rows };
  json(join(output, "SYNTHETIC-RESULTS.json"), result);
  return result;
}
