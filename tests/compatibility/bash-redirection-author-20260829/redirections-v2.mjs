import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import * as api from "virtual-bash";
import { expectedNames } from "./names.mjs";

const cases = JSON.parse(await fs.readFile(new URL("redirection-cases.json", import.meta.url)));
const rows = [], shells = new Set(), releases = new Set();
const bytes = value => Buffer.from(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function create(memory = new api.MemoryFileSystem(), counters = {}) {
  const shell = new api.Shell({ fs: memory, cwd: "/" }).use(api.agentCommands());
  shells.add(shell);
  shell.commands.register({ name: "emit", async execute(context) {
    counters.entered = (counters.entered ?? 0) + 1;
    context.registerCleanup(() => { counters.cleaned = (counters.cleaned ?? 0) + 1; });
    await context.stdout.write(bytes("O"));
    await context.stderr.write(bytes("E"));
    return { exitCode: 0 };
  } });
  return shell;
}
async function record(id, execute) {
  if (process.env.REDIRECTION_CASE && process.env.REDIRECTION_CASE !== id) return;
  const row = { id, pass: false };
  const timer = setTimeout(() => { console.error("CASE_DEADLINE", id); process.exit(78); }, 30000);
  try { await execute(); row.pass = true; }
  catch (error) { row.error = String(error?.stack ?? error); }
  finally {
    for (const release of releases) release();
    releases.clear();
    const closed = await Promise.allSettled([...shells].map(shell => shell.dispose()));
    row.created = shells.size; row.disposed = closed.filter(result => result.status === "fulfilled").length;
    row.cleanupFailure = row.created !== row.disposed;
    shells.clear(); clearTimeout(timer);
  }
  rows.push(row); console.log(JSON.stringify(row));
  if (row.cleanupFailure) process.exit(78);
}
for (const row of cases.cases) await record(row.id, async () => {
  const memory = new api.MemoryFileSystem(), counters = {};
  const shell = create(memory, counters);
  const result = await shell.exec(row.script);
  assert.equal(result.exitCode, row.exitCode ?? 0, result.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), bytes(row.stdout ?? ""));
  assert.deepEqual(Buffer.from(result.stderrBytes), bytes(row.stderr ?? ""));
  assert.deepEqual((await memory.readdir("/")).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name))), Object.keys(row.files ?? {}).sort().map(name => ({ name, type: "file" })));
  for (const [name, content] of Object.entries(row.files ?? {})) assert.deepEqual(Buffer.from(await memory.readFile("/" + name)), bytes(content));
  assert.equal(counters.cleaned ?? 0, counters.entered ?? 0, "registered cleanup before public settlement");
});
await record("C01-default80-display", async () => {
  assert.deepEqual(api.createAgentCommands().map(command => command.name).sort(), expectedNames);
  const shell = create();
  const result = await shell.exec("f(){ emit 2>err |& cat; }; g(){ emit &>out; }; type f g");
  assert.equal(result.exitCode, 0); assert.match(result.stdout, /\|&/); assert.match(result.stdout, /&> out/);
  assert.doesNotMatch(result.stdout, /2>& 1/);
});
await record("C02-unsupported-stays-unsupported", async () => {
  for (const script of ["emit &", "emit &>>out", "[[ x ]]", "exec {fd}>out"]) {
    const memory = new api.MemoryFileSystem();
    const result = await create(memory).exec(script);
    assert.notEqual(result.exitCode, 0, script);
    assert.notEqual(result.stderr, "", script);
  }
});
await record("C03-single-open-and-raw-bytes", async () => {
  const memory = new api.MemoryFileSystem(); let opens = 0;
  const write = memory.writeFile.bind(memory);
  memory.writeFile = async (name, value, options) => { if (name === "/out" && options?.flag === "w") opens++; return write(name, value, options); };
  const shell = create(memory);
  shell.commands.register({ name: "binary", async execute(context) {
    await context.stdout.write(Uint8Array.from([0, 255, 65]));
    await context.stderr.write(Uint8Array.from([128])); return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("binary &>out")).exitCode, 0);
  assert.equal(opens, 1); assert.deepEqual(Buffer.from(await memory.readFile("/out")), Buffer.from([0, 255, 65, 128]));
  const piped = await shell.exec("binary |& cat");
  assert.equal(piped.exitCode, 0); assert.deepEqual(Buffer.from(piped.stdoutBytes), Buffer.from([0, 255, 65, 128]));
});
await record("C04-before-open-caller-identity", async () => {
  const memory = new api.MemoryFileSystem(), shell = create(memory);
  const controller = new AbortController(), reason = { caller: "before-open" }; controller.abort(reason);
  await assert.rejects(shell.exec("emit &>out", { signal: controller.signal }), error => error === reason);
  assert.deepEqual(await memory.readdir("/"), []);
});
await record("C05-blocked-write-caller-identity", async () => {
  const shell = create(), controller = new AbortController(), reason = { caller: "in-write" };
  const entered = deferred(), released = deferred(); releases.add(released.resolve);
  const execution = shell.exec("emit |& cat", { signal: controller.signal, stdout: { async write() { entered.resolve(); await released.promise; } } });
  const outcome = execution.then(value => ({ value }), error => ({ error }));
  await entered.promise; controller.abort(reason); released.resolve();
  assert.equal((await outcome).error, reason);
});
await record("C06-backpressure", async () => {
  const shell = create(), entered = deferred(), released = deferred(); releases.add(released.resolve);
  const chunks = []; let settled = false;
  const execution = shell.exec("emit |& cat", { stdout: { async write(chunk) { chunks.push(Buffer.from(chunk)); entered.resolve(); await released.promise; } } });
  const outcome = execution.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  await entered.promise; await turn(); assert.equal(settled, false); released.resolve();
  assert.equal((await outcome).value.exitCode, 0); assert.deepEqual(Buffer.concat(chunks), bytes("OE"));
});
await record("C07-sink-fault-profile-preserved", async () => {
  const reason = { sink: "raw" }, observations = [];
  for (const script of ["emit 2>&1 | cat", "emit |& cat"]) {
    const shell = create(); let delivered = 0;
    const value = await shell.exec(script, { stdout: { write() { delivered++; throw reason; } } }).then(result => ({ kind: "return", exitCode: result.exitCode, stderr: result.stderr }), error => ({ kind: "throw", exact: error === reason }));
    assert.ok(delivered > 0); observations.push(value);
  }
  assert.deepEqual(observations[1], observations[0]);
  if (observations[0].kind === "throw") assert.equal(observations[0].exact, true);
});
await record("C08-required-file-after-downstream-close", async () => {
  const memory = new api.MemoryFileSystem(), counters = {}, shell = create(memory, counters);
  const result = await shell.exec("emit &>out |& head -n 0");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  assert.equal(Buffer.from(await memory.readFile("/out")).toString(), "OE"); assert.equal(counters.cleaned, 1);
});
await record("C09-open-failure-and-prior-effect", async () => {
  const memory = new api.MemoryFileSystem(), counters = {}, shell = create(memory, counters);
  const result = await shell.exec("emit >first &>/missing/out");
  assert.notEqual(result.exitCode, 0); assert.notEqual(result.stderr, ""); assert.equal(counters.entered ?? 0, 0);
  assert.deepEqual(Buffer.from(await memory.readFile("/first")), Buffer.alloc(0));
  assert.deepEqual(await memory.readdir("/"), [{ name: "first", type: "file" }]);
});
await record("C10-output-limit-and-cleanup", async () => {
  const memory = new api.MemoryFileSystem(), counters = {}, shell = create(memory, counters);
  await assert.rejects(shell.exec("emit &>out", { limits: { maxOutputBytes: 1 } }), error => error instanceof api.ShellLimitError);
  assert.equal(counters.cleaned, 1); assert.equal(Buffer.from(await memory.readFile("/out")).toString(), "O");
});
await record("C11-closed-descriptor-error", async () => {
  const memory = new api.MemoryFileSystem(), counters = {}, shell = create(memory, counters);
  const result = await shell.exec("set -o pipefail; emit 1>&- |& cat");
  assert.notEqual(result.exitCode, 0); assert.match(result.stderr, /Bad file descriptor/);
  assert.equal(counters.entered ?? 0, 0);
});
await record("C12-owned-real-file", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR, "redirect-real-"));
  try {
    const real = await api.createRealFileSystem({ root }), shell = create(real);
    const result = await shell.exec("emit 2>err >out |& cat");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile(path.join(root, "out")), bytes("OE"));
    assert.deepEqual(await fs.readFile(path.join(root, "err")), Buffer.alloc(0));
    await shell.dispose(); shells.delete(shell);
  } finally { await fs.rm(root, { recursive: true }); }
});
const summary = { cases: rows.length, pass: rows.filter(row => row.pass && !row.cleanupFailure).length };
summary.fail = summary.cases - summary.pass;
console.log(JSON.stringify({ summary })); process.exitCode = summary.fail ? 1 : 0;

