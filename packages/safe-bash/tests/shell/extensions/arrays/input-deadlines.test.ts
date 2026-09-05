import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { ShellInput } from "../../../../src/shell/input.js";
import type { InputClock, ShellInputOptions } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { authenticateOracle } from "../trap/oracle.js";

class Clock implements InputClock {
  time = 0;
  readonly timers = new Map<object, { time: number; expire: () => void }>();
  now(): number { return this.time; }
  schedule(delay: number, expire: () => void): () => void {
    const key = {};
    this.timers.set(key, { time: this.time + delay, expire });
    return () => { this.timers.delete(key); };
  }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [key, timer] of [...this.timers]) if (timer.time <= this.time) {
      this.timers.delete(key);
      timer.expire();
    }
  }
}

function controlled() {
  const pending: { resolve: (result: IteratorResult<Uint8Array>) => void; reject: (error: unknown) => void }[] = [];
  let pulls = 0;
  let returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { pulls++; return new Promise((resolve, reject) => { pending.push({ resolve, reject }); }); },
    async return() { returns++; return { done: true as const, value: undefined }; },
  }; } };
  return {
    source, pending, get pulls() { return pulls; }, get returns() { return returns; },
    send(bytes?: Uint8Array) {
      const reader = pending.shift();
      assert.ok(reader, "a single existing pull must receive the fragment");
      reader.resolve(bytes === undefined ? { done: true, value: undefined } : { done: false, value: bytes });
    },
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(options?: ShellInputOptions, controller = new AbortController()) {
  const producer = controlled();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, controller.signal);
  const input = new ShellInput(producer.source, budget, budget.signal, options);
  return { producer, budget, input, async close() {
    try { await input.close(); } finally { budget.close(); budget.values.close(); }
  } };
}

test("unknown readiness never pulls or fabricates EOF", async () => {
  const subject = fixture();
  try {
    assert.equal(subject.input.readiness(), "unknown");
    assert.equal(subject.input.readiness(), "unknown");
    assert.equal(subject.producer.pulls, 0);
    await assert.rejects(subject.input.line(true, { timeoutMs: 1 }), /provenance/);
    assert.equal(subject.producer.pulls, 0);
  } finally { await subject.close(); }
});

test("explicit polling is captured once and never logically consumes input", async () => {
  let readiness: "blocked" | "ready" | "eof" = "blocked";
  const options: ShellInputOptions = { provenance: "stream", poll: () => readiness };
  const subject = fixture(options);
  try {
    Object.defineProperty(options, "poll", { value: () => "eof" });
    Object.defineProperty(options, "provenance", { value: "regular" });
    assert.equal(subject.input.readiness(), "blocked");
    readiness = "ready";
    assert.equal(subject.input.readiness(), "ready");
    assert.equal(subject.producer.pulls, 0);
    readiness = "eof";
    assert.equal(subject.input.readiness(), "eof");
    assert.equal(subject.producer.pulls, 0);
  } finally { await subject.close(); }
});

test("capability getters and clock methods are captured once for all borrowed views", async () => {
  const reads = { provenance: 0, poll: 0, clock: 0, now: 0, schedule: 0 };
  const clock = new Clock();
  const captured: InputClock = {
    get now() { reads.now++; return clock.now.bind(clock); },
    get schedule() { reads.schedule++; return clock.schedule.bind(clock); },
  };
  const options: ShellInputOptions = {
    get provenance() { reads.provenance++; return "stream" as const; },
    get poll() { reads.poll++; return () => "ready" as const; },
    get clock() { reads.clock++; return captured; },
  };
  const subject = fixture(options);
  const borrower = new ShellInput(subject.input, subject.budget);
  try {
    Object.defineProperty(captured, "now", { value: () => { throw new Error("replacement clock"); } });
    Object.defineProperty(captured, "schedule", { value: () => { throw new Error("replacement scheduler"); } });
    assert.equal(borrower.readiness(), "ready");
    assert.equal(subject.producer.pulls, 0);
    const pending = borrower.line(true, { timeoutMs: 1 });
    await turn();
    clock.advance(1);
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.deepEqual(reads, { provenance: 1, poll: 1, clock: 1, now: 1, schedule: 1 });
    await result.release();
  } finally { await borrower.close(); await subject.close(); }
});

