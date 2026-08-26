import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createLab, semanticTrace, type Trace } from "./lab.js";
import { rows, seeds, type Row } from "./rows.js";

export const owned = fileURLToPath(new URL(".", import.meta.url));
export const executable = "/usr/bin/curl";
export const baseArgs = ["-q", "--silent", "--show-error", "--globoff", "--http1.1", "--noproxy", "*", "--proxy", "", "--proto", "=http", "--proto-redir", "=http", "--connect-timeout", "1", "--max-time", "3", "--max-redirs", "5"];

export interface Observation {
  id: string;
  argv: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  traces: Trace[];
  wireTraces: Trace[];
  files: Record<string, string>;
  consumerCode: number | null;
  elapsedMs: number;
  consumerElapsedMs: number | null;
}

function environment(root: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: root, CURL_HOME: root, XDG_CONFIG_HOME: root, LC_ALL: "C", LANG: "C", NO_PROXY: "*", no_proxy: "*" };
}

function child(executablePath: string, args: readonly string[], cwd: string): ChildProcessWithoutNullStreams {
  assert(args.every((arg) => !arg.includes("\0")), "Native argv cannot contain NUL");
  return spawn(executablePath, args, { cwd, env: environment(cwd), stdio: ["pipe", "pipe", "pipe"], shell: false });
}

function completion(process: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("close", (code, signal) => resolve({ code, signal }));
  });
}

export async function profile(): Promise<{ executable: string; sha256: string; version: string; headSha256: string; config: string[]; environment: NodeJS.ProcessEnv }> {
  const process = child(executable, ["-q", "--version"], owned);
  const result = completion(process);
  const chunks: Buffer[] = [];
  process.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  process.stderr.resume();
  process.stdin.end();
  const timer = setTimeout(() => process.kill("SIGKILL"), 3000);
  try { assert.equal((await result).code, 0); } finally { clearTimeout(timer); }
  return {
    executable,
    sha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    version: Buffer.concat(chunks).toString(),
    headSha256: createHash("sha256").update(await readFile("/usr/bin/head")).digest("hex"),
    config: baseArgs,
    environment: environment("{ROOT}"),
  };
}

export async function runNative(row: Row): Promise<Observation> {
  assert(rows.includes(row), "Only the closed, audited fixture catalog is executable");
  const root = await mkdtemp(join(owned, ".native-"));
  const processes: ChildProcessWithoutNullStreams[] = [];
  const completions: Promise<unknown>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lab: Awaited<ReturnType<typeof createLab>> | undefined;
  try {
    for (const [path, data] of Object.entries(seeds)) await writeFile(join(root, path), data);
    lab = await createLab();
    const args = row.args.map((arg) => lab!.expand(arg, root));
    for (const arg of args) {
      if (/^[a-z]+:\/\//i.test(arg)) {
        const deliberateInvalid = ["malformed-port", "forbidden-file-protocol", "malformed-url-space"].includes(row.id);
        assert(deliberateInvalid || lab.allow(arg), "External fixture URL rejected");
      }
    }
    const host = new URL(lab.origins.H);
    const argv = [...baseArgs, "--resolve", `localhost:${host.port}:127.0.0.1`, ...args];
    const started = Date.now();
    const curl = child(executable, argv, root);
    processes.push(curl);
    const done = completion(curl);
    completions.push(done.catch(() => {}));
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let watchdog = false;
    const append = (target: Buffer[], chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        watchdog = true;
        for (const process of processes) process.kill("SIGKILL");
      } else target.push(chunk);
    };
    curl.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    curl.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") curl.kill("SIGKILL"); });
    let consumer: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let consumerElapsedMs: number | null = null;
    if (row.mode === "head") {
      const head = child("/usr/bin/head", ["-c", "1"], root);
      processes.push(head);
      consumer = completion(head).then((result) => { consumerElapsedMs = Date.now() - started; return result; });
      completions.push(consumer.catch(() => {}));
      head.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
      head.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
      head.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") head.kill("SIGKILL");
        curl.stdout.destroy();
      });
      curl.stdout.pipe(head.stdin);
      head.once("exit", () => curl.stdout.destroy());
    } else curl.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    curl.stdin.end(Buffer.from(row.input ?? "", "base64"));
    timer = setTimeout(() => {
      watchdog = true;
      for (const process of processes) process.kill("SIGKILL");
    }, 6000);
    if (row.mode === "sigint") {
      await Promise.race([lab.waitForRequest(), done.then(() => { throw new Error("curl ended before cancellation trigger"); })]);
      curl.kill("SIGINT");
    }
    const result = await done;
    const consumerCode = consumer ? (await consumer).code : null;
    assert(!watchdog, `${row.id}: native watchdog/output budget reached`);
    await lab.waitForIdle();
    const files: Record<string, string> = {};
    for (const path of (await readdir(root)).sort()) files[path] = (await readFile(join(root, path))).toString("base64");
    return {
      id: row.id,
      argv: argv.map((arg) => lab!.normalize(arg, root).replace(`localhost:${host.port}:127.0.0.1`, "localhost:{A_PORT}:127.0.0.1")),
      ...result,
      stdout: Buffer.concat(stdout).toString("base64"),
      stderr: lab.normalize(Buffer.concat(stderr).toString(), root),
      traces: lab.traces.map((trace) => semanticTrace(trace, lab!)),
      wireTraces: lab.traces.map((trace) => ({ ...trace, headers: trace.headers.map(([name, value]) => [name, lab!.normalize(value, root)]) })),
      files, consumerCode, elapsedMs: Date.now() - started, consumerElapsedMs,
    };
  } finally {
    if (timer) clearTimeout(timer);
    for (const process of processes) if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
    await Promise.all(completions);
    await lab?.close();
    await rm(root, { recursive: true, force: true });
  }
}

export function assertNative(row: Row, actual: Observation): void {
  if (row.mode === "sigint") {
    assert.equal(actual.code, null);
    assert.equal(actual.signal, "SIGINT");
    assert.equal(actual.traces.length, 1);
  } else if (row.mode === "head") {
    assert.equal(actual.consumerCode, 0);
    assert.equal(actual.stdout, Buffer.from("p").toString("base64"));
    assert([0, 23, 28].includes(actual.code!), "Native pipe outcome outside bounded documented observations");
    assert.equal(actual.signal, null);
  } else {
    assert.equal(actual.code, row.code ?? 0, `${row.id}: independent expected native exit`);
    assert.equal(actual.signal, null);
  }
  if (row.diagnostic) assert.match(actual.stderr, new RegExp(row.diagnostic, "i"), `${row.id}: meaningful diagnostic`);
  if (actual.code === 0) assert.equal(actual.stderr, "");
}

export function stable(observation: Observation): unknown {
  return {
    id: observation.id,
    code: observation.id.startsWith("early-head-") ? "native-pipe-observation-only" : observation.code,
    signal: observation.signal,
    stdout: observation.stdout,
    traces: observation.traces,
    files: observation.files,
    consumerCode: observation.consumerCode,
  };
}
