import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEvidence } from "./evidence.js";
import { createLab, semanticTrace, type Trace } from "./lab-v2.js";
import { rows, seeds } from "./retry-rows.js";
import { validateSourceRevision } from "./source-gate.js";
import type { Observation } from "./native.js";

await loadEvidence();
const source = await validateSourceRevision();
const owned = "tests/commands/network-stress";
const pins = JSON.parse(await readFile(`${owned}/retry-pins.json`, "utf8")) as { hashes: Record<string, string> };
for (const [path, hash] of Object.entries(pins.hashes)) {
  assert.equal(createHash("sha256").update(await readFile(`${owned}/${path}`)).digest("hex"), hash, `Retry freeze changed: ${path}`);
}
const frozen = JSON.parse(await readFile(`${owned}/retry-freeze.json`, "utf8")) as { records: Observation[]; exit: { code: number }; networkStable: boolean };
assert.equal(frozen.exit.code, 0);
assert(frozen.networkStable);
const { Shell, agentCommands, networkCommands, createMemoryFileSystem } = await import("../../../src/index.js");
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function canonical(traces: Trace[]): Trace[] {
  return traces.map((trace) => ({ ...trace, headers: [...trace.headers].sort(([first], [second]) => first.localeCompare(second)) }));
}
function codes(stderr: string): string[] { return [...stderr.matchAll(/curl: \((\d+)\)/g)].map((match) => match[1]!); }
let failed = 0;
for (const row of rows) {
  const lab = await createLab();
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, bytes] of Object.entries(seeds)) await fs.writeFile(`/work/${path}`, bytes);
  const authorized: number[] = [];
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 2 * 1024 * 1024 } }).use(agentCommands()).use(networkCommands({
    authorize(input) { assert(lab.allow(input.url)); authorized.push(input.attempt); return true; }, limits: { maxTimeMs: 5000 },
  }));
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(new Error("Retry product watchdog")), 6000);
  const errors: string[] = [];
  const report: Record<string, unknown> = { id: row.id };
  try {
    const expected = frozen.records.find((entry) => entry.id === row.id);
    assert(expected);
    const command = `set -o pipefail; curl -sS ${row.args.map((arg) => quote(lab.expand(arg, "/work"))).join(" ")} | cat`;
    const result = await shell.exec(command, { signal: controller.signal });
    const files: Record<string, string> = {};
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["work"]);
    for (const entry of await fs.readdir("/work")) {
      assert.equal(entry.type, "file");
      files[entry.name] = Buffer.from(await fs.readFile(`/work/${entry.name}`, { maxBytes: 1024 * 1024 })).toString("base64");
    }
    const traces = lab.traces.map((trace) => semanticTrace(trace, lab));
    Object.assign(report, { command: lab.normalize(command), code: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: result.stderr, files, traces, authorized });
    assert.equal(result.exitCode, expected.code, "Exit status");
    assert.equal(report.stdout, expected.stdout, "Exact stdout bytes");
    assert.deepEqual(files, expected.files, "Exact VFS bytes and namespace");
    assert.deepEqual(canonical(traces), canonical(expected.traces), "Exact request effects");
    assert.deepEqual(authorized, expected.traces.map((_trace, index) => index), "Every attempt authorized");
    assert.deepEqual(codes(result.stderr), codes(expected.stderr), "Diagnostic codes and counts");
    if (expected.stderr.includes("503")) assert.equal(result.stderr.match(/503/g)?.length, expected.stderr.match(/503/g)?.length, "HTTP failure meaning");
    if (!expected.stderr) assert.equal(result.stderr, "");
    await lab.waitForIdle();
  } catch (error) { errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
  finally {
    clearTimeout(watchdog);
    controller.abort();
    try { await shell.dispose(); await lab.close(); } catch (error) { errors.push(String(error)); }
  }
  if (errors.length) failed++;
  process.stdout.write(`${JSON.stringify({ ...report, errors, status: errors.length ? "failed" : "passed" })}\n`);
}
assert.deepEqual(await validateSourceRevision(), source);
process.stdout.write(`${JSON.stringify({ source, total: rows.length, passed: rows.length - failed, failed, pending: 0 })}\n`);
process.exitCode = failed ? 1 : 0;