test("regular provenance ignores positive deadlines without scheduling a timer", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "regular", clock });
  try {
    assert.equal(subject.input.readiness(), "ready");
    const pending = subject.input.line(true, { timeoutMs: 0.01 });
    await turn();
    clock.advance(100);
    assert.equal(clock.timers.size, 0);
    subject.producer.send(Uint8Array.of(255, 10));
    const result = await pending;
    assert.equal(result.reason, "delimiter");
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255));
    await result.release();
  } finally { await subject.close(); }
});

test("ignored regular-file deadlines do not consume a second timer allowance", async () => {
  const subject = fixture({ provenance: "regular", clock: new Clock() });
  try {
    const baseline = await subject.input.line(true, { count: 0 });
    const usage = subject.budget.values.usage;
    await baseline.release();
    const timed = await subject.input.line(true, { count: 0, timeoutMs: 1 });
    assert.deepEqual(subject.budget.values.usage, usage);
    await timed.release();
  } finally { await subject.close(); }
});

test("local timeout retains the pending pull and late fragment for a borrowed reader", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  const borrower = new ShellInput(subject.input, subject.budget);
  try {
    const pending = subject.input.line(true, { timeoutMs: 5 });
    await turn();
    assert.equal(subject.producer.pulls, 1);
    clock.advance(5);
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.equal(result.terminated, false);
    assert.equal(result.value, "");
    assert.equal(subject.input.readiness(), "unknown");
    assert.equal(subject.producer.returns, 0);
    subject.producer.send(Uint8Array.of(195, 169, 10, 254));
    await turn();
    assert.equal(borrower.readiness(), "ready");
    const next = await borrower.line(true);
    assert.deepEqual(shellValueBytes(next.shellValue), Uint8Array.of(195, 169));
    assert.equal(subject.producer.pulls, 1);
    assert.equal(subject.input.readiness(), "ready");
    assert.deepEqual((await subject.input.next()).value, Uint8Array.of(254));
    await result.release();
    await next.release();
    assert.equal(clock.timers.size, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await borrower.close(); await subject.close(); }
});

test("partial timeout owns reused producer bytes and exposes byte-accurate fields", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(false, { timeoutMs: 10, byteCount: true });
    await turn();
    const bytes = Uint8Array.of(255, 92, 32, 254, 32, 65);
    subject.producer.send(bytes);
    await turn();
    assert.equal(subject.producer.pulls, 2);
    bytes.fill(90);
    clock.advance(10);
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255, 1, 32, 254, 32, 65));
    assert.deepEqual((await result.fields(" ", 2)).map(field => Buffer.from(shellValueBytes(field.value)).toString("hex")), ["ff0120fe", "41"]);
    await result.release();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("pinned GNU timeout during a multibyte unit assigns only its committed leading byte", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 1, count: 1 });
    await turn();
    subject.producer.send(Uint8Array.of(240, 159));
    await turn();
    clock.advance(1);
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.equal(result.terminated, false);
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(240));
    await result.release();
  } finally { await subject.close(); }
});

test("queueing uses the original deadline without releasing another reader's lock", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const first = subject.input.line(true);
    await turn();
    const timed = subject.input.line(true, { timeoutMs: 3 });
    clock.advance(3);
    const result = await timed;
    assert.equal(result.reason, "timeout");
    assert.equal(result.value, "");
    const third = subject.input.line(true);
    await turn();
    assert.equal(subject.producer.pulls, 1);
    subject.producer.send(Uint8Array.of(65, 10, 66, 10));
    const firstResult = await first;
    const thirdResult = await third;
    assert.equal(firstResult.value, "A");
    assert.equal(thirdResult.value, "B");
    await Promise.all([result.release(), firstResult.release(), thirdResult.release()]);
    assert.equal(clock.timers.size, 0);
  } finally { await subject.close(); }
});

