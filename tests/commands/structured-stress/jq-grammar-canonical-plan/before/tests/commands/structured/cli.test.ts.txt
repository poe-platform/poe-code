import assert from "node:assert/strict";
import { test } from "node:test";
import { createStructuredCommands, defaultJqLimits, structuredCommands } from "../../../src/commands/structured/index.js";
import { CommandRegistry, type ByteSource, type PluginHost } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { chunks, run } from "./helpers.js";

const streamCases: [string[], string, string, number][] = [
  [["-c", "."], '1 2\n{"a":3}', '1\n2\n{"a":3}\n', 0],
  [["-c", "."], '{}[]"x""y"', '{}\n[]\n"x"\n"y"\n', 0],
  [["-c", "."], '1{}', '1\n{}\n', 0],
  [["-c", "."], '1true', '', 5],
  [["-c", "."], 'truefalse', '', 5],
  [["-c", "."], '1\n{"bad":', '1\n', 5],
  [["-sc", "."], '1\n{"bad":', '', 5],
  [["-sc", "."], '', '[]\n', 0],
  [["-nsc", "."], 'INVALID', 'null\n', 0],
  [["-ec", "."], '', '', 4],
  [["-ec", "empty"], 'null', '', 4],
  [["-ec", "."], 'true\nnull', 'true\nnull\n', 1],
  [["-ec", "."], 'null\n0', 'null\n0\n', 0],
  [["-ec", "select(.!=null)"], '1\nnull', '1\n', 0],
  [["-ec", "select(.!=null)"], 'false\nnull', 'false\n', 1],
  [["-rec", '"false"'], 'null', 'false\n', 0],
  [["-rec", '""'], 'null', '\n', 0],
  [["-ec", "1,1/0"], 'null', '1\n', 5],
  [["-c", "1,("], 'NOT JSON', '', 3],
  [["-c", "1,unknown_builtin"], 'NOT JSON', '', 3],
  [["-c", "false and unknown_builtin"], 'NOT JSON', '', 3],
  [["-c", "--arg", "x", "123", "--argjson", "y", "123", "[$x,$y]"], 'null', '["123",123]\n', 0],
  [["-c", "--argjson", "x", "1 2", "$x"], 'null', '', 2],
  [["-c", "--argjson", "x", "", "$x"], 'null', '', 2],
  [["-c", "--arg", "x", "one", "--arg", "x", "two", "$x"], 'null', '"one"\n', 0],
  [["."], '{"b":[1,{"a":2}]}', '{\n  "b": [\n    1,\n    {\n      "a": 2\n    }\n  ]\n}\n', 0],
  [["-c"], '{"a":1,"a":2}', '{"a":2}\n', 0],
  [["--raw-output", "--compact-output", "--slurp", "map(.x)"], '{"x":1}\n{"x":2}', '[1,2]\n', 0],
  [["--null-input", "--exit-status", "--", "-1"], 'ignored', '-1\n', 0],
  [["-c", "--arg", "bad-key", "ok", '$ARGS.named["bad-key"],$ARGS.positional'], 'null', '"ok"\n[]\n', 0],
];
for (const [index, [args, input, stdout, status]] of streamCases.entries()) test(`CLI stream/status matrix ${index + 1}`, async () => {
  const result = await run(args, chunks(input));
  assert.equal(result.exitCode, status, result.stderr); assert.equal(result.stdout, stdout);
});

test("whole stream, every byte, and every two-way UTF-8 split agree", async () => {
  const input = Buffer.from('{"s":"A😀B"}\n1e2\n"x\\\"y"\n');
  const expected = '{"s":"A😀B"}\n1E+2\n"x\\\"y"\n';
  for (let split = 0; split <= input.length; split++) {
    const source = (async function* () { yield input.slice(0, split); yield input.slice(split); })();
    const result = await run(["-c", "."], source);
    assert.equal(result.stdout, expected); assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal((await run(["-c", "."], chunks(input))).stdout, expected);
  assert.equal((await run(["-c", "."], input)).stdout, expected);
});

test("malformed UTF-8 preserves completed JSON prefix across every chunk split", async () => {
  for (const suffix of [[0xff], [0xc3], [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
    for (const prefix of ['{}\n', '"😀"\n1\n', '{"a":[1]}\n"incomplete']) {
      const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from(suffix)]);
      const expected = prefix === '{}\n' ? '{}\n' : prefix.startsWith('"😀"') ? '"😀"\n1\n' : '{"a":[1]}\n';
      for (let split = 0; split <= bytes.length; split++) {
        const source = (async function* () { yield bytes.subarray(0, split); yield bytes.subarray(split); })();
        const result = await run(["-c", "."], source);
        assert.equal(result.exitCode, 5); assert.equal(result.stdout, expected, `${suffix} split ${split}`); assert.match(result.stderr, /invalid UTF-8/);
      }
      const single = await run(["-c", "."], chunks(bytes)); assert.equal(single.stdout, expected); assert.equal(single.exitCode, 5);
      const slurp = await run(["-sc", "."], bytes); assert.equal(slurp.stdout, ""); assert.equal(slurp.exitCode, 5);
    }
  }
});

test("compile errors precede stdin iterator creation and data-file effects", async () => {
  let effects = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { effects++; throw new Error("unexpected stdin effect"); } };
  const fs = new MemoryFileSystem();
  fs.readStream = () => { effects++; throw new Error("unexpected file effect"); };
  for (const source of ["", "(", "1,(", "{a:", "[", ".a[", "$missing", "false and unknown", '"\\uD800"', '"\\uDC00"', "1e+", ".a |=", "def f: .; f", ".a[1:2]=[]", "(.[]|select(.>1))|=.+10"]) {
    const result = await run(["-c", source, "data.json"], stdin, {}, { fs });
    assert.equal(result.exitCode, 3, `${source}: ${result.stderr}`); assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /TypeError|Cannot read|stack/i);
  }
  assert.equal(effects, 0);
});

