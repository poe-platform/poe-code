import { setImmediate, setTimeout as delay } from "node:timers/promises";
import { createTextProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { Execution } from "./model.js";

export interface SafetyProbe {
  name: string;
  tool: "sed" | "awk";
  kind: "blocked-input" | "blocked-output" | "early-quit" | "preabort" | "reject-safe" | "output-quota";
  args: string[];
  input?: string;
  options?: TextProgramOptions;
}

export const safetyProbes: SafetyProbe[] = [];
for (const tool of ["sed", "awk"] as const) {
  const args = tool === "sed" ? ["p"] : ["{print}"];
  for (const kind of ["blocked-input", "blocked-output", "preabort"] as const) safetyProbes.push({ name: `${tool}-${kind}`, tool, kind, args, input: "first\nsecond\n" });
}
safetyProbes.push(
  { name: "sed-quit-does-not-wait-for-an-unused-next-record", tool: "sed", kind: "early-quit", args: ["1q"] },
  { name: "awk-exit-does-not-wait-for-an-unused-next-record", tool: "awk", kind: "early-quit", args: ["{print;exit}"] },
  { name: "sed-invalid-inplace-program-preserves-original-and-backup", tool: "sed", kind: "reject-safe", args: ["-i.bak", "p;s/[invalid/x/", "input"] },
  { name: "sed-inplace-step-limit-preserves-original-and-backup", tool: "sed", kind: "reject-safe", args: ["-i.bak", ":again\nb again", "input"], options: { maxSteps: 100 } },
  { name: "sed-inplace-buffer-limit-preserves-original-and-backup", tool: "sed", kind: "reject-safe", args: ["-i.bak", "s/a/aaaaaaaaaaaaaaaa/", "input"], options: { maxBufferBytes: 8 } },
  { name: "sed-hostile-regex-is-budgeted", tool: "sed", kind: "reject-safe", args: ["-E", "s/(a+)+b/X/"], input: "a".repeat(2048), options: { maxSteps: 1000 } },
  { name: "awk-infinite-loop-is-budgeted", tool: "awk", kind: "reject-safe", args: ["BEGIN{while(1)count++}"], options: { maxSteps: 1000 } },
  { name: "awk-recursion-is-budgeted", tool: "awk", kind: "reject-safe", args: ["function f(){return f()} BEGIN{f()}"], options: { maxSteps: 1000 } },
  { name: "awk-large-array-is-budgeted", tool: "awk", kind: "reject-safe", args: ["BEGIN{for(i=0;i<1000000;i++)a[i]=i}"], options: { maxSteps: 1000 } },
  { name: "awk-hostile-regex-is-budgeted", tool: "awk", kind: "reject-safe", args: ["{print ($0 ~ /(a+)+b/)}"], input: "a".repeat(2048), options: { maxSteps: 1000 } },
  { name: "awk-output-buffer-is-budgeted", tool: "awk", kind: "reject-safe", args: ['BEGIN{print sprintf("%1000s","x")}'], options: { maxBufferBytes: 128 } },
  { name: "awk-invalid-program-prevents-file-effects", tool: "awk", kind: "reject-safe", args: ['BEGIN{print "changed" > "input";missing_function()}'] },
  { name: "sed-output-quota-stops-print-loop", tool: "sed", kind: "output-quota", args: [":again\np\nb again"], input: "0123456789\n", options: { maxSteps: 10000 } },
  { name: "awk-output-quota-stops-print-loop", tool: "awk", kind: "output-quota", args: ['BEGIN{while(1)print "0123456789"}'], options: { maxSteps: 10000 } },
);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function runSafety(probe: SafetyProbe): Promise<Execution> {
  const started = performance.now();
  const definition = createTextProgramCommands(probe.options).find(command => command.name === probe.tool);
  if (!definition) return { status: "pending", reason: `${probe.tool} is not delivered`, durationMs: 0 };
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("a\n"));
  await fs.writeFile("/work/input.bak", Buffer.from("preserve existing backup\n"));
  const controller = new AbortController();
  const reason = new Error("independent text cancellation");
  const ready = deferred<void>();
  const pendingRead = deferred<IteratorResult<Uint8Array>>();
  const pendingWrite = deferred<void>();
  let pulls = 0;
  let returned = 0;
  let written = 0;
  let writeAttempts = 0;
  let quotaReached = false;
  let stdout = "";
  let stderr = "";
  const customSource: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      pulls++;
      if (probe.kind === "early-quit" && pulls === 1) return Promise.resolve({ done: false, value: Buffer.from("first\n") });
      ready.resolve();
      return pendingRead.promise;
    },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const context: CommandContext = { command: probe.tool, args: probe.args, fs, cwd: "/work", env: { LC_ALL: "C" }, signal: controller.signal,
    stdin: probe.kind === "blocked-input" || probe.kind === "early-quit" ? customSource : toByteSource(probe.input ?? ""),
    stdout: { async write(bytes) {
      writeAttempts++;
      if (probe.kind === "blocked-output") { ready.resolve(); await pendingWrite.promise; }
      if (probe.kind === "output-quota" && written + bytes.length > 128) { quotaReached = true; throw new Error("independent output quota"); }
      written += bytes.length;
      stdout += Buffer.from(bytes).toString("base64") + ":";
    } },
    stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
  };
  if (probe.kind === "preabort") controller.abort(reason);
  const running = Promise.resolve().then(() => definition.execute(context));
  const outcome = running.then(result => ({ kind: "resolved", exitCode: result.exitCode }), error => ({ kind: error === reason ? "cancelled" : "error", reason: String(error) }));
  let early: unknown;
  if (probe.kind === "blocked-input" || probe.kind === "blocked-output") {
    await ready.promise;
    controller.abort(reason);
    early = await Promise.race([outcome, delay(100).then(() => ({ kind: "timeout" }))]);
    if (probe.kind === "blocked-input") pendingRead.reject(new Error("late rejected read"));
    else pendingWrite.reject(new Error("late rejected write"));
  } else if (probe.kind === "early-quit") {
    early = await Promise.race([outcome, delay(100).then(() => ({ kind: "timeout" }))]);
    pendingRead.resolve({ done: true, value: undefined });
  }
  const settled = await outcome;
  await setImmediate();
  const unchanged = Buffer.from(await fs.readFile("/work/input")).toString() === "a\n"
    && Buffer.from(await fs.readFile("/work/input.bak")).toString() === "preserve existing backup\n"
    && (await fs.readdir("/work")).length === 2;
  const assertions: Record<string, boolean> = { unchanged };
  if (probe.kind === "blocked-input" || probe.kind === "blocked-output") assertions.promptCancellation = (early as { kind: string }).kind === "cancelled";
  else if (probe.kind === "early-quit") { assertions.noUnneededRead = pulls === 1; assertions.earlyCompletion = (early as { kind: string }).kind === "resolved"; assertions.success = settled.kind === "resolved" && "exitCode" in settled && settled.exitCode === 0; }
  else if (probe.kind === "preabort") { assertions.cancelled = settled.kind === "cancelled"; assertions.noOutput = written === 0 && stderr === ""; }
  else { assertions.failure = settled.kind === "resolved" && "exitCode" in settled && settled.exitCode !== 0; }
  if (probe.kind === "reject-safe") assertions.noStdout = written === 0;
  if (probe.kind === "output-quota") { assertions.quotaReached = quotaReached; assertions.boundedOutput = written <= 128; assertions.noRepeatedFailedWrites = writeAttempts <= 13; }
  const details = { probe: probe.name, assertions, early, settled, pulls, returned, written, writeAttempts, stdout, stderr };
  return { status: "completed", observation: { exitCode: Object.values(assertions).every(Boolean) ? 0 : 1, stdout: Buffer.from(JSON.stringify(details)).toString("base64"), stderr: "", files: {} }, durationMs: performance.now() - started };
}
