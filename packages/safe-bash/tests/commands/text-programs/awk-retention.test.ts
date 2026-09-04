import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { AwkRuntime } from "../../../src/commands/text-programs/awk-runtime.js";
import { AwkParser } from "../../../src/commands/text-programs/awk-syntax.js";
import { AwkArray, inputValue, string, type Scalar } from "../../../src/commands/text-programs/awk-values.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { AwkRetention } from "../../../src/commands/text-programs/awk-retention.js";

function invocation(program: string, env: Record<string, string> = {}, operands: string[] = []) {
  let stdout = "", stderr = "";
  const context: CommandContext = {
    command: "awk", args: [program, ...operands], env, cwd: "/", fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(new Uint8Array()),
    stdout: { async write(chunk) { stdout += Buffer.from(chunk).toString(); } },
    stderr: { async write(chunk) { stderr += Buffer.from(chunk).toString(); } },
  };
  return { context, output: () => ({ stdout, stderr }) };
}

for (const [name, program, env, operands] of [
  ["array value", 'BEGIN { a[1]="123456789"; print length(a[1]) }', {}, []],
  ["ENVIRON numeric text", 'BEGIN { print length(ENVIRON["X"]) }', { X: "123456789" }, []],
  ["ARGV value", 'BEGIN { print length(ARGV[1]) }', {}, ["123456789"]],
  ["function scalar parameter", 'function f(x) { print length(x) } BEGIN { f("123456789") }', {}, []],
] as const) {
  test(`awk checks retained ${name} against the existing per-value limit`, async () => {
    const { context, output } = invocation(program, env, [...operands]);
    const command = createTextProgramCommands({ maxBufferBytes: 8, maxSteps: 2048 }).find(item => item.name === "awk")!;
    const result = await command.execute(context);
    assert.equal(result.exitCode, 2);
    assert.match(output().stderr, /text buffer limit/u);
    assert.equal(output().stdout, "");
  });
}

test("awk retires entries belonging only to completed function frames", async () => {
  const program = 'function f(x) { x[1]="x" } BEGIN { f(); f(); print 1 }';
  const { context } = invocation(program);
  let observed: readonly number[] | undefined;
  const inspection = {
    ...context,
    stdout: { async write() {
      const variables = Reflect.get(runtime, "variables") as Map<string, unknown>;
      const liveEntries = [...variables.values()].reduce<number>((sum, value) => sum + (value instanceof AwkArray ? value.entries.size : 0), 0);
      observed = [Reflect.get(runtime, "entries") as number, liveEntries];
    } },
  };
  const runtime = new AwkRuntime(new AwkParser(program).parse(), inspection, new Budget(inspection, { maxBufferBytes: 16 }), new AwkRetention(1024), [], []);
  assert.equal(await runtime.run(), 0);
  assert.deepEqual(observed, [1, 1]);
});

test("public Shell enforces the fixed aggregate independently of per-value admission", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  // At most 34 logical one-million-byte slots; no RSS or heap-size assertion.
  const result = await shell.exec('awk \'BEGIN { x=sprintf("%1000000s", ""); for(i=0;i<34;i++) a[i]=x; print "unbounded" }\'');
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /retained.*limit/u);
  assert.equal(result.stdout, "");
});

for (const kind of ["input", "output"] as const) {
  test(`awk reserves a retained ${kind} name before host work`, async () => {
    const name = kind === "input" ? "/input" : "/output";
    const program = kind === "input" ? `BEGIN { getline x < "${name}" }` : `BEGIN { print "x" > "${name}" }`;
    for (const extra of [-1, 0]) {
      const { context } = invocation(program);
      const retention = new AwkRetention(17 + name.length + extra);
      let calls = 0;
      context.fs.readStream = async function* () { calls++; yield new Uint8Array(); };
      context.fs.writeFile = async () => { calls++; };
      const runtime = new AwkRuntime(new AwkParser(program).parse(), context, new Budget(context, { maxBufferBytes: 64 }), retention, [], []);
      if (extra < 0) await assert.rejects(runtime.run(), /retained.*limit/u);
      else assert.equal(await runtime.run(), 0);
      assert.equal(calls, extra < 0 ? 0 : 1);
      assert.equal(retention.retainedBytes, 0);
    }
  });
}