test("null-input ignores stdin and data files, but still compiles", async () => {
  let effects = 0;
  const input: ByteSource = { [Symbol.asyncIterator]() { effects++; throw new Error("unexpected input"); } };
  const result = await run(["-nsc", ".", "/missing.json"], input);
  assert.equal(result.stdout, "null\n"); assert.equal(effects, 0);
  assert.equal((await run(["-nc", "missing"], input)).exitCode, 3);
});

test("virtual files, relative -f, input order, and filesystem signal propagation", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/filter.jq", Buffer.from("# comment\n.x + $offset"));
  await fs.writeFile("/work/one.json", Buffer.from('{"x":1}'));
  await fs.writeFile("/work/two.json", Buffer.from('{"x":2}'));
  const original = fs.readStream.bind(fs);
  const signal = new AbortController().signal;
  const reads: string[] = [];
  fs.readStream = (path, options) => { assert.equal(options?.signal, signal); reads.push(path); return original(path, options); };
  const result = await run(["-c", "--argjson", "offset", "10", "-f", "filter.jq", "one.json", "-", "two.json"], '{"x":3}', {}, { fs, cwd: "/work", signal });
  assert.equal(result.stdout, "11\n13\n12\n"); assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(reads, ["/work/filter.jq", "/work/one.json", "/work/two.json"]);
  assert.equal((await run(["-f", "missing.jq"], "", {}, { fs, signal })).exitCode, 2);
  await fs.writeFile("/bad.jq", Buffer.from("1,(")); reads.length = 0;
  assert.equal((await run(["-f", "/bad.jq", "/work/one.json"], "", {}, { fs, signal })).exitCode, 3);
  assert.deepEqual(reads, ["/bad.jq"]);
});

test("bounded readFile fallback supplies signal and explicit maxBytes", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/filter", Buffer.from(".")); await memory.writeFile("/data", Buffer.from("1"));
  const signal = new AbortController().signal;
  const observed: number[] = [];
  const fs = new Proxy(memory, { get(target, property) {
    if (property === "readStream") return undefined;
    if (property === "readFile") return async (path: string, options: { signal?: AbortSignal; maxBytes?: number }) => {
      assert.equal(options.signal, signal); assert.equal(typeof options.maxBytes, "number"); observed.push(options.maxBytes!);
      return memory.readFile(path, options);
    };
    const value: unknown = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run(["-cf", "/filter"], "", {}, { fs, signal });
  assert.equal(result.exitCode, 2);
  assert.equal((await run(["-c", "-f", "/filter", "/data"], "", {}, { fs, signal })).stdout, "1\n");
  assert.deepEqual(observed, [defaultJqLimits.maxSourceBytes, defaultJqLimits.maxInputBytes]);
});

test("plugin definitions, duplicate registration, replacement, and immutable defaults", async () => {
  const registry = new CommandRegistry(); const host: PluginHost = { commands: registry, use() {}, registerFileSystem() {} };
  assert.deepEqual(createStructuredCommands().map(command => command.name), ["jq"]);
  await structuredCommands().setup(host);
  assert.throws(() => structuredCommands().setup(host), /already registered/);
  await structuredCommands({ replace: true }).setup(host);
  assert.ok(Object.isFrozen(defaultJqLimits));
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => structuredCommands({ limits: { maxSteps: value } }), RangeError);
  assert.throws(() => structuredCommands({ limits: { maxDepth: 257 } }), RangeError);
  assert.throws(() => structuredCommands({ limits: { maxAstDepth: 129 } }), RangeError);
});
