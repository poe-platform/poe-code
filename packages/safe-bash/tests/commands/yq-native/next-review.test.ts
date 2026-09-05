import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { basicCommands } from "../../../src/commands/basic.js";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { native, nativeOptions, run } from "./helpers.js";

const cases: readonly { readonly name: string; readonly args: readonly string[]; readonly input: string }[] = [
  { name: "numeric keys retain insertion order and duplicates", args: ["-p=json", "-o=json", "-I0", "."], input: '{"10":1,"2":2,"10":3,"01":4,"0":5}' },
  { name: "escaped duplicate keys retain both pairs", args: ["-p=json", "-o=json", "-I0", "."], input: '{"a":1,"\\u0061":2,"a":3}' },
  { name: "escaped duplicate lookup selects last pair", args: ["-p=json", ".a"], input: '{"a":1,"\\u0061":2}' },
  { name: "prototype names are literal nested members", args: ["-p=json", "-o=json", "-I0", "."], input: '{"__proto__":{"polluted":true},"constructor":{"prototype":1},"toString":2,"__proto__":3}' },
  { name: "nested numeric-order duplicate update", args: ["-p=json", "-o=json", "-I0", ".outer.a = 9"], input: '{"outer":{"2":0,"a":1,"1":2,"a":3}}' },
  { name: "JSON integer spelling beyond safe number", args: ["-p=json", "-o=json", "-I0", "."], input: '{"a":9007199254740993,"a":9223372036854775807}' },
  { name: "JSON negative zero and exponent spelling", args: ["-p=json", "-o=json", "-I0", "."], input: '[-0,1e2,1.0,1e-7]' },
  { name: "missing object value diagnostic", args: ["-p=json", "."], input: '{"a":}' },
  { name: "missing nested array value diagnostic", args: ["-p=json", "."], input: '{"a":[1,]}' },
  { name: "missing object comma diagnostic", args: ["-p=json", "."], input: '{"a":1 "b":2}' },
  { name: "unpaired escaped surrogate", args: ["-p=json", "-o=json", "."], input: '{"a":"\\ud800"}' },
  { name: "two-byte wildcard unit", args: ['.a == "??"'], input: "a: é\n" },
  { name: "four-byte wildcard restart", args: ['.a == "*????z"'], input: "a: x😀z\n" },
  { name: "wildcard brackets remain literal", args: ['.a == "[ab]"'], input: "a: a\n" },
  { name: "repeated wildcard stars", args: ['.a == "**a**?**b**"'], input: "a: xaZb\n" },
  { name: "custom tagged exponent addition", args: [".a + .b"], input: "a: !number 1e3\nb: 1\n" },
  { name: "custom tagged hexadecimal addition", args: [".a + .b"], input: "a: !number 0x10\nb: 1\n" },
  { name: "hexadecimal negative result spelling", args: [".a + .b"], input: "a: 0xF\nb: -16\n" },
  { name: "single quote styling preserves scalar spelling", args: ['.a style="single"'], input: "a: 0xF\n" },
  { name: "tagged quoted numeric addition", args: [".a + .b"], input: 'a: !number "12"\nb: 3\n' },
  { name: "multiline quoted key and value", args: ["."], input: '"one\ntwo": "three\nfour"\n' },
  { name: "multiline flow quote with hash data", args: ["."], input: '{a: "one\n#data\ntwo", b: 2}\n' },
  { name: "escaped multiline quote continuation", args: ["."], input: 'a: "one\\\ntwo"\n' },
  { name: "CRLF multiline quote continuation", args: ["."], input: 'a: "one\r\ntwo"\r\n' },
  { name: "quoted non-marker document prefix", args: ["."], input: 'a: "one\n---data\ntwo"\n' },
  { name: "later malformed quote retains prior JSON output", args: ["-o=json", "-I0", "."], input: 'a: 1\n---\nb: "two\n...\nthree"\n' },
];

for (const entry of cases) test(`next independent native: ${entry.name}`, nativeOptions, async () => {
  const expected = await native(entry.args, entry.input);
  const actual = await run(entry.args, entry.input);
  assert.deepEqual(actual, expected);
});

test("ordered JSON prototype members cannot mutate host object prototypes", async () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const input = '{"__proto__":{"polluted":true},"2":2,"1":1,"constructor":3,"__proto__":4}';
  assert.deepEqual(await run(["-p=json", "-o=json", "-I0", "."], input), { status: 0, stdout: `${input}\n`, stderr: "" });
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

for (const limits of [{ maxParserNodes: 8 }, { maxDocumentBytes: 32 }, { maxOutputBytes: 8 }]) test(`duplicate JSON in-place refusal preserves original: ${JSON.stringify(limits)}`, async () => {
  const fs = createMemoryFileSystem();
  const input = `{"a":1,${'"a":2,'.repeat(16)}"a":3}`;
  await fs.writeFile("/input", Buffer.from(input));
  const result = await run(["-i", "-p=json", "-o=json", ".", "/input"], "", { fs }, { limits });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /limit exceeded/u);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

for (const reason of [false, 0, "", null]) test(`duplicate JSON cancellation preserves falsey root reason: ${String(reason)}`, async () => {
  const controller = new AbortController();
  let returned = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      yield Buffer.from('{"a":1,');
      controller.abort(reason);
      yield Buffer.from('"a":2}');
    } finally { returned = true; }
  } };
  await assert.rejects(run(["-p=json", "."], "", { stdin, signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(returned, true);
});

for (const enough of [false, true]) test(`ordered JSON in-place writes share the Shell output budget: ${enough}`, async context => {
  const fs = createMemoryFileSystem();
  const input = '{"a":1,"a":2}';
  await fs.writeFile("/input", Buffer.from(input));
  const shell = new Shell({ fs, limits: { maxOutputBytes: Buffer.byteLength(input) + (enough ? 2 : 1) } });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  shell.use(mikeYqCommands({ replace: true }));
  const operation = shell.exec("printf z; yq -i -p=json -o=json -I0 . /input");
  if (enough) {
    const result = await operation;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "z");
    assert.equal(result.stderr, "");
  } else await assert.rejects(operation, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), enough ? `${input}\n` : input);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});
