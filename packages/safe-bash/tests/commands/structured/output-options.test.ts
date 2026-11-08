import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands } from "../../../src/core.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { chunks, run, runWithBytes } from "./helpers.js";

// Fixed output bytes from jq-1.7; these regressions do not require a host jq.
const cases: [string, string[], string, string][] = [
  ["ASCII short option", ["-a"], '"é😀"', '"\\u00e9\\ud83d\\ude00"\n'],
  ["ASCII long option", ["--ascii-output"], '{"é":"😀"}', '{\n  "\\u00e9": "\\ud83d\\ude00"\n}\n'],
  ["four-space indentation", ["--indent", "4"], '{"a":[1]}', '{\n    "a": [\n        1\n    ]\n}\n'],
  ["zero indentation", ["--indent", "0"], '{"a":[1]}', '{"a":[1]}\n'],
  ["tab indentation", ["--tab"], '{"a":[1]}', '{\n\t"a": [\n\t\t1\n\t]\n}\n'],
  ["indent after compact", ["-c", "--indent", "4"], '[1]', '[\n    1\n]\n'],
  ["compact after indent", ["--indent", "4", "-c"], '[1]', '[1]\n'],
  ["tab after compact", ["-c", "--tab"], '[1]', '[\n\t1\n]\n'],
  ["monochrome short option", ["-M"], '"é"', '"é"\n'],
  ["monochrome long option", ["--monochrome-output"], '"é"', '"é"\n'],
  ["color short option", ["-C"], '"é"', '\x1b[0;32m"é"\x1b[0m\n'],
  ["color long option", ["--color-output"], '"é"', '\x1b[0;32m"é"\x1b[0m\n'],
  ["monochrome after color", ["-CM"], '"é"', '"é"\n'],
  ["monochrome before color", ["-MC"], '"é"', '"é"\n'],
  ["NUL output", ["--raw-output0"], '"é"', 'é\0'],
  ["NUL nonstring output", ["--raw-output0", "-c"], '{"a":1}', '{"a":1}\0'],
  ["unbuffered output", ["--unbuffered"], '"é"', '"é"\n'],
  ["colored nested values", ["-cC"], '{"a":[null,true,false,1,"é",{},[]]}', '\x1b[1;39m{\x1b[0m\x1b[1;34m"a"\x1b[0m\x1b[1;39m:\x1b[0m\x1b[1;39m[\x1b[0;90mnull\x1b[0m\x1b[1;39m,\x1b[0;39mtrue\x1b[0m\x1b[1;39m,\x1b[0;39mfalse\x1b[0m\x1b[1;39m,\x1b[0;39m1\x1b[0m\x1b[1;39m,\x1b[0;32m"é"\x1b[0m\x1b[1;39m,\x1b[1;39m{}\x1b[0m\x1b[1;39m,\x1b[1;39m[]\x1b[0m\x1b[1;39m\x1b[1;39m]\x1b[0m\x1b[1;39m\x1b[1;39m}\x1b[0m\n'],
  ["colored tabs", ["-C", "--tab"], '{"a":[1]}', '\x1b[1;39m{\n\t\x1b[0m\x1b[1;34m"a"\x1b[0m\x1b[1;39m: \x1b[0m\x1b[1;39m[\n\t\t\x1b[0;39m1\x1b[0m\x1b[1;39m\n\t\x1b[1;39m]\x1b[0m\x1b[1;39m\n\x1b[1;39m}\x1b[0m\n'],
  ["colored NaN", ["-C"], 'NaN', '\x1b[0;39m\x1b[0;90mnull\x1b[0m\x1b[0m\n'],
  ["ASCII raw sequence without color", ["-Cra", "--seq"], '\x1e"é\\u0000"\n', '"\\u00e9\\u0000"\n'],
  ["ASCII NUL output permits escaped NUL", ["--raw-output0", "-ja"], '"é\\u0000"', '"\\u00e9\\u0000"\0'],
  ["NUL sequence output", ["--raw-output0", "--seq", "-c"], '\x1e{"a":1}\n', '\x1e{"a":1}\0'],
  ["colored ASCII controls", ["-Ca"], '"\\b\\n\\t\\r\\f\\u007f\\u0080é😀"', '\x1b[0;32m"\\b\\n\\t\\r\\f\\u007f\\u0080\\u00e9\\ud83d\\ude00"\x1b[0m\n'],
  ["join after NUL output", ["--raw-output0", "-j"], '"é"', 'é\0'],
  ["NUL output after join", ["-j", "--raw-output0"], '"é"', 'é\0'],
  ["negative-one indentation", ["--indent", "-1"], '[1]', '[\n\t1\n]\n'],
  ["native indent integer prefix", ["--indent", "2x"], '[1]', '[\n  1\n]\n'],
  ["nonnumeric indentation", ["--indent", "x"], '[1]', '[1]\n'],
];

for (const [name, flags, input, output] of cases) test("jq " + name, async () => {
  const result = await runWithBytes([...flags, "."], chunks(input));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Buffer.from(output));
  assert.equal(result.stderr, "");
});

for (const [name, flags, input, output] of cases) test("jq " + name + " charges exact output bytes", async () => {
  const size = Buffer.byteLength(output);
  const accepted = await run([...flags, "."], input, { limits: { maxOutputBytes: size } });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(accepted.stdout, output);
  const rejected = await run([...flags, "."], input, { limits: { maxOutputBytes: size - 1 } });
  assert.equal(rejected.exitCode, 5);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "jq: maxOutputBytes limit exceeded\n");
});