for (const reason of [false, 0, "", null, NaN]) for (const timeoutFirst of [false, true]) {
  test(`root cancellation outranks deadline: ${String(reason)}, timeout first=${timeoutFirst}`, async () => {
    const root = new AbortController();
    const clock = new Clock();
    const subject = fixture({ provenance: "stream", clock }, root);
    const local = new AbortController();
    const borrower = new ShellInput(subject.input, subject.budget, local.signal);
    try {
      const pending = borrower.line(true, { timeoutMs: 2 });
      await turn();
      if (timeoutFirst) clock.advance(2);
      root.abort(reason);
      if (!timeoutFirst) clock.advance(2);
      await assert.rejects(pending, error => Object.is(error, reason));
      assert.equal(clock.timers.size, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await borrower.close().catch(() => {}); await subject.close().catch(() => {}); }
  });
}

test("late EOF is distinguishable from unknown and timeout without a second pull", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 1 });
    await turn();
    clock.advance(1);
    const result = await pending;
    subject.producer.send();
    await turn();
    assert.equal(subject.input.readiness(), "eof");
    const eof = await subject.input.line(true, { timeoutMs: 1 });
    assert.equal(eof.reason, "eof");
    assert.equal(subject.producer.pulls, 1);
    await result.release();
    await eof.release();
  } finally { await subject.close(); }
});

test("late falsey producer failure is observed and not relabeled EOF", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 1 });
    await turn();
    clock.advance(1);
    const result = await pending;
    subject.producer.pending.shift()!.reject(false);
    await turn();
    assert.throws(() => subject.input.readiness(), error => error === false);
    await assert.rejects(subject.input.line(true), error => error === false);
    await result.release();
  } finally { await subject.close(); }
});

test("borrowed cursors reject replacement provenance and clock", async () => {
  const subject = fixture({ provenance: "stream" });
  try {
    assert.throws(() => new ShellInput(subject.input, subject.budget, subject.budget.signal, { provenance: "regular" }), /borrow|cursor/);
  } finally { await subject.close(); }
});

test("close drains a queued timed operation and cancels its timer", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  const active = subject.input.line(true).catch(error => error);
  await turn();
  const queued = subject.input.line(true, { timeoutMs: 20 }).catch(error => error);
  try {
    await subject.input.close();
    assert.equal(clock.timers.size, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.ok(await active instanceof Error);
    assert.ok(await queued instanceof Error);
  } finally { await subject.close(); }
});

test("deadline expiration before queue admission produces a timeout and disposes synchronous timers", async () => {
  let now = 0;
  let cancellations = 0;
  const clock: InputClock = {
    now: () => now,
    schedule(delay, expire) { now += delay; expire(); return () => { cancellations++; }; },
  };
  const subject = fixture({ provenance: "stream", clock });
  try {
    const result = await subject.input.line(true, { timeoutMs: 1 });
    assert.equal(result.reason, "timeout");
    assert.equal(subject.producer.pulls, 0);
    assert.equal(cancellations, 1);
    await result.release();
  } finally { await subject.close(); }
});

test("an elapsed absolute deadline outranks a newly observed EOF even before timer dispatch", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 2 });
    await turn();
    clock.time = 2;
    subject.producer.send();
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.equal(subject.input.readiness(), "eof");
    assert.equal(clock.timers.size, 0);
    await result.release();
  } finally { await subject.close(); }
});

