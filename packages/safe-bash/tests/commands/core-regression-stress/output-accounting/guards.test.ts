import assert from "node:assert/strict";
import test from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, type ByteSink } from "../../../../src/index.js";

const limitError = (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes";
const makeShell = () => new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());

test("independent accounting: unknown external sink cannot bypass the quota", async () => {
  const shell = makeShell();
  let delivered = "";
  const sink: ByteSink = { async write(bytes) { delivered += Buffer.from(bytes).toString(); } };
  shell.register({ name: "bridge", execute: context => context.invoke!("printf", ["12345"], { stdout: sink }) });
  try {
    await assert.rejects(shell.exec("bridge", { limits: { maxOutputBytes: 4 } }), limitError);
    assert.equal(delivered, "");
  } finally { await shell.dispose(); }
});

test("independent accounting: another Shell budget does not confer exemption", async () => {
  const outer = makeShell(), inner = makeShell();
  let failure: unknown, foreign: ByteSink | undefined;
  inner.register({ name: "relay", execute: context => context.invoke!("writer", [], { stdout: foreign! }) });
  inner.register({ name: "writer", async execute(context) {
    await context.stdout.write(Buffer.from("1234"));
    await context.stdout.write(Buffer.from("1234"));
    return { exitCode: 0 };
  } });
  outer.register({ name: "bridge", async execute(context) {
    foreign = context.stdout;
    try { await inner.exec("relay", { limits: { maxOutputBytes: 4 } }); }
    catch (error) { failure = error; }
    return { exitCode: 0 };
  } });
  try {
    const result = await outer.exec("bridge", { limits: { maxOutputBytes: 16 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1234");
    assert.ok(limitError(failure));
  } finally { await inner.dispose(); await outer.dispose(); }
});

test("independent accounting: changing a known writer invalidates its exemption", async () => {
  const shell = makeShell();
  let delivered = "";
  shell.register({ name: "bridge", execute(context) {
    context.stdout.write = async bytes => { delivered += Buffer.from(bytes).toString(); };
    return context.invoke!("printf", ["12345"], { stdout: context.stdout });
  } });
  try {
    await assert.rejects(shell.exec("bridge", { limits: { maxOutputBytes: 4 } }), limitError);
    assert.equal(delivered, "");
  } finally { await shell.dispose(); }
});

test("independent accounting: a verified forwarding chain retains its writer", async () => {
  const shell = makeShell();
  let captured: ByteSink | undefined, delivered = "";
  shell.use(async (context, next) => {
    if (context.command === "writer" && captured) captured.write = async bytes => { delivered += Buffer.from(bytes).toString(); };
    return next();
  });
  shell.register({ name: "bridge", execute(context) {
    captured = context.stdout;
    return context.invoke!("writer", [], { stdout: context.stdout });
  } });
  shell.register({ name: "writer", async execute(context) { await context.stdout.write(Buffer.from("12345")); return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("bridge", { limits: { maxOutputBytes: 4 } }), limitError);
    assert.equal(delivered, "");
  } finally { await shell.dispose(); }
});

test("independent accounting: cross-channel forwarding retains the shared quota", async () => {
  const shell = makeShell();
  let stdout = "", stderr = "";
  shell.register({ name: "bridge", execute: context => context.invoke!("writer", [], { stdout: context.stderr, stderr: context.stdout }) });
  shell.register({ name: "writer", async execute(context) {
    await context.stdout.write(Buffer.from("123"));
    await context.stderr.write(Buffer.from("45"));
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("bridge", { limits: { maxOutputBytes: 4 },
      stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(); } },
      stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
    }), limitError);
    assert.equal(stdout, ""); assert.equal(stderr, "123");
  } finally { await shell.dispose(); }
});

test("independent accounting: downstream rejection does not refund a permitted write", async () => {
  const shell = makeShell();
  const refusal = new Error("sink refused the first write");
  let observed: unknown, attempts = 0;
  shell.register({ name: "writer", async execute(context) {
    try { await context.stdout.write(Buffer.from("1234")); } catch (error) { observed = error; }
    await context.stdout.write(Buffer.from("5678"));
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("env -i writer", { limits: { maxOutputBytes: 4 }, stdout: {
      async write() { if (++attempts === 1) throw refusal; },
    } }), limitError);
    assert.equal(observed, refusal); assert.equal(attempts, 1);
  } finally { await shell.dispose(); }
});

test("independent accounting: concurrent writes reserve bytes before yielding", async () => {
  const shell = makeShell();
  let attempts = 0;
  shell.register({ name: "writer", async execute(context) {
    await Promise.allSettled([context.stdout.write(Buffer.from("1234")), context.stdout.write(Buffer.from("5678"))]);
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("env -i writer", { limits: { maxOutputBytes: 4 }, stdout: {
      async write() { attempts++; await new Promise<void>(resolve => setImmediate(resolve)); },
    } }), limitError);
    assert.equal(attempts, 1);
  } finally { await shell.dispose(); }
});

test("independent accounting: forwarded pending output preserves abort identity", { timeout: 2000 }, async () => {
  const shell = makeShell(), controller = new AbortController();
  const reason = new Error("review cancellation");
  let started!: () => void, rejectLate!: (error: Error) => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>((_resolve, reject) => { rejectLate = reject; });
  try {
    const execution = shell.exec("env -i printf 1234 | env -i cat", { signal: controller.signal, limits: { maxOutputBytes: 8 }, stdout: {
      async write() { started(); return pending; },
    } });
    const rejected = assert.rejects(execution, error => error === reason);
    await ready; controller.abort(reason); await rejected;
    rejectLate(new Error("late sink failure")); await new Promise<void>(resolve => setImmediate(resolve));
  } finally { controller.abort(reason); rejectLate?.(reason); await shell.dispose(); }
});
