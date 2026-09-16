import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import type { ByteSource } from "../../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { ShellInput, type InputClock, type InputReadiness, type ShellInputOptions } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

class Clock implements InputClock {
  time = 0;
  readonly timers = new Map<object, { expires: number; run: () => void }>();
  now(): number { return this.time; }
  schedule(delay: number, run: () => void): () => void {
    const token = {};
    this.timers.set(token, { expires: this.time + delay, run });
    return () => { this.timers.delete(token); };
  }
  advance(delay: number): void {
    this.time += delay;
    for (const [token, timer] of [...this.timers]) if (timer.expires <= this.time) { this.timers.delete(token); timer.run(); }
  }
}

function fixture(options: { readonly input?: Uint8Array | undefined; readonly eof?: boolean; readonly provenance?: ShellInputOptions["provenance"] } = {}) {
  const queued: Uint8Array[] = options.input?.length ? [new Uint8Array(options.input)] : [];
  let ended = options.eof ?? false;
  let pulls = 0;
  let pending: ((value: IteratorResult<Uint8Array>) => void) | undefined;
  const waiting = deferred<void>();
  const marker = deferred<void>();
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    next() {
      pulls++;
      const bytes = queued.shift();
      if (bytes) return Promise.resolve({ done: false as const, value: bytes });
      if (ended) return Promise.resolve({ done: true as const, value: undefined });
      assert.equal(pending, undefined);
      const promise = new Promise<IteratorResult<Uint8Array>>(resolve => { pending = resolve; });
      waiting.resolve();
      return promise;
    },
    return: async () => ({ done: true as const, value: undefined }),
  }) };
  const clock = new Clock();
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, controller.signal);
  const readiness = (): InputReadiness => queued.length ? "ready" : ended ? "eof" : "blocked";
  const input = new ShellInput(source, budget, budget.signal, { provenance: options.provenance ?? "stream", poll: readiness, clock });
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [readExtension()] });
  for (const command of basicCommands()) shell.register(command);
  const send = (bytes?: Uint8Array): void => {
    const receive = pending;
    pending = undefined;
    if (bytes === undefined) ended = true;
    if (receive) receive(bytes === undefined ? { done: true, value: undefined } : { done: false, value: bytes });
    else if (bytes) queued.push(bytes);
  };
  return { shell, fs, source, input, clock, controller, waiting, marker, send, get pulls() { return pulls; },
    exec(script: string) { return shell.exec(script, { stdin: input, env: { LC_ALL: "C" }, signal: controller.signal, stdout: { write: async bytes => { if (bytes.includes(0)) marker.resolve(); } } }); },
    async close() {
      send();
      try { await shell.dispose(); await input.close(); }
      finally { budget.close(); budget.values.close(); }
    },
  };
}

for (const route of ["read", "builtin read", "command read"]) test(`actual Shell installs opt-in replacement for ${route}`, async context => {
  const subject = fixture({ input: Buffer.from("one two\n"), eof: true });
  context.after(() => subject.close());
  const result = await subject.exec(`${route} -a values; printf '%s:<%s>' "$?" "\${values[*]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0:<one two>");
  assert.equal(result.stderr, "");
});

for (const state of ["ready", "blocked", "eof"] as const) for (const target of ["value", "-a values", "bad-name", "-a bad-name", "-n0 value", "-N0 -a values", "-s value"]) {
  test(`actual Shell -t0 ${state} skips assignment for ${target}`, async context => {
    const subject = fixture({ input: state === "ready" ? Buffer.from("one\n") : undefined, eof: state === "eof" });
    context.after(() => subject.close());
    const result = await subject.exec(`value=OLD; values=(old keep); readonly value values; read -t0 ${target}; printf '%s:<%s>:<%s>' "$?" "$value" "\${values[*]}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${state === "blocked" ? 1 : 0}:<OLD>:<old keep>`);
    assert.equal(result.stderr, "");
    assert.equal(subject.pulls, 0);
    assert.equal(subject.clock.timers.size, 0);
    if (state === "ready") {
      const tail = await subject.exec(`read -r value; printf '%s' "$value"`);
      assert.equal(tail.stdout, "one");
    }
  });
}