test("empty late fragments cannot fabricate readiness or EOF", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 2 });
    await turn();
    clock.advance(2);
    const result = await pending;
    subject.producer.send(new Uint8Array());
    await turn();
    assert.equal(subject.input.readiness(), "unknown");
    const next = subject.input.line(true, { timeoutMs: 2 });
    await turn();
    assert.equal(subject.producer.pulls, 2);
    subject.producer.send(Uint8Array.of(65, 10));
    const resumed = await next;
    assert.equal(resumed.reason, "delimiter");
    assert.equal(resumed.value, "A");
    await result.release();
    await resumed.release();
  } finally { await subject.close(); }
});

test("partial EOF and count completion cancel unused deadlines", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const first = subject.input.line(true, { timeoutMs: 5, count: 1, byteCount: true });
    await turn();
    subject.producer.send(Uint8Array.of(255, 254));
    const counted = await first;
    assert.equal(counted.reason, "count");
    assert.equal(counted.terminated, true);
    assert.equal(clock.timers.size, 0);
    const second = subject.input.line(true, { timeoutMs: 5 });
    await turn();
    subject.producer.send();
    const eof = await second;
    assert.equal(eof.reason, "eof");
    assert.deepEqual(shellValueBytes(eof.shellValue), Uint8Array.of(254));
    assert.equal(clock.timers.size, 0);
    await counted.release();
    await eof.release();
  } finally { await subject.close(); }
});

test("borrowed view closure cancels its deadline without closing the shared producer", async () => {
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  const borrowed = new ShellInput(subject.input, subject.budget);
  try {
    const pending = borrowed.line(true, { timeoutMs: 5 });
    const rejected = assert.rejects(pending, /closed/);
    await turn();
    await borrowed.close();
    await rejected;
    assert.equal(clock.timers.size, 0);
    assert.equal(subject.producer.returns, 0);
    subject.producer.send(Uint8Array.of(65, 10));
    const result = await subject.input.line(true);
    assert.equal(result.value, "A");
    await result.release();
  } finally { await borrowed.close(); await subject.close(); }
});

test("timer scheduling failures release admitted values before propagating the original reason", async () => {
  const clock: InputClock = { now: () => 0, schedule() { throw false; } };
  const subject = fixture({ provenance: "stream", clock });
  try {
    await assert.rejects(subject.input.line(true, { timeoutMs: 1 }), error => error === false);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.equal(subject.producer.pulls, 0);
  } finally { await subject.close(); }
});

