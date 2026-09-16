import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import type { ByteSource } from "../../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { ShellInput, type InputClock, type InputReadiness } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class Clock implements InputClock {
  time = 0;
  readonly delays: number[] = [];
  readonly timers = new Map<object, { expires: number; run: () => void }>();
  now(): number { return this.time; }
  schedule(delay: number, run: () => void): () => void {
    const token = {};
    this.delays.push(delay);
    this.timers.set(token, { expires: this.time + delay, run });
    return () => { this.timers.delete(token); };
  }
  advance(delay: number): void {
    this.time += delay;
    for (const [token, timer] of this.timers) if (timer.expires <= this.time) {
      this.timers.delete(token);
      timer.run();
    }
  }
}

function fixture(initial: Uint8Array = new Uint8Array(), readiness?: InputReadiness) {
  const chunks: Uint8Array[] = initial.length ? [new Uint8Array(initial)] : [];
  const waiting = deferred<void>(), marker = deferred<void>();
  let pending: ReturnType<typeof deferred<IteratorResult<Uint8Array>>> | undefined;
  let ended = false, pulls = 0, returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      pulls++;
      assert.equal(pending, undefined, "A timed-out pull must be retained, not competed with");
      const value = chunks.shift();
      if (value) return Promise.resolve({ done: false as const, value });
      if (ended) return Promise.resolve({ done: true as const, value: undefined });
      pending = deferred<IteratorResult<Uint8Array>>();
      waiting.resolve();
      return pending.promise;
    },
    async return() { returns++; return { done: true as const, value: undefined }; },
  }; } };
  const clock = new Clock(), controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, controller.signal);
  const input = new ShellInput(source, budget, budget.signal, {
    provenance: "stream", clock,
    poll: () => readiness ?? (chunks.length ? "ready" : ended ? "eof" : "blocked"),
  });
  const failures: unknown[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), onInternalError: reason => { failures.push(reason); }, extensions: [readExtension()] });
  for (const command of basicCommands()) shell.register(command);
  function send(bytes?: Uint8Array): void {
    const receiver = pending;
    pending = undefined;
    if (bytes === undefined) ended = true;
    if (receiver) receiver.resolve(bytes === undefined ? { done: true, value: undefined } : { done: false, value: bytes });
    else if (bytes) chunks.push(bytes);
  }
  return { shell, clock, controller, waiting, marker, send, failures,
    get pulls() { return pulls; }, get returns() { return returns; },
    fail(reason: unknown) { assert.ok(pending); const receiver = pending; pending = undefined; receiver.reject(reason); },
    exec(script: string) {
      const execution = shell.exec(script, { stdin: input, env: { LC_ALL: "C" }, signal: controller.signal,
        stdout: { write: async chunk => { if (chunk.includes(0)) marker.resolve(); } },
      });
      void execution.catch(() => {});
      return execution;
    },
    async close() {
      send();
      try {
        await shell.dispose();
        try { await input.close(); }
        catch (reason) { if (!controller.signal.aborted || !Object.is(reason, controller.signal.reason)) throw reason; }
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

for (const route of ["read", "builtin read", "command read"]) test(`timed review: explicit factory replacement admits ${route}`, async context => {
  const definition = readExtension();
  assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(definition.create().builtins[0]!.replace, true);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [definition] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`${route} -rt1 -a values; printf '%s:<%s>' "$?" "\${values[*]}"`, { stdin: Buffer.from("one two\n") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0:<one two>");
  assert.equal(result.stderr, "");
});

const timeoutGrammar = [
  "-0.1", "-.1", "-00.000001", "-0.0000005", "-0.9999999", "-1.1", "-0.0000004",
  "+.0000005", "1.000000junk", "1.00000junk", "1.9999999", " 0", "0 ", "0\n",
  "0x0", "1e-3", "", "+", "-", ".", "-.", "4294967296", "4294967296.000001",
];

for (const value of timeoutGrammar) test(`timed review native grammar and unread tail: ${JSON.stringify(value)}`, async context => {
  const script = `value=OLD; read -t '${value}' -n0 value; printf '%s:<%s>;' "$?" "$value"; read -r tail; printf '<%s>' "$tail"`;
  const expected = primaryReference("timed-review.test.ts", script, "untouched\n");
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [readExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(script, { stdin: Buffer.from("untouched\n"), env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, expected.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
  assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
});

for (const entry of [
  { name: "negative fractional explicit", before: "", args: "-rt-0.02 value" },
  { name: "negative fractional inherited", before: "TMOUT=-0.02;", args: "-r value" },
  { name: "positive inherited", before: "TMOUT=.02;", args: "-r value" },
  { name: "explicit overrides inherited", before: "TMOUT=1;", args: "-rt.02 value" },
  { name: "last timeout wins", before: "", args: "-rt1 -t.02 value" },
]) test(`timed review: ${entry.name} selects the primary deadline and retains pending input`, async context => {
  const subject = fixture(Buffer.from("part"));
  context.after(() => subject.close());
  const execution = subject.exec(`${entry.before} read ${entry.args}; printf '%s:<%s>\\0' "$?" "$value"; read -r tail; printf '<%s>' "$tail"`);
  await Promise.race([subject.waiting.promise, execution]);
  if (entry.name === "negative fractional explicit" || entry.name === "negative fractional inherited") {
    assert.deepEqual(subject.clock.delays, []);
    assert.equal(subject.pulls, 2);
    assert.equal(subject.returns, 0);
    subject.clock.advance(20);
    assert.equal(subject.clock.timers.size, 0);
    subject.send(Buffer.from("TAIL\n"));
    await Promise.race([subject.marker.promise, execution]);
    if (entry.name === "negative fractional inherited") subject.send(Buffer.from("FOLLOW\n"));
    const result = await execution;
    const program = `${entry.before} read ${entry.args}; printf '%s:<%s>\\0' "$?" "$value"; read -r tail; printf '<%s>' "$tail"`;
    const expected = primaryReference("timed-review.test.ts", `IFS= read -rt1 -u3 start || exit 97; printf '__READY__\\n'; ${program}`, undefined, [
      { fd: 0, method: "write", hex: "70617274" },
      { fd: 3, method: "end", hex: "73746172740a" },
      { fd: 0, method: "end", hex: "5441494c0a464f4c4c4f570a" },
    ]);
    const marker = Buffer.from("__READY__\n");
    assert.deepEqual(expected.stdout.subarray(0, marker.length), marker);
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout.subarray(marker.length));
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
    return;
  }
  assert.deepEqual(subject.clock.delays, [20]);
  subject.clock.advance(20);
  await Promise.race([subject.marker.promise, execution]);
  assert.equal(subject.pulls, 2);
  assert.equal(subject.returns, 0);
  subject.send(Buffer.from("TAIL\n"));
  const result = await execution;
  assert.equal(result.stdout, "142:<part>\0<TAIL>");
  assert.equal(result.stderr, "");
  assert.equal(subject.clock.timers.size, 0);
});

const partialCases = [
  { name: "escaped IFS separator", before: "IFS=:;", args: "-t.03 -a values", input: Buffer.from("one\\:two:three"), output: Buffer.from("142:<one\x01:two><three>") },
  { name: "trailing backslash", before: "", args: "-t.03 value", input: Buffer.from("part\\"), output: Buffer.from("142:<part\x01>") },
  { name: "continued line", before: "", args: "-t.03 value", input: Buffer.from("one\\\ntwo"), output: Buffer.from("142:<onetwo>") },
  { name: "raw backslash", before: "", args: "-rt.03 value", input: Buffer.from("part\\"), output: Buffer.from("142:<part\\>") },
  { name: "raw NUL-delimited partial bytes", before: "", args: "-rt.03 -d '' -a values", input: Buffer.from([255, 32, 254]), output: Buffer.from([49, 52, 50, 58, 60, 255, 62, 60, 254, 62]) },
  { name: "later readonly scalar", before: "readonly last=old;", args: "-rt.03 value last", input: Buffer.from("one two"), output: Buffer.from("1:<one><old>"), error: "shell: line 1: last: readonly variable\n" },
  { name: "later invalid scalar", before: "", args: "-rt.03 value bad-name", input: Buffer.from("one two"), output: Buffer.from("1:<one>"), error: "shell: line 1: read: `bad-name': not a valid identifier\n" },
  { name: "readonly array", before: "values=(old keep); readonly values;", args: "-rt.03 -a values", input: Buffer.from("one two"), output: Buffer.from("1:<old><keep>"), error: "shell: line 1: values: readonly variable\n" },
] as const;

function partialScript(entry: typeof partialCases[number]): string {
  const values = entry.args.includes("-a values") ? '"${values[@]}"' : entry.args.endsWith("value last") ? '"$value" "$last"' : '"$value"';
  return `${entry.before} read ${entry.args}; printf '%s:' "$?"; printf '<%s>' ${values}`;
}

for (const entry of partialCases) test(`timed review real cursor partial publication: ${entry.name}`, async context => {
  const subject = fixture(entry.input);
  context.after(() => subject.close());
  const execution = subject.exec(partialScript(entry));
  await Promise.race([subject.waiting.promise, execution]);
  assert.deepEqual(subject.clock.delays, [30]);
  subject.clock.advance(30);
  const result = await execution;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), entry.output);
  assert.equal(result.stderr, "error" in entry ? entry.error : "");
  assert.equal(subject.returns, 0);
  assert.equal(subject.clock.timers.size, 0);
});

function partialReference(script: string, bytes: Uint8Array) {
  return primaryReference("timed-review.test.ts", `IFS= read -rt1 -u3 start || exit 97; ${script}`, undefined, [
    { fd: 0, method: "write", hex: Buffer.from(bytes).toString("hex") },
    { fd: 3, method: "end", hex: Buffer.from("start\n").toString("hex") },
  ]);
}

for (const entry of partialCases) test(`timed review frozen primary partial publication: ${entry.name}`, () => {
  const result = partialReference(partialScript(entry), entry.input);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, entry.output);
  assert.deepEqual(result.stderr, Buffer.from("error" in entry ? entry.error : ""));
});

test("timed review frozen primary: invalid negative TMOUT waits for bounded release", () => {
  const result = primaryReference("timed-review.test.ts", "IFS= read -r -t1 -u3 start || exit 97; printf 'READY\\n'; TMOUT=-0.03; read -r value; printf 'RESULT=%s:<%s>\\n' \"$?\" \"$value\"; IFS= read -r -t1 -u3 finish || exit 98; printf 'DONE\\n'", undefined, [
    { fd: 0, method: "write", hex: "70617274" },
    { fd: 3, method: "write", hex: "73746172740a" },
    { fd: 0, method: "end", hex: "0a" },
    { fd: 3, method: "end", hex: "66696e6973680a" },
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from("READY\nRESULT=0:<part>\nDONE\n"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.equal(result.release?.minimumHoldMs, 150);
  const released = result.release?.events.findIndex(entry => entry.kind === "release");
  assert.ok(released !== undefined && released >= 0);
  assert.ok(result.release!.events.slice(0, released).filter(entry => entry.kind === "stdout").every(entry => entry.hex === "52454144590a"));
});

for (const state of ["ready", "blocked", "eof", "unknown"] as const) test(`timed review: zero readiness ${state} does not consume or validate readonly and invalid targets`, async context => {
  const subject = fixture(Buffer.from("keep\n"), state);
  context.after(() => subject.close());
  const result = await subject.exec("values=(old); readonly values; read -t0 -a values bad-name; printf '%s:<%s>' \"$?\" \"${values[*]}\"");
  assert.equal(result.stdout, `${state === "ready" || state === "eof" ? 0 : 1}:<old>`);
  assert.equal(result.stderr, state === "unknown" ? "shell: line 1: read: input readiness is unknown for this cursor\n" : "");
  assert.equal(subject.pulls, 0);
  assert.deepEqual(subject.clock.delays, []);
});

test("timed review: zero readiness after timeout observes retained pull without starting another", async context => {
  const subject = fixture(Buffer.from("part"));
  context.after(() => subject.close());
  const execution = subject.exec("read -rt.03 value; printf '%s:<%s>;' \"$?\" \"$value\"; read -t0 ignored; printf '%s\\0' \"$?\"; read -r tail; printf '<%s>' \"$tail\"");
  await subject.waiting.promise;
  subject.clock.advance(30);
  await subject.marker.promise;
  assert.equal(subject.pulls, 2);
  assert.equal(subject.returns, 0);
  subject.send(Buffer.from("TAIL\n"));
  const result = await execution;
  assert.equal(result.stdout, "142:<part>;1\0<TAIL>");
  assert.equal(result.stderr, "");
});

test("timed review: deadline completion releases only its lease and permits subsequent invocation reuse", async context => {
  const subject = fixture(Buffer.from("partial"));
  context.after(() => subject.close());
  const execution = subject.exec("read -rt.03 value; printf '%s:<%s>' \"$?\" \"$value\"");
  await subject.waiting.promise;
  subject.clock.advance(30);
  const first = await execution;
  assert.equal(first.stdout, "142:<partial>");
  assert.equal(first.stderr, "");
  assert.equal(subject.pulls, 2);
  assert.equal(subject.returns, 0);
  subject.send(Buffer.from("next\n"));
  const second = await subject.exec("builtin read -r value; printf '%s:<%s>' \"$?\" \"$value\"");
  assert.equal(second.stdout, "0:<next>");
  assert.equal(second.stderr, "");
  assert.equal(subject.pulls, 2);
  assert.equal(subject.returns, 0);
  assert.equal(subject.clock.timers.size, 0);
  await subject.close();
  assert.equal(subject.returns, 1);
});

for (const reason of [false, 0, "", null]) test(`timed review: falsey root cancellation ${String(reason)} releases deadline without publishing`, async context => {
  const subject = fixture(Buffer.from("partial"));
  context.after(() => subject.close());
  const execution = subject.exec("value=old; read -rt.03 value; printf 'unexpected:%s' \"$value\"");
  const rejection = assert.rejects(execution, error => Object.is(error, reason));
  await subject.waiting.promise;
  subject.controller.abort(reason);
  await rejection;
  assert.equal(subject.clock.timers.size, 0);
});

for (const reason of [false, 0, "", null]) test(`timed review: falsey producer failure ${String(reason)} is not timeout or EOF`, async context => {
  const subject = fixture(Buffer.from("partial"));
  context.after(() => subject.close());
  const execution = subject.exec("value=old; read -rt.03 value; printf '%s:<%s>' \"$?\" \"$value\"");
  await subject.waiting.promise;
  subject.fail(reason);
  const result = await execution;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<old>");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.deepEqual(subject.failures, [reason]);
  assert.equal(subject.clock.timers.size, 0);
});
