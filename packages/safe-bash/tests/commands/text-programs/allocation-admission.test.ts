import assert from "node:assert/strict";
import test from "node:test";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { formatted, numeric, string, unset } from "../../../src/commands/text-programs/awk-values.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { makeFileSystem, runVirtual } from "./helpers.js";

for (const [name, program] of [
  ["literal", `BEGIN { printf "${"x".repeat(128)}" }`],
  ["escaped percent", `BEGIN { printf "${"%%".repeat(64)}" }`],
  ["sprintf", `BEGIN { value=sprintf("${"%%".repeat(64)}") }`],
  ["string width", 'BEGIN { printf "%128s", "x" }'],
  ["dynamic width", 'BEGIN { printf "%*s", -128, "x" }'],
  ["integer precision", 'BEGIN { printf "%.*d", 128, 7 }'],
  ["CONVFMT", 'BEGIN { CONVFMT="%0128.1f"; value=1.5 "" }'],
  ["comparison CONVFMT", 'BEGIN { CONVFMT="%0128.1f"; value=(1.5 == "x") }'],
  ["OFMT", 'BEGIN { OFMT="%0128.1f"; print 1.5 }'],
  ["rebuild conversion", 'BEGIN { CONVFMT="%0128.1f"; $1=1.5 }'],
] as const) {
  test(`awk format work admits ${name}`, async context => {
    let padded = 0;
    for (const method of ["padStart", "padEnd"] as const) {
      const original = String.prototype[method];
      context.mock.method(String.prototype, method, function (this: string, length: number, fill?: string) {
        if (length >= 128) padded++;
        return original.call(this, length, fill);
      });
    }
    const result = await runVirtual("awk", { args: [program] }, { maxSteps: 64, maxBufferBytes: 256 });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "awk: execution step limit exceeded\n");
    assert.equal(result.stdout.length, 0);
    assert.equal(padded, 0, "rejected formatting must not pad first");
  });
}

for (const [format, args] of [
  ["%32s", '"x"'], ["%-32s", '"x"'], ["%032d", "1"],
  ["%+.32d", "1"], ["%#.32x", "1"], ["%32.1f", "1.5"],
] as const) {
  test(`awk format work admits configured buffer before padding ${format}`, async context => {
    let padded = 0;
    for (const method of ["padStart", "padEnd"] as const) {
      const original = String.prototype[method];
      context.mock.method(String.prototype, method, function (this: string, length: number, fill?: string) {
        if (length >= 30) padded++;
        return original.call(this, length, fill);
      });
    }
    const result = await runVirtual("awk", { args: [`BEGIN { printf "${format}", ${args} }`] }, { maxBufferBytes: 31 });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "awk: text buffer limit exceeded\n");
    assert.equal(result.stdout.length, 0);
    assert.equal(padded, 0);
  });
}

for (const [format, argumentsAfterValue, expected] of [
  ["%d", "", "1"], ["%*s", ', "x"', "x"], ["%.*f", ", 1.5", "1.5"],
] as const) {
  test(`awk format work admits string numeric coercion ${format}`, async context => {
    const longOne = "0".repeat(127) + "1";
    const exec = RegExp.prototype.exec;
    const nativeNumber = globalThis.Number;
    let scanned = 0;
    let converted = 0;
    context.mock.method(RegExp.prototype, "exec", function (this: RegExp, input: string) {
      if (input === longOne) scanned++;
      return exec.call(this, input);
    });
    globalThis.Number = new Proxy(nativeNumber, {
      apply(target, receiver, args: unknown[]) {
        if (args[0] === longOne) converted++;
        return Reflect.apply(target, receiver, args);
      },
    });
    context.after(() => { globalThis.Number = nativeNumber; });
    const program = `BEGIN { printf "${format}", "${longOne}"${argumentsAfterValue} }`;
    const rejected = await runVirtual("awk", { args: [program] }, { maxSteps: 64 });
    assert.deepEqual({ scanned, converted }, { scanned: 0, converted: 0 });
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.stderr.toString(), "awk: execution step limit exceeded\n");
    assert.equal(rejected.stdout.length, 0);
    const accepted = await runVirtual("awk", { args: [program] }, { maxSteps: 256 });
    assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
    assert.equal(accepted.stdout.toString(), expected);
    assert.deepEqual({ scanned, converted }, { scanned: 1, converted: 1 });
  });
}

