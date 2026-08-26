import { parentPort, workerData } from "node:worker_threads";
import { createHarness, PendingRuntimeError } from "./engines.js";
import { assertionStatus, compareObservation, taskInfo, type Engine, type Task, type CaseResult } from "./model.js";
import { runProbe } from "./probes.js";

const engine = (workerData as { engine: Engine }).engine;
if (!parentPort) throw new Error("Benchmark worker must run in a Worker thread");
parentPort.on("message", async (message: { id: number; task: Task }) => {
  const start = performance.now();
  const base = { engine, ...taskInfo(message.task) };
  let result: CaseResult;
  try {
    if (message.task.kind === "probe") result = await runProbe(engine, message.task);
    else {
      const fixture = message.task.fixture;
      const harness = await createHarness(engine, fixture.initialFiles, fixture.env);
      try {
        const executionStart = performance.now();
        const observation = { ...await harness.execute(fixture.script, Buffer.from(fixture.stdin, "base64"), AbortSignal.timeout(4500)),
          ...await harness.snapshot() };
        const assertions = compareObservation(fixture, observation);
        result = { ...base, assertions, status: assertionStatus(assertions), durationMs: performance.now() - executionStart,
          details: { configuredCommandNames: harness.commands, configuredPluginNames: harness.plugins ?? [], stdoutCapture: observation.stdoutCapture,
            stderrCapture: observation.stderrCapture } };
      } finally { await harness.dispose(); }
    }
  } catch (error) {
    result = { ...base, status: error instanceof PendingRuntimeError ? "pending" : "error",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error), assertions: [], durationMs: performance.now() - start };
  }
  parentPort!.postMessage({ id: message.id, result });
});
