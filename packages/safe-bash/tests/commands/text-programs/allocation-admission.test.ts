import assert from "node:assert/strict";
import test from "node:test";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { makeFileSystem, runVirtual } from "./helpers.js";

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