test("awk cleanup joins all readers without replacing an execution failure", async () => {
  const program = 'BEGIN { getline a < "/a"; getline b < "/b"; x=1/0 }';
  const { context } = invocation(program);
  let secondClosing!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { secondClosing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  context.fs.readStream = path => ({
    [Symbol.asyncIterator]() {
      return {
        async next() { return { done: false, value: Buffer.from("x\nsuffix") }; },
        async return() {
          if (path === "/a") throw false;
          secondClosing(); await gate;
          return { done: true, value: undefined };
        },
      };
    },
  });
  const retention = new AwkRetention(128);
  const runtime = new AwkRuntime(new AwkParser(program).parse(), context, new Budget(context, {}), retention, [], []);
  let settled = false;
  const result = runtime.run();
  void result.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, "a rejected close must not bypass another cooperative close");
  } finally { release(); }
  await assert.rejects(result, /division by zero/u);
  assert.equal(retention.retainedBytes, 0);
});

test("retained text admission is exact, transactional, cancellation-first and reusable", () => {
  const controller = new AbortController();
  const retention = new AwkRetention(8, controller.signal);
  assert.equal(retention.replace(0, 8, () => "owned"), "owned");
  let allocations = 0;
  assert.throws(() => retention.replace(0, 1, () => { allocations++; }), /retained.*limit/u);
  assert.equal(allocations, 0);
  assert.equal(retention.retainedBytes, 8);
  assert.throws(() => retention.replace(8, 4, () => { throw false; }), error => Object.is(error, false));
  assert.equal(retention.retainedBytes, 8);
  retention.replace(8, 3, () => undefined);
  assert.equal(retention.retainedBytes, 3);
  controller.abort(null);
  assert.throws(() => retention.replace(0, 100, () => undefined), error => Object.is(error, null));
  retention.release(3);
  assert.equal(retention.retainedBytes, 0);
  assert.throws(() => retention.release(1), /retained text release/u);
  for (const capacity of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => new AwkRetention(capacity), /capacity/u);
  const zero = new AwkRetention(0);
  zero.replace(0, 0, () => undefined);
  assert.throws(() => zero.replace(0, 1, () => undefined), /retained.*limit/u);
});

test("awk initialization charges defaults, ENVIRON and ARGV and rolls back a refusal", () => {
  const { context } = invocation("BEGIN {}", { X: "12" });
  for (const capacity of [16, 23, 24]) {
    const retention = new AwkRetention(capacity);
    const create = () => new AwkRuntime(new AwkParser("BEGIN {}").parse(), context, new Budget(context, {}), retention, ["abc"], []);
    if (capacity < 24) { assert.throws(create, /retained.*limit/u); assert.equal(retention.retainedBytes, 0); }
    else { create(); assert.equal(retention.retainedBytes, 24); }
  }
});

test("awk scalar and array replacement preserve old state on refusal and preserve raw numeric text", async () => {
  const { context } = invocation("BEGIN {}");
  const retention = new AwkRetention(32);
  const runtime = new AwkRuntime(new AwkParser("BEGIN {}").parse(), context, new Budget(context, {}), retention, [], []);
  const set = Reflect.get(runtime, "set") as (name: string, value: Scalar) => void;
  const variables = Reflect.get(runtime, "variables") as Map<string, unknown>;
  const value = inputValue("00012");
  set.call(runtime, "x", value);
  assert.deepEqual(variables.get("x"), value);
  assert.notEqual(variables.get("x"), value, "stored numeric text owns a fresh scalar");
  assert.equal(retention.retainedBytes, 22);
  assert.throws(() => set.call(runtime, "x", string("x".repeat(16))), /retained.*limit/u);
  assert.deepEqual(variables.get("x"), value);
  assert.equal(retention.retainedBytes, 22);
  set.call(runtime, "x", string(""));
  const array = Reflect.get(runtime, "array").call(runtime, "a") as AwkArray;
  const arraySet = Reflect.get(runtime, "arraySet") as (array: AwkArray, key: string, value: Scalar) => void;
  const bytes = string("\0\xff\x80".repeat(4) + "ab");
  arraySet.call(runtime, array, "k", bytes);
  assert.equal(retention.retainedBytes, 32);
  assert.deepEqual(array.entries.get("k"), bytes);
  assert.notEqual(array.entries.get("k"), bytes);
  assert.throws(() => arraySet.call(runtime, array, "k", string("x".repeat(15))), /retained.*limit/u);
  assert.throws(() => arraySet.call(runtime, array, "new", string("")), /retained.*limit/u);
  assert.deepEqual([...array.entries], [["k", bytes]]);
  assert.equal(Reflect.get(runtime, "entries"), 2);
  assert.equal(retention.retainedBytes, 32);
  await runtime.run();
  assert.equal(retention.retainedBytes, 0);
});

