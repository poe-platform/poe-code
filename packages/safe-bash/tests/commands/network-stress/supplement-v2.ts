import { validateSourceRevision } from "./source-gate.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { FileSystem, ByteSource } from "../../../src/contracts/index.js";
import type { HttpTransport, NetworkCommandsOptions } from "../../../src/commands/network/types.js";
import { canonicalTrace, supplementaryLab } from "./supplement-lab.js";
import { payload, supplementaryRows, type SupplementRow } from "./supplement-rows.js";

const owned = "tests/commands/network-stress";

type Lab = Awaited<ReturnType<typeof supplementaryLab>>;
type Api = typeof import("../../../src/index.js");
type RecordValue = Record<string, unknown>;
const records: RecordValue[] = [];
const seedFiles = { "binary.bin": payload.toString("base64") };
function quote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
async function bounded<Value>(promise: Promise<Value>, milliseconds = 2000): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Independent supplementary settlement bound exceeded")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolveLatch) => { release = resolveLatch; });
  return { promise, release };
}
async function fileSnapshot(fs: FileSystem) {
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["work"]);
  const files: Record<string, string> = {};
  for (const entry of await fs.readdir("/work")) {
    assert.equal(entry.type, "file");
    files[entry.name] = Buffer.from(await fs.readFile(`/work/${entry.name}`, { maxBytes: 1024 * 1024 })).toString("base64");
  }
  return files;
}