test("timer disposal failure cannot retain a live result scope", async () => {
  let cancellations = 0;
  const clock: InputClock = { now: () => 0, schedule() { return () => { cancellations++; throw false; }; } };
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(true, { timeoutMs: 5, count: 0 });
    await assert.rejects(pending, error => error === false);
    assert.equal(cancellations, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("root cancellation outranks a throwing timer disposer without an uncaught callback", async () => {
  const root = new AbortController();
  let cancellations = 0;
  const clock: InputClock = { now: () => 0, schedule() { return () => { cancellations++; throw new Error("timer cleanup"); }; } };
  const subject = fixture({ provenance: "stream", clock }, root);
  try {
    const pending = subject.input.line(true, { timeoutMs: 5 });
    await turn();
    root.abort(false);
    await assert.rejects(pending, error => error === false);
    assert.equal(cancellations, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close().catch(() => {}); }
});

for (const timeoutMs of [0, -1, NaN, Infinity]) test(`invalid timeout is rejected before pulling: ${String(timeoutMs)}`, async () => {
  const subject = fixture({ provenance: "stream" });
  try {
    await assert.rejects(subject.input.line(true, { timeoutMs }), RangeError);
    assert.equal(subject.producer.pulls, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

async function native(script: string, input: string | Uint8Array, eof: boolean, args: string[] = [], locale = "C"): Promise<Buffer> {
  const executable = authenticateOracle({
    SAFE_BASH_TEST_BASH: process.env.SAFE_BASH_TEST_BASH ?? "/tmp/safe-bash-scripting-oracles-20260904/bash-5.2.37/bash",
    SAFE_BASH_TEST_BASH_SHA256: process.env.SAFE_BASH_TEST_BASH_SHA256 ?? "f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d",
  });
  const child = spawn(executable, ["--noprofile", "--norc", "-c", `IFS= read -r gate; ${script}`, "probe", ...args], { env: { LC_ALL: locale, PATH: "/__no_native_path__" }, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4096) child.kill("SIGKILL"); else stdout.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4096) child.kill("SIGKILL"); else stderr.push(chunk); });
  child.stdin.on("error", () => {});
  try {
    const closed = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => {
        try { assert.equal(signal, null); assert.equal(status, 0); assert.ok(size <= 4096); assert.equal(Buffer.concat(stderr).length, 0); resolve(); }
        catch (error) { reject(error); }
      });
    });
    const payload = Buffer.concat([Buffer.from("go\n"), Buffer.from(input)]);
    if (eof) child.stdin.end(payload);
    else child.stdin.write(payload);
    await closed;
    return Buffer.concat(stdout);
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}

for (const [name, input, eof, expected] of [
  ["ready", "abc\n", false, "0:old\n0:abc\n"],
  ["blocked", "", false, "1:old\n142:\n"],
  ["EOF", "", true, "0:old\n1:\n"],
] as const) test(`authenticated Bash stream zero-timeout is non-consuming: ${name}`, { timeout: 3000 }, async () => {
  const output = await native('value=old; read -t0 value; printf "%s:%s\\n" "$?" "$value"; IFS= read -rt .02 value; printf "%s:%s\\n" "$?" "$value"', input, eof);
  assert.equal(output.toString(), expected);
});

for (const eof of [false, true]) test(`authenticated Bash partial fields distinguish timeout from EOF: ${eof}`, { timeout: 3000 }, async () => {
  const output = await native('first=old; second=old; third=old; read -rt .02 first second third; printf "%s:<%s>:<%s>:<%s>\\n" "$?" "$first" "$second" "$third"', "one two", eof);
  assert.equal(output.toString(), `${eof ? 1 : 142}:<one>:<two>:<>\n`);
});

test("authenticated Bash regular descriptor ignores positive timeout and polls ready at EOF", { timeout: 3000 }, async () => {
  const output = await native('exec 3< "$1"; value=old; read -t0 -u3 value; printf "%s:%s\\n" "$?" "$value"; IFS= read -rt .000001 -u3 value; printf "%s:%s\\n" "$?" "$value"; while IFS= read -r -u3 value; do :; done; read -t0 -u3 value; printf "%s\\n" "$?"', "", true, [fileURLToPath(import.meta.url)]);
  assert.equal(output.toString(), '0:old\n0:import assert from "node:assert/strict";\n0\n');
});

for (const [name, input, expected, raw] of [
  ["completed escape", "61205c20622063", "313432006120012062206300", false],
  ["trailing escape", "615c", "31343200610100", false],
  ["standalone escape", "5c", "313432000100", false],
  ["continuation", "615c0a62", "31343200616200", false],
  ["incomplete UTF8 unit", "f09f", "31343200f000", true],
] as const) test(`native timeout assignment projection: ${name}`, { timeout: 3000 }, async () => {
  const bytes = Buffer.from(input, "hex");
  const output = await native(`IFS= read ${raw ? "-r" : ""} -t .02 value; printf '%s\\0%s\\0' "$?" "$value"`, bytes, false, [], "en_US.UTF-8");
  assert.equal(output.toString("hex"), expected);
  const clock = new Clock();
  const subject = fixture({ provenance: "stream", clock });
  try {
    const pending = subject.input.line(raw, { timeoutMs: 2 });
    await turn();
    subject.producer.send(bytes);
    await turn();
    clock.advance(2);
    const result = await pending;
    assert.equal(result.reason, "timeout");
    assert.equal(Buffer.concat([Buffer.from("142\0"), shellValueBytes(result.shellValue), Buffer.from([0])]).toString("hex"), expected);
    await result.release();
  } finally { await subject.close(); }
});
