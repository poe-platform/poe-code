import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands } from "../../../src/core.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type ByteSource } from "../../../src/contracts/index.js";
import { type JqLimits } from "../../../src/commands/structured/index.js";
import { chunks, run, runWithBytes } from "./helpers.js";

// Exact successful output from jq-1.7 (LC_ALL=C), without a runtime oracle dependency.
const cases: [string, string[], string][] = [
  ["string arguments", ["-n", "$ARGS.positional", "--args", "one", "two"], '[\n  "one",\n  "two"\n]\n'],
  ["JSON arguments", ["-n", "$ARGS.positional", "--jsonargs", "1", "true"], '[\n  1,\n  true\n]\n'],
  ["mode before filter", ["-nc", "--args", "$ARGS.positional", "one"], '["one"]\n'],
  ["JSON mode before filter", ["-nc", "--jsonargs", "$ARGS.positional", "null"], '[null]\n'],
  ["switch to JSON", ["-nc", "$ARGS.positional", "--args", "one", "--jsonargs", "2", "true"], '["one",2,true]\n'],
  ["switch to strings", ["-nc", "$ARGS.positional", "--jsonargs", "1", "--args", "two"], '[1,"two"]\n'],
  ["empty strings and Unicode", ["-nc", "$ARGS.positional", "--args", "", "é😀", "a\nb"], '["","é😀","a\\nb"]\n'],
  ["negative and dash operands", ["-nc", "$ARGS.positional", "--args", "-1", "-.5", "-", "-?"], '["-1","-.5","-","-?"]\n'],
  ["negative JSON and precision", ["-nc", "$ARGS.positional", "--jsonargs", "-2.50", "9007199254740993123456789"], '[-2.50,9007199254740993123456789]\n'],
  ["JSON containers", ["-nc", "$ARGS.positional", "--jsonargs", '[1,true,null]', '{"__proto__":"safe"}', '"text"'], '[[1,true,null],{"__proto__":"safe"},"text"]\n'],
  ["option terminator", ["-nc", "$ARGS.positional", "--args", "--", "--jsonargs", "-n", "-"], '["--jsonargs","-n","-"]\n'],
  ["JSON option terminator", ["-nc", "$ARGS.positional", "--jsonargs", "--", "-1", "false"], '[-1,false]\n'],
  ["later options", ["-n", "$ARGS.positional", "--args", "one", "-c", "two"], '["one","two"]\n'],
  ["no string arguments", ["-nc", "$ARGS", "--args"], '{"positional":[],"named":{}}\n'],
  ["no JSON arguments", ["-nc", "$ARGS", "--jsonargs"], '{"positional":[],"named":{}}\n'],
  ["named bindings and ARGS override", ["-nc", "--arg", "ARGS", "custom", "$ARGS", "--args", "one", "--argjson", "n", "2", "two"], '{"positional":["one","two"],"named":{"ARGS":"custom","n":2}}\n'],
];

for (const [name, args, output] of cases) test(`jq positional ${name}`, async () => {
  const result = await runWithBytes(args);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Buffer.from(output));
  assert.equal(result.stderr, "");
});

for (const [mode, argument, output] of [
  ["--args", "one", '[["one"],1]\n[["one"],2]\n'],
  ["--jsonargs", "true", '[[true],1]\n[[true],2]\n'],
] as const) test(`jq ${mode} keeps stdin as the data source`, async () => {
  const result = await run(["-c", "[$ARGS.positional,.]", mode, argument], chunks("1\n2\n"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, output);
  assert.equal(result.stderr, "");
});

test("jq positional arguments work through Shell with virtual filters, files, pipes and redirects", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/filter.jq", Buffer.from("[$ARGS.positional,.]"));
  await fs.writeFile("/work/input", Buffer.from("7"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const [command, output] of [
      ["jq -n '$ARGS.positional' --args one two", '[\n  "one",\n  "two"\n]\n'],
      ["jq -n '$ARGS.positional' --jsonargs 1 true", '[\n  1,\n  true\n]\n'],
      ["jq -c -f filter.jq input --args missing.json --arg x named", '[["missing.json"],7]\n'],
      ["printf '8\\n' | jq -c --jsonargs -f filter.jq 2 > output; cat output", '[[2],8]\n'],
    ]) {
      const result = await shell.exec(command!);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, output);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

const unreadable: ByteSource = { [Symbol.asyncIterator]() { throw new Error("must not acquire stdin"); } };

for (const argument of ["", " ", "1 2", "[1,]", '{"x":', "truefalse"]) {
  test(`jq rejects malformed JSON positional argument ${JSON.stringify(argument)} before reading files or stdin`, async () => {
    const fs = new MemoryFileSystem();
    fs.readStream = () => { throw new Error("must not acquire files"); };
    const result = await run(["-f", "filter.jq", "--jsonargs", argument], unreadable, {}, { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "jq: invalid JSON text passed to --jsonargs\n");
  });
}

test("jq positional mode still rejects unknown options and malformed string Unicode", async () => {
  for (const mode of ["--args", "--jsonargs"]) {
    const result = await run(["-nc", "$ARGS.positional", mode, "--unknown"], unreadable);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "jq: unsupported option --unknown\n");
  }
  const malformed = await run(["-nc", "0", "--args", "\ud800"], unreadable);
  assert.equal(malformed.exitCode, 2);
  assert.equal(malformed.stderr, "jq: arguments must contain well-formed Unicode\n");
});

for (const [mode, values, encoded] of [
  ["--args", ["é", "\n"], '["é","\\n"]'],
  ["--jsonargs", ["1", "true"], '[1,true]'],
] as const) test(`jq ${mode} bounds the aggregate positional value before unused arguments can bypass limits`, async () => {
  const args = ["-nc", "0", mode, ...values];
  const bytes = Buffer.byteLength(encoded);
  const accepted = await run(args, unreadable, { limits: { maxValueBytes: bytes } });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(accepted.stdout, "0\n");
  const rejected = await run(args, unreadable, { limits: { maxValueBytes: bytes - 1 } });
  assert.equal(rejected.exitCode, 5);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "jq: maxValueBytes limit exceeded\n");
});

test("jq named and positional arguments share the variable byte budget in either order", async () => {
  for (const args of [
    ["-nc", "0", "--arg", "x", "1234", "--args", "abcd"],
    ["-nc", "0", "--args", "abcd", "--arg", "x", "1234"],
  ]) {
    const result = await run(args, unreadable, { limits: { maxValueBytes: 14 } });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr, "jq: maxValueBytes limit exceeded\n");
  }
});

for (const [args, limit, value] of [
  [["-nc", "0", "--args", "é"], "maxInputBytes", 11],
  [["-nc", "0", "--args", "a", "b"], "maxCollectionSize", 4],
  [["-nc", "0", "--jsonargs", "[1,2,3,4,5]"], "maxCollectionSize", 4],
  [["-nc", "0", "--jsonargs", "[[0]]"], "maxDepth", 2],
  [["-nc", "0", "--args", "abcdefghij"], "maxSteps", 3],
  [["-nc", "0", "--jsonargs", "[1,2,3]"], "maxSteps", 3],
] as [string[], keyof JqLimits, number][]) test(`jq positional arguments retain ${limit}: ${args.join(" ")}`, async () => {
  const result = await run(args, unreadable, { limits: { [limit]: value } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `jq: ${limit} limit exceeded\n`);
});