for (const flags of [["--indent"], ["--indent", "8"], ["--indent", "-2"], ["--indent=4"]]) {
  test("jq rejects invalid indentation before reading input: " + flags.join(" "), async () => {
    const result = await run(flags, { [Symbol.asyncIterator]() { throw new Error("must not read input"); } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

test("jq formatting and NUL output work with virtual files, pipes, and redirects", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from('{"z":"é","a":"😀"}'));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const formatted = await shell.exec("jq -aS --indent 4 . input > formatted; cat formatted");
    assert.equal(formatted.exitCode, 0, formatted.stderr);
    assert.equal(formatted.stdout, '{\n    "a": "\\ud83d\\ude00",\n    "z": "\\u00e9"\n}\n');
    const raw = await shell.exec("jq -c . input | jq --raw-output0 '.[]' > raw; cat raw");
    assert.equal(raw.exitCode, 0, raw.stderr);
    assert.deepEqual(raw.stdoutBytes, new Uint8Array(Buffer.from("é\0😀\0")));
    assert.deepEqual(await fs.readFile("/raw"), new Uint8Array(Buffer.from("é\0😀\0")));
  } finally { await shell.dispose(); }
});

test("jq raw-output0 rejects NUL without emitting the result or later results for that input", async () => {
  const result = await run(["--raw-output0", ".[]"], '["before","bad\\u0000value","skipped"]');
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "before\0");
  assert.equal(result.stderr, "jq: error (at <stdin>:0): Cannot dump a string containing NUL with --raw-output0 option\n");
});

for (const [input, output, status] of [
  ['"bad\\u0000"\n"after"\n', "after\0", 0],
  ['"bad\\u0000"\nnull\n', "null\0", 1],
] as const) test("jq raw-output0 resumes later inputs and preserves exit-status " + status, async () => {
  const result = await run(["--raw-output0", "-e", "."], chunks(input));
  assert.equal(result.exitCode, status, result.stderr);
  assert.equal(result.stdout, output);
  assert.equal(result.stderr, "jq: error (at <stdin>:1): Cannot dump a string containing NUL with --raw-output0 option\n");
});

test("jq output flags do not change tojson values or numeric precision", async () => {
  const result = await run(["-ac", "tojson,."], '{"é":12.3400,"x":9007199254740993123456789}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '"{\\"\\u00e9\\":12.3400,\\"x\\":9007199254740993123456789}"\n{"\\u00e9":12.3400,"x":9007199254740993123456789}\n');
});

test("jq ASCII escapes preserve surrogate pairs at serializer fragment boundaries", async () => {
  for (const length of [30, 31, 32, 33]) {
    const prefix = "x".repeat(length);
    const result = await run(["-a", "."], JSON.stringify(prefix + "😀é"));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '"' + prefix + '\\ud83d\\ude00\\u00e9"\n');
  }
});

test("jq formatting retains result, value, and work limits", async () => {
  const result = await run(["-naC", '"é","x"'], "", { limits: { maxResults: 1 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, '\x1b[0;32m"\\u00e9"\x1b[0m\n');
  assert.equal(result.stderr, "jq: maxResults limit exceeded\n");
  const value = await run(["-a", "."], '"é"', { limits: { maxValueBytes: 3 } });
  assert.equal(value.exitCode, 5);
  assert.equal(value.stdout, "");
  assert.equal(value.stderr, "jq: maxValueBytes limit exceeded\n");
  const work = await run(["-naC", '("é"*100)?'], "", { limits: { maxSteps: 400 } });
  assert.equal(work.exitCode, 5);
  assert.equal(work.stdout, "");
  assert.equal(work.stderr, "jq: maxSteps limit exceeded\n");
});

for (const flags of [["--unbuffered", "-Ca"], ["--unbuffered", "--raw-output0"]]) {
  test("jq " + flags.join(" ") + " writes before EOF and honors backpressure and cancellation", { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel blocked output");
    let reads = 0;
    let closed = false;
    const input = { [Symbol.asyncIterator]() { return {
      async next() {
        reads++;
        return reads === 1 ? { done: false as const, value: Buffer.from('"é"\n') } : new Promise<IteratorResult<Uint8Array>>(() => {});
      },
      async return() { closed = true; return { done: true as const, value: undefined }; },
    }; } };
    let emitted!: () => void;
    const ready = new Promise<void>(resolve => { emitted = resolve; });
    const running = run([...flags, "."], input, {}, {
      signal: controller.signal,
      stdout: { async write(bytes) {
        assert.equal(Buffer.from(bytes).toString(), flags.includes("-Ca") ? '\x1b[0;32m"\\u00e9"\x1b[0m\n' : "é\0");
        emitted();
        await new Promise<void>(() => {});
      } },
    });
    const rejected = assert.rejects(running, error => error === reason);
    await ready;
    assert.equal(reads, 1);
    controller.abort(reason);
    await rejected;
    assert.equal(closed, true);
  });
}

test("jq output formatting does not recover from sink errors", async () => {
  const reason = new Error("sink failed");
  let writes = 0;
  await assert.rejects(run(["--raw-output0", "-Ca", "."], '"first"\n"later"', {}, {
    stdout: { async write() { writes++; throw reason; } },
  }), error => error === reason);
  assert.equal(writes, 1);
});
