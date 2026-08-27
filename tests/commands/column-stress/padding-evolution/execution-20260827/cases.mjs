import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [candidateArgument, output, group, mutation = "none"] = process.argv.slice(2);
assert(candidateArgument && output && group);
const candidate = await realpath(candidateArgument);
assert(candidate.startsWith("/private/tmp/safe-bash-column-padding-") || candidate.startsWith("/tmp/safe-bash-column-padding-"));
const rootUrl = pathToFileURL(join(candidate, "dist/index.js")).href;
const columnUrl = pathToFileURL(join(candidate, "dist/commands/column/index.js")).href;
const api = await import(rootUrl), column = await import(columnUrl);
const { ColumnBudget } = await import(pathToFileURL(join(candidate, "dist/commands/column/internal.js")).href);
const expected = JSON.parse(await readFile(new URL("../expectations.json", import.meta.url)));
const schedules = JSON.parse(await readFile(new URL("../safety-schedules.json", import.meta.url)));
const native = JSON.parse(await readFile(new URL("../native-observations.json", import.meta.url)));
const specification = schedules.schedules.find((row) => row.id === group);
const cases = [], unhandled = [];
const onUnhandled = (error) => unhandled.push(String(error));
process.on("unhandledRejection", onUnhandled);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); void promise.catch(() => {}); return { promise, resolve, reject }; };
const source = (bytes) => ({ async *[Symbol.asyncIterator]() { yield bytes; } });
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const work = { calls: 0, units: 0 };
const originalWork = ColumnBudget.prototype.work;
ColumnBudget.prototype.work = async function (amount) { work.calls++; work.units += amount; return originalWork.call(this, amount); };
if (mutation === "wrong-padding") {
  const original = ColumnBudget.prototype.chunk;
  ColumnBudget.prototype.chunk = async function (bytes) { return original.call(this, Buffer.from(Buffer.from(bytes).toString().replaceAll(" ", ""))); };
}
if (mutation === "no-output-admission") ColumnBudget.prototype.checkOutput = function () {};
async function check(name, body) {
  const record = { name, observations: [], verdict: "pending" };
  cases.push(record);
  try { await body(record); record.verdict = "pass"; }
  catch (error) { record.verdict = "fail"; record.failure = { message: String(error), stack: error?.stack }; }
}
async function memory(files = {}) {
  const fs = api.createMemoryFileSystem();
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(`/${name}`, Buffer.from(contents));
  return fs;
}
async function run(record, config = {}) {
  const fs = config.fs ?? await memory(config.files), cleanups = [];
  const stdout = [], stderr = [], sizes = [];
  let bytes = 0, status = null, error, pulls = 0;
  const digest = createHash("sha256");
  const input = config.source ?? source(config.input ?? Buffer.from(config.stdinUtf8 ?? ""));
  const tracked = { [Symbol.asyncIterator]() { config.onAcquire?.(); const iterator = input[Symbol.asyncIterator](); return { next() { pulls++; return iterator.next(); }, ...(iterator.return ? { return: () => iterator.return() } : {}) }; } };
  const stdoutSink = { async write(chunk) {
    config.onAttempt?.(chunk);
    if (config.sink) await config.sink(chunk);
    const owned = Buffer.from(chunk);
    digest.update(owned); bytes += owned.length; sizes.push(owned.length);
    if (bytes <= 65536) stdout.push(owned);
    else if (!config.hashOnly) throw new Error("Harness raw stdout capture cap exceeded");
    config.onComplete?.(chunk, bytes);
  } };
  const stderrSink = { async write(chunk) { if (config.diagnosticSink) await config.diagnosticSink(chunk); assert(stderr.reduce((total, value) => total + value.length, 0) + chunk.length <= 65536); stderr.push(Buffer.from(chunk)); } };
  const signal = config.signal ?? new AbortController().signal;
  if (config.shell) {
    const host = new api.Shell({ fs, cwd: "/", limits: { maxOutputBytes: 131072, maxCommands: 64 } });
    host.use(column.columnCommands({ limits: config.limits }));
    try { status = (await host.exec(["column", ...(config.argv ?? specification?.argv ?? ["-t"]).map(quote)].join(" "), { stdin: tracked, stdout: stdoutSink, stderr: stderrSink, signal })).exitCode; }
    catch (failure) { error = failure; }
    finally { await host.dispose(); }
  } else {
    try {
      status = (await column.createColumnCommand({ limits: config.limits }).execute({ command: "column", args: config.argv ?? specification?.argv ?? ["-t"], cwd: "/", env: {}, fs, signal, stdin: tracked, stdinIsDefault: false, stdout: stdoutSink, stderr: stderrSink, registerCleanup(cleanup) { cleanups.push(cleanup); config.onRegister?.(cleanup); } })).exitCode;
    } catch (failure) { error = failure; }
  }
  const captured = Buffer.concat(stdout), stderrBytes = Buffer.concat(stderr);
  const observation = { argv: config.argv ?? specification?.argv ?? ["-t"], limits: config.limits ?? {}, inputHex: config.input ? hex(config.input) : config.stdinUtf8 !== undefined ? hex(Buffer.from(config.stdinUtf8)) : null, status, rejection: error === undefined ? null : { message: String(error), code: error?.code ?? null }, stdoutBytes: bytes, stdoutSha256: digest.digest("hex"), stdoutHex: bytes <= 65536 ? hex(captured) : null, retainedPrefixHex: bytes > 65536 ? hex(captured.subarray(0, 8192)) : null, captureMode: bytes > 65536 ? "incremental-full-stream-hash-with-prefix" : "exact-bytes", stderrHex: hex(stderrBytes), writes: sizes.length, maxWriteBytes: Math.max(0, ...sizes), pulls, registeredCleanupCount: cleanups.length, effects: {} };
  for (const name of Object.keys(config.files ?? {})) observation.effects[name] = hex(await fs.readFile(`/${name}`));
  record.observations.push(observation);
  return { observation, bytes: captured, stderr: stderrBytes, status, error, cleanups, fs };
}
function success(result, text) { assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.observation.stdoutSha256, hash(Buffer.from(text))); assert.equal(result.observation.stdoutBytes, Buffer.byteLength(text)); assert.equal(result.observation.stderrHex, ""); }
function refused(result, text, cap) { assert.equal(result.error, undefined); assert.equal(result.status, 1); assert(result.observation.stdoutBytes <= cap); assert(Buffer.from(text).subarray(0, result.bytes.length).equals(result.bytes)); assert(result.stderr.length > 0); }
async function boundaries(id, text, overrides = {}) {
  const spec = schedules.schedules.find((row) => row.id === id);
  for (const [index, item] of spec.runs.entries()) await check(`${id}/boundary-${index + 1}`, async (record) => {
    const limits = item.limits ?? Object.fromEntries(Object.entries(item).filter(([key]) => key !== "expect"));
    const result = await run(record, { argv: spec.argv, stdinUtf8: spec.stdinUtf8, limits, ...overrides });
    if (index === 0) success(result, text); else { refused(result, text, limits.maxOutputBytes ?? 65536); if (id === "E09") assert.equal(result.observation.stdoutBytes, 0); }
  });
}
async function sparse(record, zeroSeparator) {
  const input = Buffer.from("x" + ":".repeat(1023) + "\n" + "x\n".repeat(19999));
  assert.equal(hash(input), expected.streamReferences.E03_E04_input.sha256);
  const producer = { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < input.length; offset += 4096) yield input.subarray(offset, offset + 4096); } };
  const originalFrom = Array.from;
  let tableAllocationSlots = 0, guardTrips = 0;
  Array.from = function (values, ...rest) {
    if (new Error().stack.includes("/commands/column/table.js")) { tableAllocationSlots += values.length ?? 0; if (tableAllocationSlots > 100000) { guardTrips++; throw new Error("Independent rectangular allocation guard"); } }
    return originalFrom.call(this, values, ...rest);
  };
  let result;
  try { result = await run(record, { argv: zeroSeparator ? ["-t", "-s", ":", "-o", ""] : ["-t", "-s", ":"], source: producer, limits: { maxSteps: 1000000, maxOutputBytes: zeroSeparator ? 40000 : 4096 } }); }
  finally { Array.from = originalFrom; record.allocationObservation = { tableAllocationSlots, guardTrips }; record.work = { ...work }; }
  assert.equal(guardTrips, 0);
  assert.equal(result.error, undefined);
  if (!zeroSeparator) { assert.equal(result.status, 1); assert(result.observation.stdoutBytes <= 4096); }
  else if (result.status === 0) { assert.equal(result.observation.stdoutBytes, 40000); assert.equal(result.observation.stdoutSha256, expected.streamReferences.E04_success.sha256); record.safetyDisposition = "exact-layout-success"; }
  else { assert.equal(result.status, 1); assert(result.stderr.toString().includes("work")); assert(result.bytes.equals(Buffer.from("x\n".repeat(20000)).subarray(0, result.bytes.length))); record.safetyDisposition = "explicit-work-refusal-not-layout-success"; }
}
try {
  if (group === "literals") for (const expectation of expected.rows) await check(expectation.id, async (record) => {
    const result = await run(record, { shell: true, argv: expectation.argv, input: Buffer.from(expectation.stdinHex, "hex") });
    record.nativeProfiles = native.observations.filter((row) => row.recipe === expectation.id).map((row) => ({ profile: row.profile, rawStatus: row.status, rawStdoutHex: row.stdoutHex, rawStderrHex: row.stderrHex, equal: row.status === result.status && row.stdoutHex === result.observation.stdoutHex && row.stderrHex === result.observation.stderrHex }));
    assert.equal(result.error, undefined); assert.equal(result.status, expectation.status); assert.equal(result.observation.stdoutHex, expectation.stdoutHex); assert.equal(result.observation.stderrHex, expectation.stderrHex);
  });
  if (["E01", "E06", "E07"].includes(group)) await boundaries(group, specification.expectedStdoutUtf8);
  if (group === "E02") await check("E02/preallocation", async (record) => {
    const original = globalThis.Uint8Array, calls = []; let complete = 0;
    globalThis.Uint8Array = new Proxy(original, { construct(target, args, constructor) {
      if (new Error().stack.includes("/commands/column/table.js")) {
        const size = args[0]; calls.push({ size, remaining: 1024 - complete });
        if (typeof size === "number" && size > 1024 - complete) throw new Error("Independent preallocation guard");
      }
      return Reflect.construct(target, args, constructor);
    } });
    let result;
    try { result = await run(record, { stdinUtf8: "a\n" + "x".repeat(4096) + ":q\n", limits: specification.limits, onComplete(chunk, total) { complete = total; } }); }
    finally { globalThis.Uint8Array = original; record.paddingAllocations = calls; }
    assert.equal(result.status, 1); assert(result.observation.stdoutBytes <= 1024); assert(!calls.some((call) => call.size > call.remaining), "Padding allocated before output admission");
  });
  if (group === "E03" || group === "E04") await check(`${group}/sparse-20000x1024`, (record) => sparse(record, group === "E04"));
  if (group === "E05") await check("E05/explicit-empty", async (record) => success(await run(record, { stdinUtf8: specification.stdinUtf8, limits: specification.limits }), specification.expectedStdoutUtf8));
  if (group === "E08") for (const maxSteps of [1, 10000]) await check(`E08/work-${maxSteps}`, async (record) => {
    const result = await run(record, { stdinUtf8: "x:y\n".repeat(64), limits: { maxSteps } });
    if (maxSteps === 1) { assert.equal(result.status, 1); assert.equal(result.observation.stdoutBytes, 0); } else success(result, "x  y\n".repeat(64));
  });
  if (group === "E09") await boundaries(group, specification.expectedStdoutUtf8);
  if (group === "E10") await check("E10/padding-backpressure", async (record) => {
    const entered = gate(), release = gate(); let writes = 0, settled = false;
    const operation = run(record, { stdinUtf8: "x".repeat(32768) + ":q\na\n", limits: specification.limits, hashOnly: true, async sink(bytes) { writes++; if (Buffer.from(bytes).includes(32)) { entered.resolve(); await release.promise; } } }).then((result) => { settled = true; return result; });
    try { await entered.promise; const before = writes; await tick(); await tick(); record.beforeRelease = { writes, settled }; assert.equal(writes, before); assert.equal(settled, false); }
    finally { release.resolve(); }
    const result = await operation;
    const digest = createHash("sha256").update("x".repeat(32768)).update("  q\na").update(" ".repeat(32769)).update("\n").digest("hex");
    assert.equal(result.status, 0); assert.equal(result.observation.stdoutBytes, 65543); assert.equal(result.observation.stdoutSha256, digest); assert(result.observation.maxWriteBytes <= 8192);
  });
  if (group === "E11") {
    for (const late of ["resolve", "reject"]) await check(`E11/padding-abort-late-${late}`, async (record) => {
      const entered = gate(), release = gate(), controller = new AbortController(), reason = { code: "ENOENT", marker: late }; let attempts = 0;
      const operation = run(record, { stdinUtf8: specification.stdinUtf8, signal: controller.signal, async sink(bytes) { attempts++; if (Buffer.from(bytes).includes(32)) { entered.resolve(); await release.promise; } } });
      try { await entered.promise; controller.abort(reason); const result = await operation; assert.equal(result.error, reason); const before = attempts; late === "reject" ? release.reject(new Error("late opaque sink rejection")) : release.resolve(); await tick(); assert.equal(attempts, before); record.attempts = attempts; }
      finally { release.resolve(); await operation; }
    });
    await check("E11/registered-owned-return", async (record) => {
      const entered = gate(), returned = gate(), release = gate(), pending = gate(), controller = new AbortController(), reason = { marker: "owned-return" };
      let pulls = 0, returns = 0, settled = false, registered; const events = [];
      const fs = await memory({ input: specification.stdinUtf8 });
      const wrapped = new Proxy(fs, { get(target, key) { if (key === "readStream") return () => ({ [Symbol.asyncIterator]() { events.push("acquire"); assert(registered); return { async next() { if (++pulls === 1) return { done: false, value: Buffer.from(specification.stdinUtf8) }; entered.resolve(); return pending.promise; }, async return() { returns++; returned.resolve(); await release.promise; return { done: true }; } }; } }); const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
      const operation = run(record, { argv: ["-t", "-s", ":", "/input"], fs: wrapped, signal: controller.signal, onRegister(cleanup) { events.push("register"); registered = cleanup; } }).then((result) => { settled = true; return result; });
      let cleanup;
      try { await entered.promise; controller.abort(reason); cleanup = registered(); assert.equal(cleanup, registered()); await returned.promise; await tick(); record.beforeRelease = { settled, returns, events }; assert.equal(settled, false); release.resolve(); const result = await operation; await cleanup; assert.equal(result.error, reason); assert.equal(returns, 1); }
      finally { release.resolve(); pending.reject(new Error("late owned read")); await operation; await cleanup; await tick(); }
    });
  }
  if (group === "E12") for (const effectBeforeFailure of [false, true]) await check(`E12/sink-effect-${effectBeforeFailure}`, async (record) => {
    const effects = [], attempts = []; let afterNewline = false, failed = false;
    const result = await run(record, { stdinUtf8: specification.stdinUtf8, async sink(bytes) {
      assert.equal(failed, false, "Write after sink failure"); const owned = Buffer.from(bytes); attempts.push(hex(owned));
      if (afterNewline && owned.includes(32)) { if (effectBeforeFailure) effects.push(owned); failed = true; throw new Error("sink-padding-failure"); }
      effects.push(owned); if (owned.includes(10)) afterNewline = true;
    } });
    record.attempts = attempts; record.actualEffectsHex = hex(Buffer.concat(effects)); assert.equal(failed, true); assert.equal(result.status, 1); assert(Buffer.from(specification.expectedStdoutUtf8).subarray(0, Buffer.concat(effects).length).equals(Buffer.concat(effects)));
  });
  if (group === "E13") for (const variant of specification.variants) for (const split of [false, true]) await check(`E13/${variant.name}/split-${split}`, async (record) => {
    const input = Buffer.from(variant.stdinHex, "hex");
    const producer = split ? { async *[Symbol.asyncIterator]() { for (const byte of input) yield Buffer.from([byte]); } } : source(input);
    const result = await run(record, { source: producer }); assert.equal(result.status, 1); assert.equal(result.observation.stdoutBytes, 0); assert(result.stderr.length > 0);
  });
  if (group === "E14") for (const [name, input, text] of [["partial", specification.stdinUtf8, specification.expectedStdoutUtf8], ["unicode", Buffer.from(expected.rows.find((row) => row.id === "P10").stdinHex, "hex").toString(), Buffer.from(expected.rows.find((row) => row.id === "P10").stdoutHex, "hex").toString()]]) for (const reuse of [false, true]) await check(`E14/${name}/reuse-${reuse}`, async (record) => {
    const bytes = Buffer.from(input), buffer = Buffer.alloc(1); let offset = 0;
    const producer = { [Symbol.asyncIterator]() { return { async next() { buffer.fill(88); if (offset === bytes.length) return { done: true }; buffer[0] = bytes[offset++]; return { done: false, value: buffer.subarray(0, 1) }; }, async return() { buffer.fill(90); return { done: true }; } }; } };
    success(await run(record, { source: reuse ? producer : source(bytes) }), text);
  });
  if (group === "E15") await check("E15/actual-shell-files", async (record) => {
    const result = await run(record, { shell: true, stdinUtf8: specification.stdinUtf8, files: specification.files }); assert.equal(result.status, 1); assert.equal(result.observation.stdoutHex, hex(Buffer.from(specification.expectedStdoutUtf8))); assert(result.stderr.toString().includes("missing"));
    for (const [name, value] of Object.entries(specification.files)) assert.equal(result.observation.effects[name], hex(Buffer.from(value)));
  });
  if (group === "E16") for (const maxArgumentBytes of [10, 9]) await check(`E16/arguments-${maxArgumentBytes}`, async (record) => {
    let acquisitions = 0; const result = await run(record, { stdinUtf8: specification.stdinUtf8, limits: { maxArgumentBytes }, onAcquire() { acquisitions++; } });
    if (maxArgumentBytes === 10) success(result, schedules.schedules.find((row) => row.id === "E07").expectedStdoutUtf8); else { assert.equal(result.status, 1); assert.equal(acquisitions, 0); }
    record.acquisitions = acquisitions;
  });
  if (group === "supplemental") {
    await check("X01/admitted-maximum-fill-width", async (record) => success(await run(record, { argv: ["-c", "67108864"], stdinUtf8: "a\nb\n", limits: { maxWidth: 67108864, maxOutputBytes: 16 } }), "a\tb\n"));
    await check("X02/invalid-config-before-acquisition", async (record) => { let acquired = false; const result = await run(record, { limits: { maxWidth: 67108865 }, onAcquire() { acquired = true; } }); assert(result.error); assert.equal(acquired, false); });
  }
  await tick(); await tick();
} finally { process.removeListener("unhandledRejection", onUnhandled); }
assert(cases.length > 0, "Unexecuted group");
const result = { candidate, rootUrl, columnUrl, rootSha256: hash(await readFile(new URL(rootUrl))), columnSha256: hash(await readFile(new URL(columnUrl))), group, mutation, expectedSha256: hash(await readFile(new URL("../expectations.json", import.meta.url))), schedulesSha256: hash(await readFile(new URL("../safety-schedules.json", import.meta.url))), harnessSha256: hash(await readFile(new URL(import.meta.url))), cases, unhandled, work, counts: { total: cases.length, pass: cases.filter((row) => row.verdict === "pass").length, fail: cases.filter((row) => row.verdict === "fail").length } };
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, group, mutation, ...result.counts, failures: cases.filter((row) => row.verdict === "fail").map((row) => ({ name: row.name, failure: row.failure.message })), unhandled: unhandled.length }));
if (result.counts.fail || unhandled.length) process.exitCode = 1;