async function product(api: Api, row: SupplementRow, lab: Lab, expected: RecordValue | undefined, report: RecordValue) {
  const fs = api.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/binary.bin", payload);
  const controller = new AbortController();
  const reason = new Error(`Independent ${row.id} caller cancellation`);
  const watchdog = setTimeout(() => controller.abort(new Error("Supplementary row watchdog")), 5000);
  const release = latch();
  const entered = latch();
  const blocked = latch();
  const authorized: RecordValue[] = [];
  const emitted: Buffer[] = [];
  const accepted: Buffer[] = [];
  const callbackSignals: AbortSignal[] = [];
  let sourcePulls = 0;
  let disposed = 0;
  let returned = false;
  let settledLate = false;
  let lateTask: Promise<void> | undefined;
  let transport: HttpTransport | undefined = row.trust ? api.createNodeHttpTransport({ ca: lab.certificate }) : undefined;
  const response = (body: ByteSource) => ({ status: 200, statusText: "OK", headers: [] as const, body, async dispose() { disposed++; } });
  let stdin: ByteSource | undefined;
  if (row.id === "response-backpressure") {
    transport = async (request) => {
      callbackSignals.push(request.signal);
      return response((async function* () { try { for (let index = 0; index < 4; index++) { sourcePulls++; yield payload; } } finally { returned = true; } })());
    };
  }
  if (row.id === "upload-backpressure") {
    stdin = (async function* () { try { for (let index = 0; index < 4; index++) { sourcePulls++; yield payload; } } finally { returned = true; } })();
    transport = async (request) => {
      callbackSignals.push(request.signal);
      assert(request.body);
      for await (const chunk of request.body) { accepted.push(Buffer.from(chunk)); if (accepted.length === 1) { entered.release(); await release.promise; } }
      return response((async function* () { yield Buffer.from("ok\n"); })());
    };
  }
  if (row.id === "default-upload-cancellation") {
    stdin = (async function* () {
      try { sourcePulls++; yield payload; blocked.release(); await release.promise; controller.signal.throwIfAborted(); sourcePulls++; yield payload; }
      finally { returned = true; }
    })();
  }
  if (row.id === "late-transport-rejection") {
    transport = async (request) => {
      callbackSignals.push(request.signal);
      entered.release();
      lateTask = delay(120).then(() => { settledLate = true; });
      await lateTask;
      throw new Error("Host callback deliberately ignores signal then rejects");
    };
  }
  const options: NetworkCommandsOptions = {
    authorize(input) {
      const allowed = lab.allow(input.url) && !(row.id === "redirect-authorization-denial" && input.redirectFrom);
      authorized.push({ url: lab.normalize(input.url), method: input.method, attempt: input.attempt, redirectFrom: input.redirectFrom ? lab.normalize(input.redirectFrom) : null, allowed: Boolean(allowed) });
      return Boolean(allowed);
    },
    ...(transport ? { transport } : {}),
    limits: { maxTimeMs: 3000, maxUploadBytes: 1024 * 1024, maxDownloadBytes: 1024 * 1024 },
  };
  const shell = new api.Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 1024 * 1024, pipeHighWaterMark: 1024 } }).use(api.agentCommands()).use(api.networkCommands(options));
  let execution: ReturnType<typeof shell.exec> | undefined;
  try {
    const source = `curl --silent --show-error ${row.args.map(lab.expand).map(quote).join(" ")}`;
    report.source = lab.normalize(source);
    report.transport = transport ? row.trust ? "public Node transport with fixture CA" : "instrumented host transport" : "default optional transport omitted";
    execution = shell.exec(source, {
      signal: controller.signal,
      ...(stdin ? { stdin } : row.input ? { stdin: payload } : {}),
      stdout: { async write(chunk) {
        emitted.push(Buffer.from(chunk));
        if (row.id === "response-backpressure" && emitted.length === 1) { entered.release(); await release.promise; }
        if (row.id === "default-response-cancellation") controller.abort(reason);
      } },
    });
    const observed = execution.then((result) => ({ result }), (error: unknown) => ({ error }));
    if (["response-backpressure", "upload-backpressure"].includes(row.id)) {
      await bounded(entered.promise);
      const pullsAtBlock = sourcePulls;
      await delay(40);
      assert.equal(sourcePulls, pullsAtBlock, "Producer pulled while consumer was blocked");
      assert.equal(sourcePulls, 1, "Producer read ahead before first blocked consumer");
      report.pullsWhileBlocked = sourcePulls;
      release.release();
    }
    if (row.id === "default-upload-cancellation") {
      await bounded(Promise.all([lab.acceptedUpload, blocked.promise]));
      controller.abort(reason);
      release.release();
    }
    const outcome = await bounded(observed, 4000);
    if (row.id.endsWith("-cancellation")) {
      assert("error" in outcome && outcome.error === reason, "Cancellation must reject with exact caller reason");
      report.callerAbort = "rejected with supplied reason";
      if (row.id === "default-upload-cancellation") {
        assert.deepEqual(Buffer.concat(lab.uploads), payload, "Remote accepted upload prefix is not rollback");
        assert.equal(sourcePulls, 1);
        assert.equal(returned, true);
        assert.equal(emitted.length, 0);
      } else assert.deepEqual(Buffer.concat(emitted), payload);
    } else {
      if ("error" in outcome) throw outcome.error;
      const result = outcome.result;
      report.code = result.exitCode;
      report.stdout = Buffer.from(result.stdoutBytes).toString("base64");
      report.stderr = result.stderr;
      assert.deepEqual(Buffer.concat(emitted), Buffer.from(result.stdoutBytes), "Public byte sink and captured result disagree");
      if (row.kind === "native-parity") {
        assert(expected);
        assert.equal(result.exitCode, expected.code, "Native exit status mismatch");
        assert.equal(report.stdout, expected.stdout, "Native output bytes mismatch");
        assert.deepEqual(await fileSnapshot(fs), expected.files, "Native namespace/byte mismatch");
        assert.deepEqual(lab.traces.map(canonicalTrace), expected.traces, "Native multipart/request bytes mismatch (only boundary normalized)");
        if (result.exitCode === 0) assert.equal(result.stderr, "");
        else assert.match(result.stderr, row.id === "default-tls-untrusted" ? /TLS|certificate|SSL/i : /file|upload|read/i);
      } else if (row.kind === "security") {
        assert.deepEqual(await fileSnapshot(fs), seedFiles);
        if (row.id === "origin-header-permanent-strip") {
          assert.equal(result.exitCode, 0);
          assert.equal(report.stdout, Buffer.from("ok\n").toString("base64"));
          assert.equal(result.stderr, "");
          assert.deepEqual(lab.traces.map((trace) => [trace.origin, trace.path]), [["A", "/cross-return"], ["B", "/return"], ["A", "/echo"]]);
          assert.deepEqual(lab.traces.map((trace) => trace.headers.filter(([name]) => name.toLowerCase() === "x-private")), [[["x-private", "fixture-secret"]], [], []]);
          assert.equal(authorized.length, 3);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.equal(report.stdout, "");
          if (row.id === "redirect-authorization-denial") {
            assert.equal(result.exitCode, 7);
            assert.match(result.stderr, /denied|policy|authoriz/i);
            assert.equal(lab.traces.length, 1);
            assert.deepEqual(authorized.map((entry) => [entry.url, entry.allowed, entry.redirectFrom]), [["{A}/cross", true, null], ["{B}/echo", false, "{A}/cross"]]);
          } else if (row.id === "https-downgrade-rejection") {
            assert.match(result.stderr, /downgrade|HTTPS|insecure/i);
            assert.equal(lab.traces.length, 1);
            assert.equal(lab.traces[0]?.origin, "T");
          } else {
            assert.match(result.stderr, /invalid|control|URL|form|filename/i);
            assert.equal(lab.traces.length, 0);
          }
        }
      } else {
        assert.deepEqual(await fileSnapshot(fs), seedFiles);
        if (row.id === "late-transport-rejection") {
          assert.equal(result.exitCode, 28);
          assert.match(result.stderr, /timed? ?out|timeout/i);
          assert.equal(report.stdout, "");
          assert.equal(settledLate, false, "Runtime waited for ignored host callback");
          assert(callbackSignals[0]?.aborted);
          await bounded(lateTask ?? Promise.resolve());
          await delay(10);
          assert.equal(settledLate, true);
        } else {
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          const expectedBytes = row.id === "response-backpressure" ? Buffer.concat(Array.from({ length: 4 }, () => payload)) : Buffer.from("ok\n");
          assert.deepEqual(Buffer.concat(emitted), expectedBytes);
          if (row.id === "upload-backpressure") assert.deepEqual(Buffer.concat(accepted), Buffer.concat(Array.from({ length: 4 }, () => payload)));
          assert.equal(returned, true);
          assert.equal(disposed, 1);
        }
      }
    }
    await lab.idle();
  } finally {
    clearTimeout(watchdog);
    controller.abort(new Error("Supplementary cleanup"));
    release.release();
    if (execution) await bounded(execution.catch(() => {}));
    if (lateTask) await bounded(lateTask);
    report.files = await fileSnapshot(fs);
    report.traces = lab.traces.map(canonicalTrace);
    report.wireTraces = lab.traces;
    report.authorized = authorized;
    report.emitted = Buffer.concat(emitted).toString("base64");
    report.lifecycle = { sourcePulls, returned, disposed, acceptedBody: Buffer.concat(accepted.length ? accepted : lab.uploads).toString("base64"), settledLate, callbackAborted: callbackSignals.map((signal) => signal.aborted) };
    await bounded(shell.dispose());
  }
}
let expectedRows: RecordValue[] = [];

  const frozen = JSON.parse(await readFile(`${owned}/supplement-native.json`, "utf8")) as { records: RecordValue[]; before: { hashes: Record<string, string> }; exit: { code: number }; networkStable: boolean };
  assert.equal(frozen.exit.code, 0);
  assert(frozen.networkStable);
  for (const path of ["supplement-rows.ts", "supplement-lab.ts"]) {
    const source = `${owned}/${path}`;
    assert.equal(createHash("sha256").update(await readFile(source)).digest("hex"), frozen.before.hashes[source], "Supplement source changed since native freeze");
  }
  expectedRows = frozen.records.filter((record) => typeof record.id === "string");
  assert.equal(process.env.CURL_VERIFY_AFTER_HANDOFF, "deab14d9f4b3b6f0d73f96587c74a9de23091300");
  await validateSourceRevision();
  const api = await import("../../../src/index.js");
  const subpath = await import("../../../src/commands/network/index.js");
  assert.equal(api.networkCommands, subpath.networkCommands);
  assert.equal(api.curlCommands, api.networkCommands);
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { exports: Record<string, unknown>; dependencies?: unknown };
  assert(manifest.exports["./commands/network"]);
  assert.deepEqual(manifest.dependencies ?? {}, {});

for (const row of supplementaryRows) {

  const lab = await supplementaryLab();
  const started = Date.now();
  const report: RecordValue = { id: row.id, kind: row.kind };
  const errors: string[] = [];
  try {
    await product(api!, row, lab, expectedRows.find((entry) => entry.id === row.id), report);
  } catch (error) { errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
  finally { try { await bounded(lab.close()); } catch (error) { errors.push(`cleanup: ${String(error)}`); } }
  report.elapsedMs = Date.now() - started;
  report.errors = errors;
  report.status = errors.length ? "failed" : "passed";
  records.push(report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
const failed = records.filter((record) => record.status === "failed").length;
process.stdout.write(`${JSON.stringify({ mode: "product", total: records.length, passed: records.length - failed, failed, pending: 0, productExecutions: records.length })}\n`);
process.exitCode = failed ? 1 : 0;
