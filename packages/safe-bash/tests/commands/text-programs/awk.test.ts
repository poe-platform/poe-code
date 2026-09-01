import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./helpers.js";

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
