import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileSystem, VirtualShellPlugin } from "../../../src/contracts/index.js";
import type { ShellExecOptions, ShellOptions, ShellResult } from "../../../src/shell/types.js";
import type { NetworkCommandsOptions } from "../../../src/commands/network/types.js";
import { loadEvidence, oracleSha256 } from "./evidence.js";
import { createLab, semanticTrace, type Trace } from "./lab.js";
import { owned, type Observation } from "./native.js";
import { contractRows, rows, seeds, type Row } from "./rows.js";
import { loopbackTransport } from "./transport.js";

interface PublicShell {
  use(plugin: VirtualShellPlugin): PublicShell;
  exec(source: string, options?: ShellExecOptions): Promise<ShellResult>;
  dispose(): Promise<void>;
}

interface PublicApi {
  Shell: new (options: ShellOptions) => PublicShell;
  createMemoryFileSystem(): FileSystem;
  agentCommands(): VirtualShellPlugin;
  [name: string]: unknown;
}

interface Handoff {
  author: "Curie";
  revision: string;
  messageReference: string;
  receivedAt: string;
  pluginExport: string;
}

const evidence = await loadEvidence();
let handoff: Handoff | undefined;
try {
  handoff = JSON.parse(await readFile(join(owned, "handoff.json"), "utf8")) as Handoff;
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function canonical(traces: Trace[]): Trace[] {
  return traces.map((trace) => ({ ...trace, headers: [...trace.headers].sort(([first], [second]) => first.localeCompare(second)) }));
}

async function files(fs: FileSystem): Promise<Record<string, string>> {
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name).sort(), ["work"], "Unexpected VFS writes outside cwd");
  const result: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work${directory}`)) {
      const path = `${directory}/${entry.name}`;
      if (entry.type === "directory") {
        result[`${path.slice(1)}/`] = "directory";
        await walk(path);
      } else {
        assert.equal(entry.type, "file", "Unexpected VFS symlink");
        result[path.slice(1)] = Buffer.from(await fs.readFile(`/work${path}`, { maxBytes: 1024 * 1024 })).toString("base64");
      }
    }
  };
  await walk("");
  return result;
}

async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function verify(api: PublicApi, install: (options: NetworkCommandsOptions) => VirtualShellPlugin, row: Row, expected?: Observation): Promise<Record<string, unknown>> {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  const controller = new AbortController();
  const callerReason = new Error("independent active caller cancellation");
  const fs = api.createMemoryFileSystem();
  let shell: PublicShell | undefined;
  const errors: string[] = [];
  const report: Record<string, unknown> = { id: row.id, class: row.mode ?? (expected ? "native-parity" : "virtual-contract") };
  const authorized: { url: string; method: string; attempt: number }[] = [];
  const started = Date.now();
  const watchdog = setTimeout(() => controller.abort(new Error("Product row watchdog")), 6000);
  try {
    await fs.mkdir("/work");
    for (const [path, data] of Object.entries(seeds)) await fs.writeFile(`/work/${path}`, data);
    shell = new api.Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 2 * 1024 * 1024, pipeHighWaterMark: 1024 } }).use(api.agentCommands());
    if (row.id !== "network-not-ambient") {
      shell.use(install({
        authorize(input) {
          const allowed = row.id !== "authorization-denied" && lab.allow(input.url);
          if (allowed) authorized.push({ url: input.url, method: input.method, attempt: input.attempt });
          return allowed;
        },
        transport: injected.transport,
        limits: { maxTimeMs: 5000, maxRetries: 2, maxRedirects: 5, maxUploadBytes: 1024 * 1024, maxDownloadBytes: 2 * 1024 * 1024 },
      }));
    }
    const args = row.args.map((arg) => lab.expand(arg, "/work"));
    if (row.id === "early-head-stalled") args.splice(args.indexOf("--max-time") + 1, 1, "3");
    const prefix = row.input === undefined ? "" : "cat stdin.bin | ";
    if (row.input !== undefined) await fs.writeFile("/work/stdin.bin", Buffer.from(row.input, "base64"));
    const source = `${row.mode === "head" ? "" : "set -o pipefail; "}${prefix}curl --silent --show-error ${args.map(quote).join(" ")} | ${row.mode === "head" ? "head -c 1" : "cat"}`;
    report.source = lab.normalize(source);
    const emitted: Buffer[] = [];
    let emittedSize = 0;
    const execution = shell.exec(source, { signal: controller.signal, stdout: { async write(chunk) {
      emittedSize += chunk.length;
      assert(emittedSize <= 2 * 1024 * 1024, "Public sink output budget exceeded");
      emitted.push(Buffer.from(chunk));
    } } });
    let result: ShellResult | undefined;
    if (row.mode === "sigint") {
      await within(Promise.race([lab.waitForRequest(), execution.then(() => { throw new Error("Execution completed before active cancellation"); })]), 1500, "No active request to cancel");
      controller.abort(callerReason);
      await assert.rejects(within(execution, 1000, "Caller cancellation did not settle"), (error: unknown) => error === callerReason);
      assert(injected.calls.some((call) => call.signal.aborted), "Caller cancellation not propagated into transport");
      assert.equal(Buffer.concat(emitted).length, 0, "Unexpected output before caller cancellation");
      report.callerAbort = "rejected with supplied reason";
    } else {
      result = await within(execution, row.mode === "head" ? 1000 : 6500, "Product command did not settle within independent deadline");
      report.code = result.exitCode;
      report.stdout = Buffer.from(result.stdoutBytes).toString("base64");
      report.stderr = result.stderr;
    }
    await lab.waitForIdle();
    if (row.input !== undefined) {
      assert.equal(Buffer.from(await fs.readFile("/work/stdin.bin", { maxBytes: 1024 * 1024 })).toString("base64"), row.input, "Pipeline input fixture was modified");
      await fs.rm("/work/stdin.bin");
    }
    const actualFiles = await files(fs);
    const traces = lab.traces.map((trace) => semanticTrace(trace, lab));
    report.files = actualFiles;
    report.traces = traces;
    report.authorized = authorized.map((entry) => ({ ...entry, url: lab.normalize(entry.url) }));
    report.transportCalls = injected.calls.map((entry) => ({ url: lab.normalize(entry.url), method: entry.method, aborted: entry.signal.aborted }));
    assert(injected.calls.every((call, index) => authorized[index]?.url === call.url && authorized[index]?.method === call.method), "Every transport attempt requires matching authorization");
    if (row.mode === "security" || row.id === "authorization-denied") {
      assert(result && result.exitCode !== 0, "Unsafe request must fail");
      assert.match(result.stderr, row.mode === "security" ? /header|newline|invalid|control|CR|LF/i : /denied|authoriz|allow|permit|policy/i);
      assert.equal(injected.calls.length, 0, "Unsafe request reached transport");
      assert.deepEqual(traces, []);
      assert.deepEqual(actualFiles, Object.fromEntries(Object.entries(seeds).map(([path, bytes]) => [path, bytes.toString("base64")])));
    } else if (row.id === "network-not-ambient") {
      assert.equal(result?.exitCode, 127);
      assert.match(result?.stderr ?? "", /curl.*(not found|unknown|not registered)/i);
      assert.deepEqual(traces, []);
      assert.equal(injected.calls.length, 0);
      assert.deepEqual(actualFiles, Object.fromEntries(Object.entries(seeds).map(([path, bytes]) => [path, bytes.toString("base64")])));
    } else {
      assert(expected);
      assert.deepEqual(canonical(traces), canonical(expected.traces), "Request methods, ordered duplicate values, auth, paths, bodies or counts differ");
      assert.deepEqual(actualFiles, expected.files, "VFS byte/namespace effects differ");
      if (row.mode === "head") {
        assert.equal(result?.exitCode, 0);
        assert.equal(report.stdout, Buffer.from("p").toString("base64"));
      } else if (row.mode !== "sigint") {
        assert.equal(result?.exitCode, expected.code, "Curl exit status differs");
        assert.equal(report.stdout, expected.stdout, "Stdout byte vector differs");
        if (row.diagnostic) assert.match(result?.stderr ?? "", new RegExp(row.diagnostic, "i"), "Meaningful diagnostic missing");
        if (expected.code === 0) assert.equal(result?.stderr, "");
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
    report.traces ??= lab.traces.map((trace) => semanticTrace(trace, lab));
    report.transportCalls ??= injected.calls.map((entry) => ({ url: lab.normalize(entry.url), method: entry.method, aborted: entry.signal.aborted }));
    try { report.files ??= await files(fs); }
    catch (snapshotError) { report.fileSnapshotError = String(snapshotError); }
  } finally {
    clearTimeout(watchdog);
    controller.abort(new Error("Independent row cleanup"));
    for (const cleanup of [() => injected.close(), () => shell?.dispose() ?? Promise.resolve(), () => lab.close()]) {
      try { await within(cleanup(), 1000, "Cleanup did not settle"); }
      catch (error) { errors.push(`cleanup: ${String(error)}`); }
    }
  }
  report.elapsedMs = Date.now() - started;
  report.status = errors.length ? "failed" : "passed";
  report.errors = errors;
  return report;
}

if (!handoff || process.env.CURL_VERIFY_AFTER_HANDOFF !== handoff.revision) {
  process.stdout.write(`${JSON.stringify({ status: "gated", handoffObserved: false, oracleSha256, executed: 0, passed: 0, pending: rows.length + contractRows.length, reason: "Require authentic author handoff.json plus CURL_VERIFY_AFTER_HANDOFF matching its revision; no product module imported" })}\n`);
  process.exitCode = 2;
} else {
  assert.equal(handoff.author, "Curie");
  assert.match(handoff.revision, /^[a-f0-9]{40}$/);
  assert(handoff.messageReference.trim().length > 0);
  assert(Number.isFinite(Date.parse(handoff.receivedAt)) && Date.parse(handoff.receivedAt) >= Date.parse(evidence.capturedAt));
  assert.match(handoff.pluginExport, /^[A-Za-z][A-Za-z0-9]*$/);
  const publicEntry = new URL("../../../src/index.ts", import.meta.url).href;
  const api = await import(publicEntry) as PublicApi;
  const install = api[handoff.pluginExport];
  assert.equal(typeof install, "function", "Handoff plugin must exist at the real public root export; no internal fallback");
  const reports: Record<string, unknown>[] = [];
  for (const row of [...rows, ...contractRows.map((id): Row => ({ id, args: ["{A}/echo"] }))]) {
    const report = await verify(api, install as (options: NetworkCommandsOptions) => VirtualShellPlugin, row, evidence.observations.find((entry) => entry.id === row.id));
    reports.push(report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
  const failed = reports.filter((report) => report.status === "failed").length;
  process.stdout.write(`${JSON.stringify({ handoff, oracleSha256, total: reports.length, passed: reports.length - failed, failed, pending: 0, nativeParityRows: 54, independentContractRows: 6 })}\n`);
  process.exitCode = failed ? 1 : 0;
}
