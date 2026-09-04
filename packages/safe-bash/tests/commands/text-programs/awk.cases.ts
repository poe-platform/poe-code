import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./helpers.js";

for (const program of ['{ print }', 'BEGIN { while ((getline value < "-") > 0) print value }']) {
  for (const carriedBytes of [0, 64]) {
    test(`awk reader rejects before copying or decoding: carry=${carriedBytes}, ${program}`, async context => {
      const maxBufferBytes = 128;
      const rejected = new Uint8Array(maxBufferBytes - carriedBytes + 1).fill(120);
      const prefix = Buffer.from(`done\n${"x".repeat(carriedBytes)}`);
      let pulls = 0;
      let closed = false;
      const source = (async function* () {
        try {
          if (carriedBytes) { pulls++; yield prefix; }
          pulls++; yield rejected;
          pulls++; yield Uint8Array.of(10);
        } finally { closed = true; }
      })();
      const from = context.mock.method(Buffer, "from");
      const toString = context.mock.method(Buffer.prototype, "toString");
      const result = await runVirtual("awk", { args: [program] }, { maxBufferBytes }, source);
      const copies = from.mock.calls.filter(call => call.arguments[0] === rejected);
      const decodings = toString.mock.calls.filter((call: { this: unknown }) => copies.some(copy => copy.result === call.this));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr.toString(), "awk: text buffer limit exceeded\n");
      assert.equal(result.stdout.toString(), carriedBytes ? "done\n" : "");
      assert.equal(pulls, carriedBytes ? 2 : 1);
      assert.equal(closed, true);
      assert.deepEqual({ copies: copies.length, decodings: decodings.length }, { copies: 0, decodings: 0 });
    });
  }
}

test("awk reader admits exact byte limits with split UTF-8, carry and empty chunks", async () => {
  const contents = Buffer.from(`${"é".repeat(63)}x\n`);
  assert.equal(contents.byteLength, 128);
  const source = (async function* () {
    yield contents.subarray(0, 1);
    yield new Uint8Array();
    yield contents.subarray(1, 127);
    yield contents.subarray(127);
    yield contents;
  })();
  const result = await runVirtual("awk", { args: ['{ print }'] }, { maxBufferBytes: 128 }, source);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.concat([contents, contents]));
});

test("awk reader counts UTF-8 bytes rather than decoded characters", async () => {
  const result = await runVirtual("awk", { args: ['{ print }'], stdin: `${"é".repeat(64)}\n` }, { maxBufferBytes: 128 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "awk: text buffer limit exceeded\n");
  assert.equal(result.stdout.length, 0);
});

test("awk reader retains owned raw bytes across producer reuse and unterminated EOF", async () => {
  const source = (async function* () {
    const chunk = Uint8Array.of(0xff, 0xc3);
    yield chunk;
    chunk.set([0xa9, 0]);
    yield chunk;
    chunk.fill(120);
  })();
  const result = await runVirtual("awk", { args: ['{ print }'] }, { maxBufferBytes: 128 }, source);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from([0xff, 0xc3, 0xa9, 0, 10]));
});

for (const [name, program, expected] of [
  ["empty program", "", ""],
  ["only repeated mixed separators", "\n;;\n;\n", ""],
  ["mixed statement and rule separators", '\n;;BEGIN { ;\n; print "first";\n;; print "second"\n;; };\n;END { print "last" };;\n', "first\nsecond\nlast\n"],
  ["empty action", "\nBEGIN\n\n{\n;;\n}\n", ""],
  ["semicolon remains an empty conditional body", 'BEGIN { if (0); print "after"; while (0); print "done" }', "after\ndone\n"],
  ["literal separators", 'BEGIN { print ";", "a;b", "\\n"; print "after" }', "; a;b \n\nafter\n"],
  ["newlines before action and in conditions", 'BEGIN\n\n{ if (\n\n1\n\n)\n\n print "yes"; else\n\n print "no" }', "yes\n"],
  ["newlines before function body", 'function value()\n\n{ return 7 }\n\nBEGIN { print value() }', "7\n"],
] as const) {
  test(`Group E awk separator control: ${name}`, async () => {
    const result = await runVirtual("awk", { args: [program], stdin: "input\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.files, {});
  });
}

for (const [name, program] of [
  ["before BEGIN action", 'BEGIN; { print "bad" > "created" }'],
  ["before function body", 'function value(); { return 7 } BEGIN { print "bad" > "created" }'],
  ["before condition expression", 'BEGIN { print "bad" > "created"; if (;1) print "bad" }'],
  ["after condition expression", 'BEGIN { print "bad" > "created"; if (1;) print "bad" }'],
] as const) {
  test(`Group E awk rejects semicolon ${name} before effects`, async () => {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("input\n"); })();
    const result = await runVirtual("awk", { args: [program] }, {}, source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.notEqual(result.stderr.length, 0);
    assert.deepEqual(result.files, {});
    assert.equal(consumed, false);
  });
}

test("awk rejects unsupported syntax and unknown calls before input and output effects", async () => {
  for (const program of [
    'BEGIN { print "bad" > "created"; system("never execute") }',
    'BEGIN { print "bad"; getline value }',
    'BEGIN { print "bad" | "never execute" }',
    'BEGIN { print "bad"; missing_function() }',
    'BEGIN { print "bad"; break }',
    'BEGIN { print "bad"; next }',
    'BEGIN { print "bad"; values=split("x", "not-an-array") }',
    'BEGIN { print "bad"; value=match("x", /(unterminated/) }',
    'BEGIN { print "bad"; printf "%q", "x" }',
    'BEGIN { print "bad"; value=sprintf("%q", "x") }',
    'BEGIN { print "bad"; index=1 }',
  ]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("input\n"); })();
    const result = await runVirtual("awk", { args: [program] }, {}, source);
    assert.equal(result.exitCode, 2, program);
    assert.equal(result.stdout.length, 0, program);
    assert.deepEqual(result.files, {}, program);
    assert.equal(consumed, false, program);
  }
});

test("awk loops, recursive functions and regex matching are bounded", async () => {
  for (const program of ['BEGIN { while(1) value++ }', 'function repeat() { return repeat() } BEGIN { repeat() }', '{ print ($0 ~ /(a+)+b/) }']) {
    const result = await runVirtual("awk", { args: [program], stdin: "a".repeat(1000) }, { maxSteps: 1000 });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /limit/u);
  }
});

test("awk streams one-byte records and composes with sed and existing virtual tools", async () => {
  const streamed = await runVirtual("awk", { args: ['{ sum+=$2 } END { print NR,sum }'] }, {}, byteChunks("one 2\ntwo 3"));
  assert.equal(streamed.stdout.toString(), "2 5\n");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'skip:z 99\\nkeep:pear 2\\nkeep:apple 3\\nkeep:pear 4\\n' | sed -n 's/^keep://p' | awk '{ sums[$1]+=$2 } END { for(name in sums) printf \"%s:%d\\n\",name,sums[name] }' | sort | tee totals");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "apple:3\npear:6\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/totals")), result.stdout);
});
