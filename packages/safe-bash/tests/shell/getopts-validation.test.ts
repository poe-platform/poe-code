import assert from "node:assert/strict";
import { test } from "node:test";
import type { GetoptsState, GetoptsWork } from "../../src/shell/getopts.js";
import * as scanner from "../../src/shell/getopts.js";
import { Runtime } from "../../src/shell/runtime.js";
import { stateMonitor } from "../../src/shell/arrays/state.js";
import { ValueScope } from "../../src/shell/value-state.js";
import { setup } from "./helpers.js";

function options(work: Partial<GetoptsWork> = {}) {
  return { reportErrors: true, work: { maxArguments: 256, maxBytes: 4096, maxSteps: 10000, yieldEvery: 128, checkpoint: () => undefined, ...work } };
}

async function owned(args: readonly string[], work: Partial<GetoptsWork> = {}): Promise<Parameters<typeof scanner.scanGetopts>[2]> {
  const create = Reflect.get(scanner, "createGetoptsInput");
  assert.equal(typeof create, "function", "owned immutable getopts input factory is required");
  return await create(args, undefined, options(work).work) as Parameters<typeof scanner.scanGetopts>[2];
}

for (const clustered of [false, true]) {
  test(`owned ${clustered ? "clustered" : "separate"} argv scans charge linear validation work`, async context => {
    const totals: number[] = [];
    for (const count of [16, 32, 64, 128]) {
      const args = clustered ? [`-${"a".repeat(count)}`] : Array.from({ length: count }, () => "-a");
      let charged = 0;
      const input = await owned(args, { checkpoint: steps => { charged += steps; } });
      let state = scanner.createGetoptsState();
      for (let index = 0; index <= count; index++) {
        const result = await scanner.scanGetopts(state, "a", input, options({ checkpoint: steps => { charged += steps; } }));
        assert.equal(result.status, index === count ? 1 : 0);
        if (index < count) assert.equal(result.option, "a");
        state = result.state;
      }
      assert.equal(state.index, clustered ? 2 : count + 1);
      totals.push(charged);
    }
    context.diagnostic(JSON.stringify({ clustered, totals }));
    assert.deepEqual(totals, [16, 32, 64, 128].map(count => clustered ? 5 * count + 7 : 8 * count + 4));
  });

  test(`public Shell ${clustered ? "clustered" : "separate"} positionals avoid repeated full admission`, async context => {
    const totals: { count: number; charCodes: number; argumentBytes: number; argumentReads: number }[] = [];
    let active = false;
    let charCodes = 0;
    let argumentBytes = 0;
    let argumentReads = 0;
    let observed = new WeakSet<string[]>();
    let argument = "";
    const charCodeAt = String.prototype.charCodeAt;
    const byteLength = Buffer.byteLength;
    const builtin = Runtime.prototype.builtin;
    context.mock.method(String.prototype, "charCodeAt", function (this: string, index: number) {
      if (active) charCodes++;
      return charCodeAt.call(this, index);
    });
    context.mock.method(Buffer, "byteLength", (value: Parameters<typeof Buffer.byteLength>[0], encoding?: BufferEncoding) => {
      if (active && value === argument) argumentBytes += argument.length;
      return byteLength(value, encoding);
    });
    context.mock.method(Runtime.prototype, "builtin", async function (this: Runtime, ...args: Parameters<Runtime["builtin"]>) {
      if (args[0].command !== "getopts") return builtin.apply(this, args);
      const positional = stateMonitor(args[1])!.raw.positional;
      if (!observed.has(positional)) {
        observed.add(positional);
        for (let index = 0; index < positional.length; index++) {
          const value = positional[index];
          Object.defineProperty(positional, index, { configurable: true, enumerable: true, get() {
            if (active) argumentReads++;
            return value;
          } });
        }
      }
      active = true;
      try { return await builtin.apply(this, args); }
      finally { active = false; }
    });
    for (const count of [16, 32, 64, 128]) {
      argument = clustered ? `-${"a".repeat(count)}` : "-a";
      const args = clustered ? [argument] : Array.from({ length: count }, () => argument);
      const { shell } = setup();
      charCodes = 0;
      argumentBytes = 0;
      argumentReads = 0;
      observed = new WeakSet();
      try {
        const result = await shell.exec(`set -- ${args.join(" ")}; while getopts a opt; do :; done; say "$OPTIND"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `${clustered ? 2 : count + 1}\n`);
        totals.push({ count, charCodes, argumentBytes, argumentReads });
      } finally { await shell.dispose(); }
    }
    context.diagnostic(JSON.stringify({ clustered, totals }));
    for (const total of totals) {
      assert.ok(total.charCodes <= 16 * total.count + 256, `charCodeAt work must be linear: ${JSON.stringify(total)}`);
      assert.ok(total.argumentBytes <= 8 * total.count + 32, `runtime admission bytes must be linear: ${JSON.stringify(total)}`);
      assert.equal(total.argumentReads, clustered ? 1 : total.count, `unchanged positionals are copied exactly once: ${JSON.stringify(total)}`);
    }
  });
}

for (const maxExpansionBytes of [64, 128, 256, 512]) {
  test(`cache does not turn tight existing ${maxExpansionBytes}-byte success into an admission failure`, async () => {
    const { shell } = setup({ limits: { maxExpansionBytes } });
    try {
      const result = await shell.exec('set -- -ab; getopts ab opt; getopts ab opt; say "$opt:$OPTIND"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "b:2\n");
    } finally { await shell.dispose(); }
  });
}

test("owned input storage is admitted before argument snapshot reads", async () => {
  const create = Reflect.get(scanner, "createGetoptsInput");
  assert.equal(typeof create, "function");
  let reads = 0;
  let reserved = false;
  const args = new Proxy(["-a"], { get(target, key, receiver) {
    if (key === "0") reads++;
    return Reflect.get(target, key, receiver);
  } });
  await assert.rejects(async () => create(args, { assertOpen() {}, reserve(bytes: number, slots: number) {
    assert.equal(bytes, 264);
    assert.equal(slots, 3);
    reserved = true;
    throw false;
  } }, options().work), error => error === false);
  assert.equal(reserved, true);
  assert.equal(reads, 0);
});

test("snapshot copying charges work and observes cancellation before indexed reads", async () => {
  const create = Reflect.get(scanner, "createGetoptsInput");
  assert.equal(typeof create, "function");
  const caller = new AbortController();
  let reads = 0;
  let charged = 0;
  let released = false;
  const args = new Proxy(Array.from({ length: 16 }, () => "-a"), { get(target, key, receiver) {
    if (typeof key === "string" && Number.isInteger(Number(key))) reads++;
    return Reflect.get(target, key, receiver);
  } });
  await assert.rejects(async () => create(args, { assertOpen() {}, reserve() { return {
    commit() { assert.fail("cancelled snapshot must not commit"); }, release() { released = true; },
  }; } }, options({ signal: caller.signal, yieldEvery: 4, checkpoint: steps => {
    charged += steps;
    caller.abort(false);
  } }).work), error => error === false);
  assert.equal(charged, 4);
  assert.equal(reads, 3);
  assert.equal(released, true);
});

test("positional cache releases its reservation on replacement and owner close", async context => {
  const retained: { input: object; scope: ValueScope; closed: boolean }[] = [];
  const reserve = ValueScope.prototype.reserve;
  const close = ValueScope.prototype.close;
  const builtin = Runtime.prototype.builtin;
  let calls = 0;
  let monitor: ReturnType<typeof stateMonitor>;
  context.mock.method(ValueScope.prototype, "reserve", function (this: ValueScope, ...args: Parameters<ValueScope["reserve"]>) {
    const reservation = reserve.apply(this, args);
    return { release: reservation.release, commit: (value: object) => {
      reservation.commit(value);
      if (Object.hasOwn(value, "args") && Object.isFrozen(value) && Array.isArray(Reflect.get(value, "args"))) {
        retained.push({ input: value, scope: this, closed: false });
      }
    } };
  });
  context.mock.method(ValueScope.prototype, "close", function (this: ValueScope) {
    close.call(this);
    for (const entry of retained) if (entry.scope === this) entry.closed = true;
  });
  context.mock.method(Runtime.prototype, "builtin", async function (this: Runtime, ...args: Parameters<Runtime["builtin"]>) {
    const result = await builtin.apply(this, args);
    monitor = stateMonitor(args[1]);
    if (args[0].command === "getopts") {
      calls++;
      assert.equal(retained.length, calls <= 2 ? 1 : 2);
      assert.equal(Reflect.get(monitor!, "getoptsInput"), retained.at(-1)!.input);
      assert.equal(retained.at(-1)!.closed, false);
    } else if (args[0].command === "set" && calls === 2) {
      assert.equal(retained[0]!.closed, true);
      assert.equal(Reflect.get(monitor!, "getoptsInput"), undefined);
    }
    return result;
  });
  const { shell } = setup();
  try {
    const result = await shell.exec('set -- -ab; getopts ab opt; getopts ab opt; set -- -cd; OPTIND=1; getopts cd opt; getopts cd opt');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(calls, 4);
    assert.equal(retained.length, 2);
    assert.ok(retained.every(entry => entry.closed));
    assert.equal(Reflect.get(monitor!, "getoptsInput"), undefined);
    assert.deepEqual(monitor!.session.values.usage, { bytes: 0, slots: 0 });
  } finally { await shell.dispose(); }
});

test("forged owned input shape cannot skip raw input validation", async () => {
  await assert.rejects(scanner.scanGetopts(scanner.createGetoptsState(), "a", { args: Object.freeze(["-a"]) } as unknown as readonly string[], options()), { code: "INVALID_INPUT" });
});

test("raw array reuse still validates malformed trailing input before cursor publication", async () => {
  const args = ["-ab"];
  const first = await scanner.scanGetopts(scanner.createGetoptsState(), "ab", args, options());
  const previous = structuredClone(first.state);
  args.push("late\0bad");
  await assert.rejects(scanner.scanGetopts(first.state, "ab", args, options()), { code: "INVALID_INPUT" });
  assert.deepEqual(first.state, previous);
});

test("owned input is isolated from later raw array mutation", async () => {
  const args = ["-ab"];
  const input = await owned(args);
  const first = await scanner.scanGetopts(scanner.createGetoptsState(), "ab", input, options());
  args[0] = "-zz";
  args.push("late\0bad");
  const next = await scanner.scanGetopts(first.state, "ab", input, options());
  assert.equal(next.option, "b");
  assert.equal(next.optind, 2);
});

test("owned input refuses malformed trailing data before first transition", async () => {
  const input = await owned(["-ab", "late\0bad"]);
  const state = Object.freeze(scanner.createGetoptsState());
  await assert.rejects(scanner.scanGetopts(state, "ab", input, options()), { code: "INVALID_INPUT" });
  assert.deepEqual(state, { index: 0 });
});

test("owned warm input rechecks UTF-8 byte, argument and transition-step limits", async () => {
  const input = await owned(["-a", "雪🙂"]);
  const state = Object.freeze(scanner.createGetoptsState());
  const maxBytes = Buffer.byteLength("a:-a雪🙂");
  const first = await scanner.scanGetopts(state, "a:", input, options({ maxBytes }));
  assert.deepEqual(first.argument, { kind: "set", value: "雪🙂" });
  for (const [work, code] of [[{ maxBytes: maxBytes - 1 }, "BYTE_LIMIT"], [{ maxArguments: 1 }, "ARGUMENT_LIMIT"], [{ maxSteps: 1 }, "STEP_LIMIT"]] as const) {
    await assert.rejects(scanner.scanGetopts(state, "a:", input, options(work)), { code });
    assert.deepEqual(state, { index: 0 });
  }
  await assert.rejects(scanner.scanGetopts(state, "a:", input, options({ maxBytes, maxSteps: 5 })), { code: "STEP_LIMIT" });
  assert.equal((await scanner.scanGetopts(state, "a:", input, options({ maxBytes, maxSteps: 6 }))).option, "a");
});

test("owned cache changes specification without changing clustered cursor semantics", async () => {
  const input = await owned(["-ab", "value"]);
  const first = await scanner.scanGetopts(scanner.createGetoptsState(), "ab", input, options());
  await assert.rejects(scanner.scanGetopts(first.state, "é", input, options()), { code: "NON_ASCII_OPTION" });
  const next = await scanner.scanGetopts(first.state, "ab:", input, options());
  assert.deepEqual(next.argument, { kind: "set", value: "value" });
  assert.equal(next.option, "b");
  assert.equal(next.optind, 3);
});

for (const reason of [false, null, 0]) {
  test(`warm owned scan preserves caller cancellation ${reason}`, async () => {
    const input = await owned(["-ab"]);
    const first = await scanner.scanGetopts(scanner.createGetoptsState(), "ab", input, options());
    const previous = structuredClone(first.state);
    const caller = new AbortController();
    caller.abort(reason);
    await assert.rejects(scanner.scanGetopts(first.state, "ab", input, options({ signal: caller.signal })), error => Object.is(error, reason));
    assert.deepEqual(first.state, previous);
  });
}

test("failed cold validation does not publish a warm validation receipt", async () => {
  const input = await owned([`-${"a".repeat(32)}`]);
  const state = Object.freeze(scanner.createGetoptsState());
  const caller = new AbortController();
  await assert.rejects(scanner.scanGetopts(state, "a", input, options({ signal: caller.signal, yieldEvery: 1, checkpoint: () => { caller.abort(false); } })), error => error === false);
  await assert.rejects(scanner.scanGetopts(state, "a", input, options({ maxSteps: 2 })), { code: "STEP_LIMIT" });
  assert.deepEqual(state, { index: 0 });
});

for (const [name, source, expected] of [
  ["replace and shift", 'set -- -ab -c; getopts abc opt; say "$opt:$OPTIND"; shift; getopts abc opt; say "$opt:$OPTIND"; set -- -b; OPTIND=1; getopts abc opt; say "$opt:$OPTIND"', "a:1\nc:2\nb:2\n"],
  ["specification change", 'set -- -ab value; getopts ab opt; getopts ab: opt; say "$opt:$OPTARG:$OPTIND"', "b:value:3\n"],
  ["explicit arguments change", 'getopts ab opt -ab; getopts ac opt -ac; say "$opt:$OPTIND"', "c:2\n"],
  ["function arguments and restoration", 'set -- -ab; getopts ab opt; f() { OPTIND=1; getopts xy opt; say "$opt:$OPTIND"; }; f -xy; getopts ab opt; say "$opt:$OPTIND"', "x:1\nb:2\n"],
  ["source arguments and restoration", 'set -- -ab; getopts ab opt; . /opts -xy; getopts ab opt; say "$opt:$OPTIND"', "x:1\nb:2\n"],
] as const) {
  test(`public getopts preserves ${name}`, async () => {
    const { shell, fs } = setup();
    await fs.writeFile("/opts", Buffer.from('OPTIND=1; getopts xy opt; say "$opt:$OPTIND"'));
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const malformed of [false, true]) {
  test(`tracked same-array positional ${malformed ? "malformation" : "replacement"} invalidates validation`, async context => {
    const { shell } = setup();
    const builtin = Runtime.prototype.builtin;
    let calls = 0;
    let original: GetoptsState | undefined;
    context.mock.method(Runtime.prototype, "builtin", async function (this: Runtime, ...args: Parameters<Runtime["builtin"]>) {
      if (args[0].command === "getopts" && ++calls === 2) {
        original = scanner.cloneGetoptsState(args[1].getopts!.cursor);
        if (malformed) args[1].positional.push("late\0bad");
        else args[1].positional[0] = "-ac";
        try { return await builtin.apply(this, args); }
        finally { if (malformed) assert.deepEqual(args[1].getopts!.cursor, original); }
      }
      return builtin.apply(this, args);
    });
    try {
      const result = await shell.exec('set -- -ab; getopts abc opt; getopts abc opt; say "$?:$opt:$OPTIND"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, malformed ? "2:a:1\n" : "0:c:2\n");
      if (malformed) assert.match(result.stderr, /arguments must be strings without NUL/u);
      else assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