test("awk format work does not charge untouched cached numeric text", async () => {
  const command = {
    command: "awk", args: [], cwd: "/work", env: {}, fs: await makeFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("formatter must not write directly"); } },
    stderr: { async write() { assert.fail("formatter must not write diagnostics"); } },
  };
  const cached = { kind: "numeric", number: 1, get text(): string { return assert.fail("cached numeric coercion must not inspect text"); } } as const;
  for (const value of [numeric(1), cached, unset]) {
    const convert = (argument: ReturnType<typeof string>): string => argument.kind === "string" ? argument.text : assert.fail("unexpected text coercion");
    for (const [format, values, maxSteps, expected] of [
      ["%d", [value], 7, value.kind === "unset" ? "0" : "1"],
      ["%*s", [value, string("x")], 6, "x"],
      ["%.*f", [value, numeric(1.5)], value.kind === "unset" ? 9 : 18, value.kind === "unset" ? "2" : "1.5"],
    ] as const) {
      assert.throws(() => formatted(format, values, convert, new Budget(command, { maxSteps: maxSteps - 1 })), { message: "execution step limit exceeded" });
      assert.equal(formatted(format, values, convert, new Budget(command, { maxSteps })), expected);
    }
  }
});

test("awk format work charges literal and percent scans plus output bytes", async context => {
  const original = Budget.prototype.step;
  let charged = 0;
  context.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) {
    charged += count;
    return original.call(this, count);
  });
  for (const piece of ["x", "%%"]) {
    const charges: number[] = [];
    for (const length of [4, 8]) {
      charged = 0;
      const result = await runVirtual("awk", { args: [`BEGIN { printf "${piece.repeat(length)}" }`] });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.equal(result.stdout.toString(), (piece === "x" ? "x" : "%").repeat(length));
      charges.push(charged);
    }
    assert.equal(charges[1]! - charges[0]!, 4 * (piece.length + 1));
  }
});

test("awk format work rejects scanning before reaching conversions", async context => {
  const original = String.prototype.padStart;
  let padded = 0;
  context.mock.method(String.prototype, "padStart", function (this: string, length: number, fill?: string) {
    if (length === 32) padded++;
    return original.call(this, length, fill);
  });
  const result = await runVirtual("awk", { args: [`BEGIN { printf "${"x".repeat(128)}%32s", "x" }`] }, { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "awk: execution step limit exceeded\n");
  assert.equal(padded, 0);
});

test("awk format work admits string slicing and floating precision before native work", async context => {
  const slice = String.prototype.slice;
  let sliced = 0;
  context.mock.method(String.prototype, "slice", function (this: string, start?: number, end?: number) {
    if (String(this) === "0123456789" && start === 0 && end === 9) sliced++;
    return slice.call(this, start, end);
  });
  const rejected = await runVirtual("awk", { args: ['BEGIN { printf "%.9s", "0123456789" }'] }, { maxBufferBytes: 8 });
  assert.equal(rejected.stderr.toString(), "awk: text buffer limit exceeded\n");
  assert.equal(sliced, 0);
  const accepted = await runVirtual("awk", { args: ['BEGIN { printf "%.9s", "0123456789" }'] }, { maxBufferBytes: 9 });
  assert.equal(accepted.stdout.toString(), "012345678");
  assert.equal(sliced, 1);
  const fixed = Number.prototype.toFixed;
  let converted = 0;
  context.mock.method(Number.prototype, "toFixed", function (this: number, precision?: number) {
    if (precision === 100) converted++;
    return fixed.call(this, precision);
  });
  const limited = await runVirtual("awk", { args: ['BEGIN { printf "%.100f", 1.5 }'] }, { maxSteps: 64 });
  assert.equal(limited.stderr.toString(), "awk: execution step limit exceeded\n");
  assert.equal(converted, 0);
  const precise = await runVirtual("awk", { args: ['BEGIN { printf "%.100f", 1.5 }'] });
  assert.equal(precise.stdout.toString(), "1.5" + "0".repeat(99));
  assert.equal(converted, 1);
});

test("awk format work has exact staged admission before padding and final concatenation and preserves abort identity", async context => {
  const fs = await makeFileSystem();
  const controller = new AbortController();
  const command = {
    command: "awk", args: [], cwd: "/work", env: {}, fs, signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("formatter must not write directly"); } },
    stderr: { async write() { assert.fail("formatter must not write diagnostics"); } },
  };
  const original = String.prototype.padStart;
  let padded = 0;
  context.mock.method(String.prototype, "padStart", function (this: string, length: number, fill?: string) {
    if (length === 8) padded++;
    return original.call(this, length, fill);
  });
  const convert = () => { assert.fail("integer formatting must not coerce as text"); };
  assert.throws(() => formatted("%08d", [numeric(7)], convert, new Budget(command, { maxSteps: 14 })), { message: "execution step limit exceeded" });
  assert.equal(padded, 0);
  assert.throws(() => formatted("%08d", [numeric(7)], convert, new Budget(command, { maxSteps: 22 })), { message: "execution step limit exceeded" });
  assert.equal(padded, 1);
  assert.equal(formatted("%08d", [numeric(7)], convert, new Budget(command, { maxSteps: 23 })), "00000007");
  assert.equal(padded, 2);
  controller.abort(false);
  assert.throws(() => formatted("%08d", [numeric(7)], convert, new Budget(command, {})), reason => reason === false);
  assert.equal(padded, 2);
});