const assignmentCases = [
  { name: "partial scalar", args: "-rt.02 value", input: "one two", output: "142:<one two>:<old keep>" },
  { name: "empty scalar", args: "-t.02 value", input: "", output: "142:<>:<old keep>" },
  { name: "partial array", args: "-rt.02 -a values", input: "one two", output: "142:<OLD>:<one two>" },
  { name: "empty array", args: "-t.02 -a values", input: "", output: "142:<OLD>:<>" },
  { name: "TMOUT partial scalar", before: "TMOUT=.02;", args: "value", input: "one two", output: "142:<one two>:<old keep>" },
  { name: "explicit timeout overrides invalid TMOUT", before: "TMOUT=invalid;", args: "-t.02 value", input: "", output: "142:<>:<old keep>" },
  { name: "explicit timeout overrides disabled TMOUT", before: "TMOUT=0;", args: "-t.02 value", input: "", output: "142:<>:<old keep>" },
  { name: "last positive timeout wins", args: "-t0 -t.02 value", input: "one", output: "142:<one>:<old keep>" },
  { name: "partial count", args: "-rt.02 -n5 value", input: "ab", output: "142:<ab>:<old keep>" },
  { name: "partial exact count", args: "-rt.02 -N5 value", input: "ab\n", output: "142:<ab\n>:<old keep>" },
  { name: "readonly scalar changes status", before: "readonly value;", args: "-t.02 value", input: "one", output: "1:<OLD>:<old keep>", diagnostic: "value: readonly variable" },
  { name: "readonly array changes status", before: "readonly values;", args: "-t.02 -a values", input: "one", output: "1:<OLD>:<old keep>", diagnostic: "values: readonly variable" },
  { name: "invalid array changes status after timeout", args: "-t.02 -a bad-name", input: "one", output: "1:<OLD>:<old keep>", diagnostic: "read: `bad-name': not a valid identifier" },
  { name: "TMOUT unsigned seconds conversion", before: "TMOUT=4294967297;", args: "value", input: "one", output: "142:<one>:<old keep>", duration: 1000 },
] as const;

for (const entry of assignmentCases) test(`actual Shell timed assignment: ${entry.name}`, async context => {
  const subject = fixture({ input: Buffer.from(entry.input) });
  context.after(() => subject.close());
  const execution = subject.exec(`value=OLD; values=(old keep); ${"before" in entry ? entry.before : ""} read ${entry.args}; printf '%s:<%s>:<%s>\\0' "$?" "$value" "\${values[*]}"; read -r tail; printf 'tail=<%s>' "$tail"`);
  const early = execution.then(() => { throw new Error("Execution finished before enrolled input deadline"); });
  await Promise.race([subject.waiting.promise, early]);
  assert.equal(subject.clock.timers.size, 1);
  subject.clock.advance("duration" in entry ? entry.duration : 20);
  await Promise.race([subject.marker.promise, early]);
  assert.equal(subject.clock.timers.size, 0);
  subject.send(Buffer.from("TAIL\n"));
  const result = await execution;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `${entry.output}\0tail=<TAIL>`);
  assert.equal(result.stderr, "diagnostic" in entry ? `shell: line 1: ${entry.diagnostic}\n` : "");
});

for (const args of ["-t.02 -n0 value", "-t.02 -N0 -a values", "-t.0000005 -n0 value"]) test(`zero-count assignment precedes positive deadline: ${args}`, async context => {
  const subject = fixture();
  context.after(() => subject.close());
  const result = await subject.exec(`value=OLD; values=(old keep); read ${args}; printf '%s:<%s>:<%s>' "$?" "$value" "\${values[*]}"`);
  assert.equal(result.stdout, args.includes("-a") ? "0:<OLD>:<>" : "0:<>:<old keep>");
  assert.equal(result.stderr, "");
  assert.equal(subject.pulls, 0);
  assert.equal(subject.clock.timers.size, 0);
});