test("awk record, fields and NF replacement are atomic under aggregate admission", async () => {
  const { context } = invocation("BEGIN {}");
  const retention = new AwkRetention(39);
  const runtime = new AwkRuntime(new AwkParser("BEGIN {}").parse(), context, new Budget(context, {}), retention, [], []);
  const setRecord = Reflect.get(runtime, "setRecord") as (record: string) => Promise<void>;
  await setRecord.call(runtime, "12345678901");
  assert.equal(retention.retainedBytes, 39);
  const fields = Reflect.get(runtime, "fields");
  await assert.rejects(setRecord.call(runtime, "123456789012"), /retained.*limit/u);
  assert.equal(Reflect.get(runtime, "record"), "12345678901");
  assert.equal(Reflect.get(runtime, "fields"), fields);
  const set = Reflect.get(runtime, "set") as (name: string, value: Scalar) => void;
  assert.throws(() => set.call(runtime, "NF", inputValue("2")), /retained.*limit/u);
  assert.equal(Reflect.get(runtime, "fields"), fields);
  assert.equal(retention.retainedBytes, 39);
  await setRecord.call(runtime, "a b");
  assert.equal(retention.retainedBytes, 22);
  const reference = await Reflect.get(runtime, "reference").call(runtime, { kind: "field", index: { kind: "number", value: 1 } });
  assert.throws(() => reference.set(string("x".repeat(12))), /retained.*limit/u);
  assert.equal(Reflect.get(runtime, "record"), "a b");
  assert.equal(retention.retainedBytes, 22);
  await runtime.run();
  assert.equal(retention.retainedBytes, 0);
});

test("awk split replacement admits the entire new array before clearing the old cells", async () => {
  const { context } = invocation("BEGIN {}");
  const retention = new AwkRetention(25);
  const runtime = new AwkRuntime(new AwkParser("BEGIN {}").parse(), context, new Budget(context, {}), retention, [], []);
  const array = Reflect.get(runtime, "array").call(runtime, "a") as AwkArray;
  Reflect.get(runtime, "arraySet").call(runtime, array, "old", string("x"));
  const split = (value: string) => Reflect.get(runtime, "call").call(runtime, "split", [
    { kind: "string", value }, { kind: "variable", name: "a" }, { kind: "string", value: "," },
  ]) as Promise<unknown>;
  await assert.rejects(split("a,b,c,d,e"), /retained.*limit/u);
  assert.deepEqual([...array.entries], [["old", string("x")]]);
  assert.equal(retention.retainedBytes, 21);
  await split("a,b,c,d");
  assert.equal(array.entries.size, 4);
  assert.equal(retention.retainedBytes, 25);
  await split("");
  assert.equal(array.entries.size, 0);
  assert.equal(retention.retainedBytes, 17);
  await runtime.run();
  assert.equal(retention.retainedBytes, 0);
});

