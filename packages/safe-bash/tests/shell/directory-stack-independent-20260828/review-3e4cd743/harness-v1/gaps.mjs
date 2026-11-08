import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { barrier, boundedSink } from "./lifecycle.mjs";
import { quote } from "./adapters.mjs";

export const gapIds = ["L01", "L02", "L13", "L14", "L15", "L16", "C02", "C03", "C04", "C05", "C06", "C10", "C12", "A04"];
const limits = { maxCommands: 30000, maxLoopIterations: 20000, maxOutputBytes: 64 * 1024 * 1024, maxSourceBytes: 8 * 1024 * 1024, maxExpansionBytes: 32 * 1024 * 1024 };
const output = sink => Buffer.concat(sink.chunks.map(chunk => Buffer.from(chunk))).toString();
const tick = () => new Promise(resolve => setImmediate(resolve));
async function memory(api) { const fs = api.createMemoryFileSystem(); for (const path of ["/c", "/a", "/b", "/search/leaf"]) await fs.mkdir(path, { recursive: true }); return fs; }
function proxy(fs, intercept) { return new Proxy(fs, { get(target, key) { const value = Reflect.get(target, key, target); return typeof value !== "function" ? value : (...args) => intercept(String(key), args, () => Reflect.apply(value, target, args)); } }); }
async function observe(context, command = "dirs", args = ["-l", "-p"]) { const sink = boundedSink(); const result = await context.invoke(command, args, { stdout: sink, stderr: sink }); assert.equal(result.exitCode, 0); return output(sink); }