for (const tmout of ["invalid", "-1", "", "0"]) test(`invalid or disabled TMOUT permits ordinary read: ${JSON.stringify(tmout)}`, async context => {
  const subject = fixture({ input: Buffer.from("one\n"), eof: true });
  context.after(() => subject.close());
  const result = await subject.exec(`TMOUT='${tmout}'; read value; printf '%s:<%s>' "$?" "$value"`);
  assert.equal(result.stdout, "0:<one>");
  assert.equal(result.stderr, "");
  assert.equal(subject.clock.timers.size, 0);
});

for (const entry of [
  { args: "-t0 value 0<&-", value: "OLD", diagnostic: "" },
  { args: "-t0 -n0 value 0<&-", value: "OLD", diagnostic: "" },
  { args: "-n0 value 0<&-", value: "", diagnostic: "" },
  { args: "-t0 -u0 value 0<&-", value: "OLD", diagnostic: "shell: line 1: read: 0: invalid file descriptor: Bad file descriptor\n" },
  { args: "-t0 -N0 -u9 value 9<&-", value: "OLD", diagnostic: "shell: line 1: read: 9: invalid file descriptor: Bad file descriptor\n" },
]) test(`closed descriptor and timeout precedence: ${entry.args}`, async context => {
  const subject = fixture({ input: Buffer.from("one\n"), eof: true });
  context.after(() => subject.close());
  const result = await subject.exec(`value=OLD; read ${entry.args}; printf '%s:<%s>:' "$?" "$value"; read -r tail; printf '%s' "$tail"`);
  assert.equal(result.stdout, `1:<${entry.value}>:one`);
  assert.equal(result.stderr, entry.diagnostic);
});

for (const args of ["-t4294967296 -n0 value", "-t4294967297 -n0 value", "-t9223372036854775807 -n0 value", "-t4294967296.000001 -n0 value"]) {
  test(`actual Shell matches pinned unsigned timeout conversion: ${args}`, async context => {
    const subject = fixture({ input: Buffer.from("one\n"), eof: true });
    context.after(() => subject.close());
    const script = `value=OLD; read ${args}; printf '%s:<%s>' "$?" "$value"`;
    const native = primaryReference("timed.test.ts", script, "one\n");
    const result = await subject.exec(script);
    assert.equal(native.status, 0);
    assert.equal(result.exitCode, native.status);
    assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
    assert.deepEqual(result.stderrBytes, new Uint8Array(native.stderr));
    assert.equal(subject.pulls, 0);
    assert.equal(subject.clock.timers.size, 0);
  });
}

for (const input of ["", " one "]) test(`timed default REPLY assigns exact partial bytes: ${JSON.stringify(input)}`, async context => {
  const subject = fixture({ input: Buffer.from(input) });
  context.after(() => subject.close());
  const execution = subject.exec(`REPLY=OLD; read -rt.02; printf '%s:<%s>' "$?" "$REPLY"`);
  const early = execution.then(() => { throw new Error("Read did not await its deadline"); });
  await Promise.race([subject.waiting.promise, early]);
  subject.clock.advance(20);
  const result = await execution;
  assert.equal(result.stdout, `142:<${input}>`);
  assert.equal(result.stderr, "");
});

test("timed raw arrays preserve distinct invalid UTF-8 values", async context => {
  const subject = fixture({ input: Uint8Array.of(255, 32, 254) });
  context.after(() => subject.close());
  const execution = subject.exec(`read -rt.02 -a values; printf '%s:' "$?"; printf '%s' "\${values[@]}"`);
  const early = execution.then(() => { throw new Error("Read did not await its deadline"); });
  await Promise.race([subject.waiting.promise, early]);
  subject.clock.advance(20);
  const result = await execution;
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(49, 52, 50, 58, 255, 254));
  assert.equal(result.stderr, "");
});