test("awk format work preserves exact output limits and byte-oriented Unicode", async () => {
  for (const [format, args, output] of [
    ["abc", "", Buffer.from("abc")], ["%%%%%%", "", Buffer.from("%%%")],
    ["%3s", ', "é"', Buffer.from(" é")], ["%.1s", ', "é"', Buffer.from([0xc3])],
    ["%+.3d", ", 7", Buffer.from("+007")], ["%#.3x", ", 7", Buffer.from("0x007")],
    ["%.*f", ", 2, 1.25", Buffer.from("1.25")], ["%.*g", ", 100, 1.5", Buffer.from("1.5")],
    ["%*.*s", ', -4, -1, "é"', Buffer.from("é  ")],
  ] as const) {
    const program = `BEGIN { ORS="!"; printf "start:${format}"${args} }`;
    const expected = Buffer.concat([Buffer.from("start:"), output]);
    const accepted = await runVirtual("awk", { args: [program] }, { maxBufferBytes: expected.length });
    assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
    assert.deepEqual(accepted.stdout, expected);
    if (output.length > 1) {
      const rejected = await runVirtual("awk", { args: [program] }, { maxBufferBytes: expected.length - 1 });
      assert.equal(rejected.exitCode, 2);
      assert.equal(rejected.stdout.length, 0);
    }
  }
});

test("awk format work preserves argument effects, conversion order and redirect deferral", async () => {
  const program = 'function arg(){ printf "a"; return 1.5 } function dest(){ printf "d"; return "out" } BEGIN { printf "%128.1f", arg() > dest() }';
  const rejected = await runVirtual("awk", { args: [program] }, { maxSteps: 64 });
  assert.equal(rejected.exitCode, 2);
  assert.equal(rejected.stdout.toString(), "a");
  assert.equal(rejected.files.out, undefined);
  const accepted = await runVirtual("awk", { args: [program] });
  assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
  assert.equal(accepted.stdout.toString(), "ad");
  assert.equal(accepted.files.out?.toString(), "1.5".padStart(128));
  const missing = await runVirtual("awk", { args: ['BEGIN { printf "%32s" }'] }, { maxBufferBytes: 8 });
  assert.equal(missing.stderr.toString(), "awk: not enough arguments for format\n");
});

