import assert from "node:assert/strict";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import type { HttpTransport } from "../../../src/commands/network/types.js";
import { validateSourceRevision } from "./source-gate.js";

const source = await validateSourceRevision();
const { Shell, ShellLimitError, FsError, agentCommands, networkCommands, createMemoryFileSystem } = await import("../../../src/index.js");
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function bounded<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Retry lifecycle settlement bound exceeded")), 2000); })]); }
  finally { clearTimeout(timer); }
}
const cases = [
  "backpressure", "sink-failure", "caller-cancel", "body-timeout", "partial-stdout", "partial-file",
  "stream-quota", "shell-output-quota", "denied-file-reset", "denied-file-fail", "reset-write-failure",
  "reset-fallback", "sleep-timeout", "sleep-caller-cancel", "stdout-redirection",
] as const;
let failed = 0;
for (const name of cases) {
  const base = createMemoryFileSystem();
  await base.mkdir("/work");
  await base.writeFile("/work/result", Buffer.from("old content"));
  const outputStarted = latch();
  const releaseOutput = latch();
  const reset = latch();
  const controller = new AbortController();
  const reason = new Error("Exact retry caller reason");
  const watchdog = setTimeout(() => controller.abort(new Error("Retry lifecycle watchdog")), 3000);
  const requests: { signal: AbortSignal; body: string }[] = [];
  const authorized: number[] = [];
  const emitted: Buffer[] = [];
  const writes: string[] = [];
  let opened = 0;
  let pulls = 0;
  let returned = 0;
  let disposed = 0;
  let writeStreams = 0;
  const fs: FileSystem = new Proxy(base, {
    get(target, key) {
      if (key === "writeStream") {
        if (name === "reset-fallback") return undefined;
        return async (...args: Parameters<NonNullable<FileSystem["writeStream"]>>) => {
          writeStreams++;
          if (name === "reset-write-failure" && writeStreams === 2) throw new FsError("EACCES", { path: args[0] });
          await target.writeStream!(...args);
          const bytes = Buffer.from(await target.readFile(args[0], { maxBytes: 1024 })).toString();
          writes.push(bytes);
          if (!bytes) reset.release();
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const transport: HttpTransport = async (input) => {
    const body: Buffer[] = [];
    if (input.body) for await (const bytes of input.body) body.push(Buffer.from(bytes));
    requests.push({ signal: input.signal, body: Buffer.concat(body).toString() });
    const attempt = requests.length - 1;
    const bytes: ByteSource = (async function* () {
      opened++;
      try {
        pulls++;
        yield Buffer.from(attempt ? "ok\n" : "first\n");
        if (!attempt && name.startsWith("partial-")) throw new Error("Synthetic response disconnect");
        if (!attempt && ["body-timeout", "caller-cancel"].includes(name)) await releaseOutput.promise;
        if (!attempt && name === "backpressure") { pulls++; yield Buffer.from("tail\n"); }
      } finally { returned++; }
    })();
    return {
      status: attempt ? 200 : 503, statusText: attempt ? "OK" : "Service Unavailable",
      headers: name.startsWith("partial-") ? [["Content-Length", "100"]] : [], body: bytes,
      async dispose() { disposed++; releaseOutput.release(); },
    };
  };
  const fileOutput = ["partial-file", "denied-file-reset", "denied-file-fail", "reset-write-failure", "reset-fallback", "sleep-timeout", "sleep-caller-cancel"].includes(name);
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: name === "shell-output-quota" ? 7 : 1024 * 1024 } }).use(agentCommands()).use(networkCommands({
    transport,
    async authorize(input) {
      assert.equal(input.url, "http://127.0.0.1:1/retry");
      authorized.push(input.attempt);
      if (input.attempt && ["denied-file-reset", "denied-file-fail", "reset-fallback"].includes(name)) {
        assert.equal(Buffer.from(await base.readFile("/work/result", { maxBytes: 1024 })).toString(), name === "denied-file-fail" ? "old content" : "", "File state at next authorization");
      }
      return !input.attempt || !name.startsWith("denied-");
    },
    limits: { maxTimeMs: ["body-timeout", "sleep-timeout"].includes(name) ? 80 : 1500, maxDownloadBytes: name === "stream-quota" ? 5 : 1024 },
  }));
  const command = `curl -sS --retry 1 ${name.startsWith("sleep-") ? "" : "--retry-delay 0.001"} ${fileOutput ? "-o result" : ""} ${name === "denied-file-fail" ? "--fail" : ""} http://127.0.0.1:1/retry${name === "stdout-redirection" ? " > result" : ""}`;
  const errors: string[] = [];
  const report: Record<string, unknown> = { id: name, command };
  const execution = shell.exec(command, { signal: controller.signal, stdout: { async write(chunk) {
    if (name === "sink-failure") throw new FsError("EPIPE");
    emitted.push(Buffer.from(chunk));
    outputStarted.release();
    if (emitted.length === 1 && ["backpressure", "caller-cancel"].includes(name)) await releaseOutput.promise;
  } } });
  void execution.catch(() => {});
  try {
    if (name === "backpressure") {
      await bounded(outputStarted.promise);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(pulls, 1, "Retry body must respect blocked stdout");
      assert.equal(requests.length, 1, "No retry before response publication finishes");
      releaseOutput.release();
    }
    if (["caller-cancel", "sleep-caller-cancel"].includes(name)) {
      await bounded(name === "caller-cancel" ? outputStarted.promise : reset.promise);
      controller.abort(reason);
      await assert.rejects(bounded(execution), (error: unknown) => error === reason);
      report.outwardReasonIdentity = true;
    } else if (name === "shell-output-quota") {
      await assert.rejects(bounded(execution), (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.equal(Buffer.concat(emitted).toString(), "first\n");
      assert.equal(requests.length, 2, "Quota covers both attempts, not per-attempt reset");
      report.shellLimit = "maxOutputBytes";
    } else {
      const result = await bounded(execution);
      const expectedCode = name.startsWith("partial-") ? 18 : name.startsWith("denied-") ? 7
        : ["sink-failure", "reset-write-failure"].includes(name) ? 23 : name === "stream-quota" ? 63
        : name.endsWith("timeout") ? 28 : 0;
      assert.equal(result.exitCode, expectedCode);
      if (expectedCode) assert.match(result.stderr, new RegExp(`curl: \\(${expectedCode}\\)`));
      const expectedText = fileOutput || name === "stdout-redirection" || name === "stream-quota" ? ""
        : name === "backpressure" ? "first\ntail\nok\n" : ["body-timeout", "partial-stdout", "sink-failure"].includes(name) ? "first\n" : "first\nok\n";
      assert.equal(result.stdout, expectedText);
      if (name === "sink-failure") assert.equal(Buffer.concat(emitted).length, 0, "Rejected external sink accepted no bytes despite shell capture");
      Object.assign(report, { code: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    }
    if (fileOutput || name === "stdout-redirection") {
      const bytes = Buffer.from(await base.readFile("/work/result", { maxBytes: 1024 })).toString();
      const expected = ["partial-file", "reset-write-failure"].includes(name) ? "first\n" : name === "reset-fallback" ? "ok\n"
        : name === "denied-file-fail" ? "old content" : name === "stdout-redirection" ? "first\nok\n" : "";
      assert.equal(bytes, expected);
      report.file = bytes;
    }
    if (!["backpressure", "reset-fallback", "stdout-redirection", "shell-output-quota"].includes(name)) assert.equal(requests.length, 1, "Failed, cancelled or denied transfer cannot retry its effects");
    if (["backpressure", "reset-fallback", "stdout-redirection"].includes(name)) assert.deepEqual(authorized, [0, 1]);
    if (name.startsWith("denied-")) assert.deepEqual(authorized, [0, 1]);
    assert.equal(disposed, requests.length, "Each accepted response disposed exactly once");
  } catch (error) { errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
  finally {
    clearTimeout(watchdog);
    releaseOutput.release();
    controller.abort();
    try {
      await bounded(execution.catch(() => {}));
      await bounded(shell.dispose());
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(returned, opened, "Every opened retry body iterator returned");
      assert(requests.every((request) => request.signal.aborted));
    } catch (error) { errors.push(`cleanup: ${String(error)}`); }
  }
  if (errors.length) failed++;
  process.stdout.write(`${JSON.stringify({ ...report, authorized, calls: requests.length, acceptedBodies: requests.map((request) => request.body), emitted: Buffer.concat(emitted).toString(), writes, pulls, opened, returned, disposed, errors, status: errors.length ? "failed" : "passed" })}\n`);
}
assert.deepEqual(await validateSourceRevision(), source);
process.stdout.write(`${JSON.stringify({ source, total: cases.length, passed: cases.length - failed, failed, pending: 0, category: "separate injected lifecycle/security contracts, not native parity" })}\n`);
process.exitCode = failed ? 1 : 0;