async function capacity(api, row) {
  const oversized = row.id === "L13";
  const cwd = oversized ? "/" + "x".repeat(65536) : "/c";
  const fs = await memory(api);
  let phase = "seed";
  const calls = [];
  const watched = proxy(fs, (method, args, next) => { if (phase === "subject") calls.push([method, args[0]]); return next(); });
  const shell = new api.Shell({ fs: watched, cwd, env: { PWD: cwd }, limits });
  const seeds = row.id === "L01" ? Array(4096).fill("") : row.id === "L02" ? Array(4095).fill("") : row.id === "L13" ? ["/a"] : row.id === "L14" ? Array(64).fill("x".repeat(65536)) : ["", "x".repeat(65535), ...Array(63).fill("x".repeat(65536))];
  const receipts = [];
  const probes = { before: [], after: [] };
  const errors = { seed: [], subject: [] };
  const states = {};
  const stdout = { async write(chunk) {
    if (phase === "seed" && ["L13", "L14", "L15"].includes(row.id)) throw new api.FsError("EPIPE", { syscall: "write" });
    if (phase === "before" || phase === "after") { assert(Buffer.concat(probes[phase]).length + chunk.length <= 5 * 1024 * 1024); probes[phase].push(Buffer.from(chunk)); }
  } };
  const stderr = { async write(chunk) { assert(chunk.length <= 66048); (errors[phase] ??= []).push(Buffer.from(chunk)); } };
  shell.register({ name: "__phase", execute(context) { phase = context.args[0]; states[phase] = { cwd: context.cwd, env: { ...context.env } }; return { exitCode: 0 }; } });
  shell.register({ name: "__status", execute(context) { receipts.push({ phase, status: Number(context.args[0]) }); return { exitCode: 0 }; } });
  const seedScript = seeds.slice().reverse().map(entry => `pushd -n -- ${quote(entry)}\n__status "$?"`).join("\n");
  const subject = row.argv.map(quote).join(" ");
  const script = seedScript + "\n__phase before\ndirs -l -p\n__status \"$?\"\n__phase subject\n" + subject + "\n__status \"$?\"\n__phase after\ndirs -l -p\n__status \"$?\"\n__phase final";
  try {
    const result = await shell.exec(script, { stdout, stderr });
    assert.equal(result.exitCode, 0);
    assert.equal(receipts.filter(entry => entry.phase === "seed").length, seeds.length);
    for (const entry of receipts.filter(entry => entry.phase === "seed")) assert.equal(entry.status, ["L13", "L14", "L15"].includes(row.id) ? 1 : 0);
    assert.deepEqual(calls, []);
    const subjectReceipt = receipts.find(entry => entry.phase === "subject"); assert.equal(subjectReceipt.status, row.expect.status);
    if (row.expect.diagnosticPayload) assert(Buffer.concat(errors.subject).toString().includes(row.expect.diagnosticPayload));
    if (!oversized) {
      const expectedBefore = [cwd, ...seeds].join("\n") + "\n";
      assert.equal(Buffer.concat(probes.before).toString(), expectedBefore);
      const expectedAfter = row.id === "L02" ? [cwd, "", ...seeds].join("\n") + "\n" : expectedBefore;
      assert.equal(Buffer.concat(probes.after).toString(), expectedAfter);
    } else { assert.equal(Buffer.concat(probes.before).length, 0); assert.equal(Buffer.concat(probes.after).length, 0); }
    assert.deepEqual(states.final, states.subject);
    return { id: row.id, status: oversized ? "public-pass-with-source-setup-proof" : "public-assertions-pass", seedCount: seeds.length, seedReceipts: receipts, calls, observedBytesBefore: Buffer.concat(probes.before).length, observedSha256Before: createHash("sha256").update(Buffer.concat(probes.before)).digest("hex"), sourceOnlyUnmeasured: oversized ? { retainedTailOnFailedDisplay: "I07/I11/I17" } : {} };
  } finally { await shell.dispose(); }
}
async function inert(api, row) {
  const details = [];
  for (const command of ["popd +1", "dirs -c", "dirs -l -p", "pushd -n +0"]) {
    let active = false;
    const fs = proxy(await memory(api), () => { if (active) throw Error("inert host was called"); throw Error("unexpected setup provider call"); });
    const shell = new api.Shell({ fs, cwd: "/c", env: { PWD: "/c", OLDPWD: "/b" }, limits });
    const before = {}, after = {};
    shell.register({ name: "__before", execute(context) { Object.assign(before, { cwd: context.cwd, env: { ...context.env } }); active = true; return { exitCode: 0 }; } });
    shell.register({ name: "__after", execute(context) { Object.assign(after, { cwd: context.cwd, env: { ...context.env } }); return { exitCode: 0 }; } });
    try { const result = await shell.exec(`pushd -n /missing; readonly PWD OLDPWD; readonly -p; __before; ${command}; __after; readonly -p`); assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.deepEqual(after, before); const readonlyLines = result.stdout.split("\n").filter(line => line.startsWith("readonly ")); assert.equal(readonlyLines.length, 4); assert.deepEqual(readonlyLines.slice(0, 2), readonlyLines.slice(2)); details.push({ command, before, after, readonlyLines }); } finally { await shell.dispose(); }
  }
  return { id: row.id, status: "public-assertions-pass", groupedSubobservations: details };
}
async function cancellation(api, row) {
  const fs = await memory(api);
  const controller = new AbortController();
  const reason = new api.FsError("ENOENT", { syscall: "root-abort", path: "/root" });
  const late = new Error("late stat failure");
  const hold = barrier(), cleanup = barrier();
  let active = false, context, stateProbe, settled = false, lateObserved = false;
  const calls = [], events = [];
  const watched = proxy(fs, async (method, args, next) => {
    if (active) calls.push([method, args[0]]);
    if (active && method === "stat" && ["C02", "C03"].includes(row.id)) {
      if (row.id === "C03") stateProbe = await observe(context);
      events.push("stat-enter"); await hold.hold(); lateObserved = true; events.push("stat-reject"); throw late;
    }
    return next();
  });
  const shell = new api.Shell({ fs: watched, cwd: "/c", env: { PWD: "/c", OLDPWD: "/b", ...(row.env ?? {}) }, limits });
  const seed = row.id === "C03" ? "pushd -n /b; pushd -n /a; " : "";
  shell.register({ name: "__active", execute() { active = true; return { exitCode: 0 }; } });
  shell.use(async (current, next) => {
    if (active && current.command === "pushd") {
      context = current;
      if (row.id === "C04" || row.id === "C05") current.registerCleanup(async () => { events.push("cleanup-enter"); await cleanup.hold(); events.push("cleanup-done"); if (row.id === "C05") throw new Error("cleanup failure"); });
      const result = await next();
      if (row.id === "C05") stateProbe = await observe(current);
      return result;
    }
    return await next();
  });
  const sink = { async write() {
    if (active && row.id === "C04") { stateProbe = await observe(context); events.push("print-enter"); await hold.hold(); events.push("print-release"); }
  } };
  const promise = shell.exec(seed + "__active; " + row.argv.map(quote).join(" "), { signal: controller.signal, stdout: sink });
  const outcome = promise.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    if (row.id === "C05") await cleanup.entered; else await hold.entered;
    assert.equal(settled, false); controller.abort(reason); events.push("root-abort");
    await tick();
    if (["C04", "C05"].includes(row.id)) { assert.equal(settled, false); cleanup.release(); }
    hold.release();
    const result = await outcome; assert.equal(result.error, reason);
    if (["C02", "C03"].includes(row.id)) { assert(lateObserved); assert.equal(calls.filter(call => call[0] === "stat").length, 1); }
    if (row.id === "C03") assert.equal(stateProbe, row.expect.observedPreAbortFull.join("\n") + "\n");
    if (row.id === "C04") assert.equal(stateProbe, "/search/leaf\n");
    if (row.id === "C05") assert.equal(stateProbe, "/a\n/c\n");
    return { id: row.id, status: "public-pass-with-source-nonrollback-proof", events, stateProbe, calls, lateObserved, rootReasonIdentity: true, sourceOnlyUnmeasured: { postAbortPrivateState: "I17/I18" } };
  } finally { hold.release(); cleanup.release(); await outcome; await shell.dispose(); }
}
async function localSignal(api, row) {
  const fs = await memory(api), local = new AbortController();
  let child = false;
  const hold = barrier();
  const watched = proxy(fs, async (method, args, next) => { if (child && method === "stat") { await hold.hold(); throw new Error("late child lookup"); } return next(); });
  const shell = new api.Shell({ fs: watched, cwd: "/c", env: { PWD: "/c" }, limits });
  let parentFull, siblingFull, childReason;
  shell.register({ name: "__local", async execute(context) {
    child = true; const pending = context.invoke("popd", [], { signal: local.signal }).then(value => ({ value }), error => ({ error }));
    await hold.entered; child = false; siblingFull = await observe(context); local.abort(false); hold.release(); const result = await pending; childReason = result.error; parentFull = await observe(context); return { exitCode: 0 };
  } });
  try { const result = await shell.exec("pushd -n /a; __local"); assert.equal(result.exitCode, 0); assert.equal(childReason, false); assert.equal(parentFull, "/c\n/a\n"); assert.equal(siblingFull, parentFull); return { id: row.id, status: "public-pass-partial-source-proof", parentFull, siblingFull, childReason, sourceOnlyUnmeasured: { equalValuedRootEscapingLocalPrecedence: "I18 pinned existing cancellation boundary; separate regression controls required" } }; } finally { hold.release(); await shell.dispose(); }
}
async function destinations(api, row) {
  const fs = await memory(api), closed = new AbortController(), stdoutHold = barrier();
  const events = [], siblings = [];
  const shell = new api.Shell({ fs, cwd: "/c", limits });
  const sink = { async write() { throw Error("unenrolled write path"); }, ownedOutput: { consumerClosed: closed.signal, async write() { events.push("owned-write"); await stdoutHold.hold(); } } };
  shell.register({ name: "__owners", async execute(context) {
    const stdout = api.createOutputOperation(context, sink);
    for (const name of ["file", "header", "stderr"]) { const operation = api.createOutputOperation(context, { async write() {} }); operation.registerCleanup(() => { events.push(name + "-cleanup"); }); siblings.push(operation); }
    const invocation = context.invoke("pushd", ["/a"], { stdout: stdout.output }).then(value => ({ value }), error => ({ error }));
    await stdoutHold.entered; closed.abort(new api.FsError("EPIPE", { syscall: "write" }));
    assert(stdout.signal.aborted); assert(siblings.every(operation => !operation.signal.aborted));
    await assert.rejects(stdout.acquire(() => 1, async () => {}));
    stdoutHold.release(); await invocation; await stdout.close();
    for (const operation of siblings) { assert(!operation.signal.aborted); await operation.output.write(new Uint8Array([1])); await operation.close(); }
    return { exitCode: 0 };
  } });
  try { const result = await shell.exec("__owners"); assert.equal(result.exitCode, 0); assert(events.includes("owned-write")); assert.equal(events.filter(event => event.endsWith("cleanup")).length, 3); return { id: row.id, status: "public-assertions-pass", events, sourceOnlyUnmeasured: { originalStdoutEnrollmentPropagation: "I15 source plus C04 and actual Shell capture capability" } }; } finally { stdoutHold.release(); await shell.dispose(); }
}
async function planningAbort(api, row) {
  let calls = 0, observedAbort = false;
  const controller = new AbortController();
  const fs = proxy(await memory(api), (method, args, next) => { calls++; assert(!observedAbort); return next(); });
  const shell = new api.Shell({ fs, cwd: "/c", limits });
  const reason = Object.freeze({ kind: "planning-abort" });
  let scheduled;
  shell.use(async (context, next) => { if (context.command === "pushd") scheduled = setImmediate(() => { observedAbort = true; controller.abort(reason); }); return await next(); });
  try { await assert.rejects(shell.exec("pushd +" + "0".repeat(65500), { signal: controller.signal }), error => error === reason); assert(observedAbort); assert.equal(calls, 0); return { id: row.id, status: "public-pass-with-source-final-flush-proof", observedAbort, calls, sourceOnlyUnmeasured: { privateFinalFlushAndPublicationBoundary: "I08/I24" } }; } finally { if (scheduled) clearImmediate(scheduled); await shell.dispose(); }
}
export async function runGap(api, row, inventory) {
  if (["L01", "L02", "L13", "L14", "L15"].includes(row.id)) return capacity(api, row);
  if (row.id === "L16") return inert(api, row);
  if (["C02", "C03", "C04", "C05"].includes(row.id)) return cancellation(api, row);
  if (row.id === "C06") return localSignal(api, row);
  if (row.id === "C10") return destinations(api, row);
  if (row.id === "C12") return planningAbort(api, row);
  assert.equal(row.id, "A04");
  const names = api.createAgentCommands().map(entry => entry.name).sort();
  assert.deepEqual(names, inventory.defaultNames); assert.equal(names.length, 77);
  assert(!names.includes("curl") && !names.includes("safejs") && !names.includes("pushd"));
  assert.deepEqual(Object.keys(api).sort(), inventory.publicKeys);
  return { id: row.id, status: "public-assertions-pass", defaultNames: names, publicKeys: Object.keys(api).sort() };
}