test("sed transliteration admits byte work before materializing its output", async () => {
  const result = await runVirtual("sed", { args: ["-n", "y/a/b/"], stdin: "a".repeat(128) }, { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /step limit/u);
  assert.equal(result.stdout.length, 0);
});

for (const separator of ["", " ", ",", ",+"]) {
  for (const builtin of [false, true]) {
    test(`awk admits split work: separator=${JSON.stringify(separator)}, builtin=${builtin}`, async () => {
      const input = "a".repeat(128);
      const program = builtin ? `BEGIN { split(${JSON.stringify(input)}, fields, ${JSON.stringify(separator)}) }` : "{}";
      const result = await runVirtual("awk", { args: ["-F", separator, program], stdin: builtin ? "" : input }, { maxSteps: 64 });
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr.toString(), /step limit/u);
      assert.equal(result.stdout.length, 0);
    });
  }
}

test("sed transliteration preserves raw bytes without a per-byte string array", async context => {
  const original = String.prototype[Symbol.iterator];
  let expanded = 0;
  const input = Buffer.from([0, 0xff, 0xc3, 0xa9, 97]);
  String.prototype[Symbol.iterator] = function (this: string) {
    if (String(this) === input.toString("latin1")) expanded++;
    return original.call(this);
  };
  context.after(() => { String.prototype[Symbol.iterator] = original; });
  const result = await runVirtual("sed", { args: ["y/a/b/"], stdin: input });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from([0, 0xff, 0xc3, 0xa9, 98]));
  assert.equal(expanded, 0);
});

for (const separator of ["", " ", ",", ",+"]) {
  test(`awk exact field-count boundary: ${JSON.stringify(separator)}`, async () => {
    const input = separator === "" ? "a".repeat(100000) : Array(100000).fill("a").join(separator === " " ? " " : ",");
    const accepted = await runVirtual("awk", { args: ["-F", separator, "{ print NF }"], stdin: input });
    assert.equal(accepted.exitCode, 0, accepted.stderr.toString());
    assert.equal(accepted.stdout.toString(), "100000\n");
    const rejected = await runVirtual("awk", { args: ["-F", separator, "{ print NF }"], stdin: input + (separator === "" ? "a" : separator === " " ? " a" : ",a") });
    assert.equal(rejected.exitCode, 2);
    assert.match(rejected.stderr.toString(), /field count limit/u);
    assert.equal(rejected.stdout.length, 0);
  });
}

for (const [separator, input, expected] of [
  [" ", " \ta \n b\r\v\fc ", ["a", "b", "c"]],
  [",", ",a,,b,", ["", "a", "", "b", ""]],
  [",+", ",a,,b,", ["", "a", "b", ""]],
  ["x*", "ab", ["ab"]],
  ["^|,", "a,b,", ["a", "b", ""]],
  ["", "123", ["1", "2", "3"]],
  ["", "", []], [" ", "", []], [",", "", []], [",+", "", []],
] as const) {
  test(`awk split semantics: ${JSON.stringify([separator, input])}`, async () => {
    const program = `BEGIN { n=split(${JSON.stringify(input).replaceAll("\\u000b", "\\v")}, a, ${JSON.stringify(separator)}); print n; for(i=1;i<=n;i++) print "[" a[i] "]" }`;
    const result = await runVirtual("awk", { args: [program] });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), `${expected.length}\n${expected.map(value => `[${value}]\n`).join("")}`);
  });
}

for (const separator of [",", ",+"]) {
  test(`awk paragraph fields preserve newline and empty segments: ${separator}`, async () => {
    const result = await runVirtual("awk", { args: ["-F", separator, 'BEGIN { RS="" } { print NF; for(i=1;i<=NF;i++) print "[" $i "]" }'], stdin: ",a\nb,\nc,\n\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "6\n[]\n[a]\n[b]\n[]\n[c]\n[]\n");
  });
}

test("awk byte fields preserve invalid UTF-8, NUL, and numeric typing", async () => {
  const raw = Buffer.from([0xff, 0, 0xc3, 0xa9, 49]);
  const result = await runVirtual("awk", { args: ["-F", "", 'BEGIN { ORS="" } { for(i=1;i<=NF;i++) print $i; print $5+1 }'], stdin: raw });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.concat([raw, Buffer.from("2")]));
});

test("awk bounded joins admit exact component, separator and ORS lengths", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { OFS="---"; ORS="!"; print "a", "b"; SUBSEP="---"; a["a","b"]=7; print a["a","b"]; $0="a b"; print $0 }'] }, { maxBufferBytes: 6 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "a---b!7!a b!");
  const rejected = await runVirtual("awk", { args: ['BEGIN { OFS="---"; ORS="!!"; print "a", "b" }'] }, { maxBufferBytes: 6 });
  assert.equal(rejected.exitCode, 2);
  assert.match(rejected.stderr.toString(), /buffer limit/u);
});