for (const [name, program, expected] of [
  ["overwrite/delete/clear", 'BEGIN { a["k"]="12345678"; print 1; a["k"]="x"; print 2; delete a["k"]; print 3; a["j"]="z"; delete a; print 4 }', [26, 19, 17, 17]],
  ["array aliases", 'function f(x,y) { x["j"]="z"; print 1 } BEGIN { a["k"]="xx"; f(a,a); print 2; delete a; print 3 }', [22, 22, 17]],
  ["scalar parameter slots", 'function f(x) { print 1 } BEGIN { v="abcd"; f(v); print 2 }', [25, 21]],
  ["nested local array owners", 'function g(y) { y["j"]="z" } function f(x) { x["k"]="12"; g(x); print 1 } BEGIN { f(); print 2 }', [22, 17]],
] as const) {
  test(`awk releases retired ${name} without recounting or double-charging aliases`, async () => {
    const { context } = invocation(program);
    const retention = new AwkRetention(32);
    const observed: number[] = [];
    const inspection = { ...context, stdout: { async write() { observed.push(retention.retainedBytes); } } };
    const runtime = new AwkRuntime(new AwkParser(program).parse(), inspection, new Budget(inspection, {}), retention, [], []);
    assert.equal(await runtime.run(), 0);
    assert.deepEqual(observed, expected);
    assert.equal(retention.retainedBytes, 0);
  });
}

test("awk failed frame initialization releases earlier scalar and borrowed array bindings", async () => {
  const program = 'function f(x,y,z) { print "bad" } BEGIN { a[1]="v"; f(a,"1234","5678") }';
  const { context } = invocation(program);
  const retention = new AwkRetention(25);
  const runtime = new AwkRuntime(new AwkParser(program).parse(), context, new Budget(context, {}), retention, [], []);
  await assert.rejects(runtime.run(), /retained.*limit/u);
  assert.equal(retention.retainedBytes, 0);
  assert.equal(Reflect.get(runtime, "entries"), 0);
});

test("awk EOF input names remain charged until close and output names release on close", async () => {
  for (const input of [true, false]) {
    const program = input
      ? 'BEGIN { getline x < "/input"; getline x < "/input"; print 1; close("/input"); print 2; getline x < "/other"; print 3 }'
      : 'BEGIN { print "x" > "/first"; print "y" > "/first"; print 1; close("/first"); print 2; print "z" > "/other"; print 3 }';
    const { context } = invocation(program);
    let opens = 0, appends = 0;
    context.fs.readStream = async function* () { opens++; yield new Uint8Array(); };
    context.fs.writeFile = async () => { opens++; };
    context.fs.appendFile = async () => { appends++; };
    const retention = new AwkRetention(23);
    const observed: number[] = [];
    const inspection = { ...context, stdout: { async write() { observed.push(retention.retainedBytes); } } };
    const runtime = new AwkRuntime(new AwkParser(program).parse(), inspection, new Budget(inspection, {}), retention, [], []);
    assert.equal(await runtime.run(), 0);
    assert.deepEqual(observed, [23, 17, 23]);
    assert.equal(opens, 2);
    assert.equal(appends, input ? 0 : 1);
    assert.equal(retention.retainedBytes, 0);
  }
});

test("awk failed output publication releases its admitted name without losing the I/O failure", async () => {
  const program = 'BEGIN { print "x" > "/target" }';
  const { context } = invocation(program);
  const retention = new AwkRetention(24);
  const error = new FsError("EIO");
  context.fs.writeFile = async () => { assert.equal(retention.retainedBytes, 24); throw error; };
  const runtime = new AwkRuntime(new AwkParser(program).parse(), context, new Budget(context, {}), retention, [], []);
  await assert.rejects(runtime.run(), reason => reason === error);
  assert.equal(retention.retainedBytes, 0);
});