test("timed descriptor aliases retain one pending pull for the following read", async context => {
  const subject = fixture({ input: Buffer.from("one") });
  context.after(() => subject.close());
  const execution = subject.exec(`{ read -t.02 -u3 first; printf '%s:<%s>\\0' "$?" "$first"; read -r -u4 second; printf '<%s>' "$second"; } 3<&0 4<&3`);
  const early = execution.then(() => { throw new Error("Alias read did not await its deadline"); });
  await Promise.race([subject.waiting.promise, early]);
  assert.equal(subject.pulls, 2);
  subject.clock.advance(20);
  await Promise.race([subject.marker.promise, early]);
  subject.send(Buffer.from("TAIL\n"));
  const result = await execution;
  assert.equal(result.stdout, "142:<one>\0<TAIL>");
  assert.equal(result.stderr, "");
  assert.equal(subject.pulls, 2);
});

for (const prefix of ["TMOUT=.02; read -t0", "read -t.02 -t0", "read -t.0000004"]) test(`zero timeout selection never starts a deadline: ${prefix}`, async context => {
  const subject = fixture();
  context.after(() => subject.close());
  const result = await subject.exec(`value=OLD; ${prefix} value; printf '%s:<%s>' "$?" "$value"`);
  assert.equal(result.stdout, "1:<OLD>");
  assert.equal(result.stderr, "");
  assert.equal(subject.pulls, 0);
  assert.equal(subject.clock.timers.size, 0);
});

test("actual Shell root cancellation retains false instead of timeout status", async context => {
  const subject = fixture({ input: Buffer.from("partial") });
  context.after(() => assert.rejects(subject.close(), reason => reason === false));
  const execution = subject.exec("read -t.02 value");
  const observed = execution.then(result => ({ result }), reason => ({ reason }));
  await Promise.race([subject.waiting.promise, execution]);
  subject.clock.advance(20);
  subject.controller.abort(false);
  const result = await observed;
  assert.ok("reason" in result);
  assert.equal(result.reason, false);
  assert.equal(subject.clock.timers.size, 0);
});

test("actual Shell consumes a complete record before the positive deadline", async context => {
  const subject = fixture({ input: Buffer.from("one two\n"), eof: true });
  context.after(() => subject.close());
  const result = await subject.exec(`read -t.02 -a values; printf '%s:<%s>' "$?" "\${values[*]}"`);
  assert.equal(result.stdout, "0:<one two>");
  assert.equal(result.stderr, "");
  assert.equal(subject.clock.timers.size, 0);
});

test("actual Shell distinguishes partial EOF from partial timeout", async context => {
  const subject = fixture({ input: Buffer.from("one two"), eof: true });
  context.after(() => subject.close());
  const result = await subject.exec(`read -t.02 -a values; printf '%s:<%s>' "$?" "\${values[*]}"`);
  assert.equal(result.stdout, "1:<one two>");
  assert.equal(result.stderr, "");
  assert.equal(subject.clock.timers.size, 0);
});

test("positive timeout ignores the deadline on an explicitly owned memory-file source", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("one\n"));
  assert.equal((await fs.stat("/input")).type, "file");
  const clock = new Clock();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, new AbortController().signal);
  const input = new ShellInput(fs.readStream!("/input"), budget, budget.signal, { provenance: "regular", clock });
  const shell = new Shell({ fs, extensions: [readExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(async () => { try { await shell.dispose(); await input.close(); } finally { budget.close(); budget.values.close(); } });
  const result = await shell.exec(`read -t.000001 value; printf '%s:<%s>' "$?" "$value"`, { stdin: input });
  assert.equal(result.stdout, "0:<one>");
  assert.equal(result.stderr, "");
  assert.equal(clock.timers.size, 0);
});