test("awk formatted print retains its existing ORS behavior", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { ORS="ignored"; printf "%s", "x" }'] }, { maxBufferBytes: 8 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "x");
});

test("awk no-argument print does not convert unused OFS", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { $0="ok"; OFS=1.5; CONVFMT="%q"; print }'] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "ok\n");
});

test("awk joins charge empty components before scanning them", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { OFS=""; NF=128 }'] }, { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /step limit/u);
});

test("awk joins admit copying work before materializing repeated separators", async () => {
  const result = await runVirtual("awk", { args: [`BEGIN { OFS="${"-".repeat(128)}"; print "a", "b" }`] }, { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /step limit/u);
  assert.equal(result.stdout.length, 0);
});

test("awk print evaluates arguments before conversion and rejection, but not redirect destination", async () => {
  const result = await runVirtual("awk", { args: ['function arg(){ print "arg" > "effects"; OFS="............"; return "d" } function dest(){ print "dest" > "effects"; return "out" } BEGIN { print "a", "b", "c", arg() > dest() }'] }, { maxBufferBytes: 32 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.files.effects?.toString(), "arg\n");
  assert.equal(result.files.out, undefined);
  const converted = await runVirtual("awk", { args: ['function change(){ OFMT="%.1f"; OFS="|"; ORS="!"; return 2.75 } BEGIN { print 1.25, change() }'] });
  assert.equal(converted.stdout.toString(), "1.3|2.8!");
});

test("awk SUBSEP evaluates and converts each index before later index effects", async () => {
  const result = await runVirtual("awk", { args: ['function change(){ CONVFMT="%.1f"; SUBSEP="|"; return 2.75 } BEGIN { CONVFMT="%.2f"; a[1.25,change()]=9; for(k in a) print k }'] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "1.25|2.8\n");
});

test("awk split resolves source and array before separator, and clears only after successful splitting", async () => {
  const result = await runVirtual("awk", { args: ['function source(){ a["old"]=7; return "a,b" } function sep(){ print a["old"], length(a); return "," } BEGIN { print split(source(),a,sep()); print a[1],a[2],length(a) }'] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "7 1\n2\na b 2\n");
});

test("awk failed split admission leaves its target array uncleared", async context => {
  const clear = Map.prototype.clear;
  let cleared = 0;
  context.mock.method(Map.prototype, "clear", function (this: Map<string, unknown>) {
    if (this.has("old")) cleared++;
    return clear.call(this);
  });
  const result = await runVirtual("awk", { args: [`BEGIN { a["old"]=7; split("${"x,".repeat(64)}",a,",") }`] }, { maxSteps: 64 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /step limit/u);
  assert.equal(cleared, 0);
  new Map([["old", 7]]).clear();
  assert.equal(cleared, 1, "observer must detect an actual clear before mutation");
});

for (const separator of ["", " ", ",", ",+"]) {
  test(`awk does not eagerly materialize split arrays: ${JSON.stringify(separator)}`, async context => {
    const input = "a,a a";
    const split = String.prototype.split;
    const iterator = String.prototype[Symbol.iterator];
    let eager = 0;
    String.prototype.split = function (this: string, separator: string | RegExp | { [Symbol.split](value: string, limit?: number): string[] }, limit?: number) {
      if (String(this) === input) eager++;
      return Reflect.apply(split, this, [separator, limit]) as string[];
    };
    String.prototype[Symbol.iterator] = function (this: string) {
      if (String(this) === input) eager++;
      return iterator.call(this);
    };
    context.after(() => { String.prototype.split = split; String.prototype[Symbol.iterator] = iterator; });
    const result = await runVirtual("awk", { args: ["-F", separator, "{}"], stdin: input });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(eager, 0);
  });
}

test("awk rejects the next field before slicing its payload", async context => {
  const input = `${"a,".repeat(100000)}UNADMITTED`;
  const slice = String.prototype.slice;
  let copied = 0;
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    if (String(this) === input && start === 200000) copied++;
    return slice.call(this, start, end);
  };
  context.after(() => { String.prototype.slice = slice; });
  const result = await runVirtual("awk", { args: ["-F", ",+", "{}"], stdin: input });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /field count limit/u);
  assert.equal(copied, 0);
});

test("awk awaits field-zero, increment, substitution and getline setters", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { $0="a b"; print NF,$2; sub(/a/,"c"); print $1; gsub(/ /,","); FS=","; $0=$0; print NF,$2; $0=3; print $0++, $1, NF; getline $0 < "input"; print NF,$2; getline < "input"; print NF,$2 }'], files: { input: "x,y\nz,w\n" } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "2 b\nc\n2 b\n3 4 1\n2 y\n2 w\n");
});

for (const tool of ["sed", "awk"] as const) {
  test(`${tool} cancels byte processing at a bounded checkpoint and closes input`, async context => {
    const fs = await makeFileSystem();
    const controller = new AbortController();
    let closed = false;
    const input = (async function* () { try { yield Buffer.from(`${"a".repeat(1024)}\n`); } finally { closed = true; } })();
    const checkpoint = Budget.prototype.checkpoint;
    let calls = 0;
    context.mock.method(Budget.prototype, "checkpoint", async function (this: Budget) {
      if (++calls === 3) {
        assert.equal(closed, false, "input must still be open when cancellation occurs");
        controller.abort(false);
      }
      await checkpoint.call(this);
    });
    const definition = createTextProgramCommands().find(command => command.name === tool)!;
    await assert.rejects(async () => definition.execute({
      command: tool, args: tool === "sed" ? ["y/a/b/"] : ["-F", "", "{}"], cwd: "/work", fs, env: {},
      signal: controller.signal, stdin: input,
      stdout: { async write() { assert.fail("aborted transform must not write"); } }, stderr: { async write() { assert.fail("cancellation is not a diagnostic"); } },
    }), (reason: unknown) => reason === false);
    assert.equal(calls, 3);
    assert.equal(closed, true);
  });

  test(`${tool} transform output awaits backpressure`, async () => {
    const fs = await makeFileSystem();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let settled = false;
    const definition = createTextProgramCommands().find(command => command.name === tool)!;
    const execution = Promise.resolve(definition.execute({
      command: tool, args: tool === "sed" ? ["y/a/b/"] : ["-F", "", '{ print $1,$2 }'], cwd: "/work", fs, env: {},
      signal: new AbortController().signal, stdin: toByteSource("aa"),
      stdout: { async write() { entered(); await blocked; } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } },
    })).then(result => { settled = true; return result; });
    await started;
    try { assert.equal(settled, false); } finally { release(); }
    assert.equal((await execution).exitCode, 0);
  });
}

for (const [name, program, stdin, separator, parts] of [
  ["print", 'BEGIN { OFS="............"; print "a", "b", "c", "d" }', "", "............", ["a", "b", "c", "d"]],
  ["record", 'BEGIN { OFS="................" } { $3="z" }', "a b c", "................", ["a", "b", "z"]],
  ["SUBSEP", 'BEGIN { SUBSEP="................"; a["a", "b", "c"]=1 }', "", "................", ["a", "b", "c"]],
] as const) {
  test(`awk rejects oversized ${name} before joining`, async context => {
    const original = Array.prototype.join;
    let rejected = 0;
    Array.prototype.join = function (this: unknown[], delimiter?: string): string {
      if (delimiter === separator && this.length === parts.length
        && parts.every((part, index) => this[index] === part)) rejected++;
      return original.call(this, delimiter);
    };
    context.after(() => { Array.prototype.join = original; });
    const result = await runVirtual("awk", { args: [program], stdin }, { maxBufferBytes: 32 });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /buffer limit/u);
    assert.equal(rejected, 0, "oversized join must not run");
    assert.equal(result.stdout.length, 0);
  });
}
