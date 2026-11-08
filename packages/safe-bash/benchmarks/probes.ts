import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { writeText } from "../src/contracts/io.js";
import { createHarness } from "./engines.js";
import type { Engine, Assertion, CaseResult, Probe } from "./model.js";
import { assertionStatus, textBytes } from "./model.js";

function check(name: string, passed: boolean, expected: unknown, actual: unknown): Assertion {
  return { name, status: passed ? "pass" : "fail", expected, actual };
}

export async function runProbe(engine: Engine, probe: Probe): Promise<CaseResult> {
  const startedAt = performance.now();
  const base = { engine, name: probe.name, tier: probe.tier, tags: probe.tags, source: "stress-probe" as const };
  if (probe.name === "streaming-backpressure" && engine === "just-bash") {
    const harness = await createHarness(engine);
    await harness.dispose();
    return { ...base, status: "unsupported", durationMs: 0, assertions: [],
      reason: "Pinned public custom-command API returns buffered stdout and exposes no ByteSink; this probe measures extension API support, not all internal pipeline implementations" };
  }
  const assertions: Assertion[] = [];
  if (probe.name === "cooperative-cancellation") {
    const controller = new AbortController();
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let active = 0;
    let observedAbort = false;
    const harness = await createHarness(engine, {}, {}, { async wait(signal) {
      active++;
      markStarted();
      try { await delay(1000, undefined, signal ? { signal } : {}); }
      finally { observedAbort = signal?.aborted === true; active--; }
    } });
    try {
      const running = harness.execute("bench_wait | cat; printf unexpected > after-cancel.txt", new Uint8Array(), controller.signal);
      const outcome = running.then((result) => ({ resolved: true, exitCode: result.exitCode }),
        (error: unknown) => ({ resolved: false, error: String(error) }));
      await Promise.race([started, delay(1200)]);
      const abortAt = performance.now();
      controller.abort(new Error("benchmark cancellation"));
      const settled = await outcome;
      const elapsed = performance.now() - abortAt;
      await delay(25);
      const snapshot = await harness.snapshot();
      assertions.push(check("host-command-observed-abort", observedAbort, true, observedAbort),
        check("no-active-host-command-after-cancel", active === 0, 0, active),
        check("cancellation-settled-within-250ms", elapsed < 250, "<250ms", elapsed),
        check("cancellation-not-success", !settled.resolved || ("exitCode" in settled && settled.exitCode !== 0), "rejection or nonzero status", settled),
        check("filesystem-unchanged", Object.keys(snapshot.files).length === 0 && snapshot.unsupportedEntries.length === 0, {}, snapshot));
    } finally { controller.abort(); await harness.dispose(); }
  } else {
    const harness = await createHarness(engine);
    try {
      if (probe.name === "concurrent-pipelines") {
        const expectedFiles: Record<string, string> = {};
        const operations = Array.from({ length: 8 }, (_value, index) => {
          const expected = `job-${index}:unique-payload\n`;
          expectedFiles[`job-${index}.txt`] = textBytes(expected);
          return harness.execute(`printf '%s\\n' 'job-${index}:unique-payload' | cat > job-${index}.txt; cat job-${index}.txt`, new Uint8Array())
            .then((result) => check(`pipeline-${index}.bytes-status`, result.stdout === textBytes(expected) && result.stderr === "" && result.exitCode === 0,
              { stdout: textBytes(expected), stderr: "", exitCode: 0 }, result));
        });
        assertions.push(...await Promise.all(operations));
        const snapshot = await harness.snapshot();
        assertions.push(check("concurrent-filesystem-snapshot", JSON.stringify(Object.entries(snapshot.files).sort()) === JSON.stringify(Object.entries(expectedFiles).sort())
          && snapshot.unsupportedEntries.length === 0, expectedFiles, snapshot));
      } else {
        if (!harness.register) throw new Error("Streaming command registration is unavailable");
        let releaseConsumer: () => void = () => {};
        let announceConsumer: () => void = () => {};
        const consumerGate = new Promise<void>((resolve) => { releaseConsumer = resolve; });
        const consumerStarted = new Promise<void>((resolve) => { announceConsumer = resolve; });
        let accepted = 0;
        let consumed = 0;
        let producerFinished = false;
        let consumerBeforeProducerFinished = false;
        let bytesCorrect = true;
        harness.register({ name: "bench_producer", async execute(context) {
          const buffer = new Uint8Array(4096);
          for (let index = 0; index < 64; index++) {
            buffer.fill(index);
            await context.stdout.write(buffer);
            accepted++;
          }
          producerFinished = true;
          return { exitCode: 0 };
        } });
        harness.register({ name: "bench_consumer", async execute(context) {
          for await (const chunk of context.stdin) {
            if (consumed === 0) {
              consumerBeforeProducerFinished = !producerFinished;
              announceConsumer();
              await consumerGate;
            }
            for (const byte of chunk) {
              if (byte !== Math.floor(consumed / 4096)) bytesCorrect = false;
              consumed++;
            }
          }
          await writeText(context.stdout, String(consumed));
          return { exitCode: 0 };
        } });
        const running = harness.execute("bench_producer | bench_consumer", new Uint8Array());
        void running.catch(() => {});
        await consumerStarted;
        await setImmediate();
        await setImmediate();
        const acceptedWhilePaused = accepted;
        releaseConsumer();
        const result = await running;
        assertions.push(check("consumer-starts-before-producer-finishes", consumerBeforeProducerFinished, true, consumerBeforeProducerFinished),
          check("bounded-producer-progress-while-consumer-paused", acceptedWhilePaused <= 4, "<=4 chunks", acceptedWhilePaused),
          check("mutable-chunk-byte-fidelity", bytesCorrect && consumed === 64 * 4096, 64 * 4096, { consumed, bytesCorrect }),
          check("pipeline-output-and-status", result.stdout === textBytes(String(64 * 4096)) && result.stderr === "" && result.exitCode === 0,
            { stdout: textBytes(String(64 * 4096)), stderr: "", exitCode: 0 }, result));
      }
    } finally { await harness.dispose(); }
  }
  return { ...base, status: assertionStatus(assertions), durationMs: performance.now() - startedAt, assertions };
}