for (const main of [false, true]) {
  for (const mode of ["execution", "cleanup", "cancellation"] as const) {
    test(`awk ${main ? "main" : "named"} reader cleanup preserves ${mode} priority and falsey reasons`, async () => {
      const program = main ? '{ print "x"; exit }' : 'BEGIN { getline x < "/input"; print "x" }';
      const { context } = invocation(program);
      const controller = new AbortController();
      let returns = 0;
      const source = {
        [Symbol.asyncIterator]() {
          let pulled = false;
          return {
            async next() {
              if (pulled) return { done: true as const, value: undefined };
              pulled = true;
              return { done: false as const, value: Buffer.from("a\nsuffix") };
            },
            async return() {
              returns++;
              if (mode === "cancellation") controller.abort(0);
              throw false;
            },
          };
        },
      };
      context.fs.readStream = () => source;
      const configured = {
        ...context, signal: controller.signal, stdin: main ? source : context.stdin,
        stdout: { async write() { if (mode !== "cleanup") throw null; } },
      };
      const retention = new AwkRetention(128, controller.signal);
      const runtime = new AwkRuntime(new AwkParser(program).parse(), configured, new Budget(configured, {}), retention, [], []);
      await assert.rejects(runtime.run(), error => Object.is(error, mode === "execution" ? null : mode === "cleanup" ? false : 0));
      assert.equal(returns, 1);
      assert.equal(retention.retainedBytes, 0);
    });
  }
}

test("awk shares one aggregate across main input, named readers, fields and array values", async () => {
  const program = '{ a[1]=$0; getline x < "/side"; print 1 }';
  const { context } = invocation(program);
  // Main block=8, record/field/array each=1, key=1, FILENAME=1,
  // defaults=17, side name=5: 35 before acquiring the four-byte side block.
  for (const capacity of [38, 40]) {
    let sideClosed = false;
    context.fs.readStream = async function* () { try { yield Buffer.from("b\nz\n"); } finally { sideClosed = true; } };
    const configured = { ...context, stdin: toByteSource(Buffer.from("a\nsuffix")) };
    const retention = new AwkRetention(capacity);
    const limitedProgram = new AwkParser(program.replace("print 1", "exit")).parse();
    const runtime = new AwkRuntime(limitedProgram, configured, new Budget(configured, {}), retention, [], []);
    if (capacity === 38) await assert.rejects(runtime.run(), /retained.*limit/u);
    else assert.equal(await runtime.run(), 0);
    assert.equal(sideClosed, true);
    assert.equal(retention.retainedBytes, 0);
  }
});

test("awk current aggregate preserves small maxBufferBytes and isolates repeated Shell invocations", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands({ maxBufferBytes: 6 })) });
  context.after(() => shell.dispose());
  for (let invocation = 0; invocation < 2; invocation++) {
    const result = await shell.exec('awk \'BEGIN { a[1]="123456"; a[2]="654321"; print length(a) }\'');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2\n");
  }
});

test("awk terminal main close releases blocks before END without waiting ahead of named cleanup", async () => {
  const program = '{ getline a < "/named"; exit } END { print length(a); getline b < "/named"; print b }';
  const { context } = invocation(program);
  let mainStarted!: () => void, releaseMain!: () => void;
  const entered = new Promise<void>(resolve => { mainStarted = resolve; });
  const blocked = new Promise<void>(resolve => { releaseMain = resolve; });
  const closes: string[] = [];
  const source = (main: boolean) => ({
    [Symbol.asyncIterator]() {
      let read = false;
      return {
        async next() {
          if (read) return { done: true as const, value: undefined };
          read = true;
          return { done: false as const, value: Buffer.from(main ? "m\nsuffix" : "a\nb\n") };
        },
        async return() {
          closes.push(main ? "main" : "named");
          if (main) { mainStarted(); await blocked; }
          else releaseMain();
          return { done: true as const, value: undefined };
        },
      };
    },
  });
  context.fs.readStream = () => source(false);
  const retention = new AwkRetention(64);
  const observed: [string, number][] = [];
  const configured = {
    ...context, stdin: source(true),
    stdout: { async write(chunk: Uint8Array) { observed.push([Buffer.from(chunk).toString(), retention.retainedBytes]); } },
  };
  const runtime = new AwkRuntime(new AwkParser(program).parse(), configured, new Budget(configured, {}), retention, [], []);
  const work = runtime.run();
  try {
    await entered;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...closes], ["main", "named"]);
  } finally { releaseMain(); await work; }
  assert.deepEqual(observed, [["1\n", 31], ["b\n", 28]]);
  assert.equal(retention.retainedBytes, 0);
});
