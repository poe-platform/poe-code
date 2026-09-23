import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands } from "../../../src/core.js";
import { type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { chunks, run } from "./helpers.js";

const unreadable: ByteSource = { [Symbol.asyncIterator]() { throw new Error("must not acquire stdin"); } };

// Successful bytes checked against jq-1.7 with LC_ALL=C and synthetic files.
for (const [option, input, expected] of [
  ["--rawfile", "a\r\nb", '"a\\r\\nb"\n'],
  ["--rawfile", "", '""\n'],
  ["--rawfile", "a\0b", '"a\\u0000b"\n'],
  ["--rawfile", Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xff, 0x0d, 0x0a, 0x62]), '"\ufeffa�\\r\\nb"\n'],
  ["--slurpfile", '"é"\n1 {"x":true}', '["é",1,{"x":true}]\n'],
  ["--slurpfile", "", '[]\n'],
  ["--slurpfile", " \r\n\t", '[]\n'],
  ["--slurpfile", '9007199254740993123456789 -2.50', '[9007199254740993123456789,-2.50]\n'],
] as const) test(`jq ${option} loads ${JSON.stringify(input)} across UTF-8 chunk boundaries`, async () => {
  const fs = new MemoryFileSystem();
  fs.readStream = path => { assert.equal(path, "/work/data"); return chunks(input); };
  const result = await run([option, "x", "data", "-nc", "$x"], unreadable, {}, { fs, cwd: "/work" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
});

test("jq file bindings work through Shell with virtual paths, filters, stdin and redirects", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, text] of [["raw", "a\r\nb"], ["input", '"é"'], ["-", "dash"], ["filter", "[$x,$y,.]"]] as const) {
    await fs.writeFile(`/work/${name}`, Buffer.from(text));
  }
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const [command, expected] of [
      ["jq --rawfile x raw -n '$x'", '"a\\r\\nb"\n'],
      ["jq --slurpfile x input -n '$x'", '[\n  "é"\n]\n'],
      ["jq --rawfile x - -nc '$x'", '"dash"\n'],
      ["printf 7 | jq --rawfile x raw --slurpfile y input -c -f filter > result; cat result", '["a\\r\\nb",["é"],7]\n'],
      ["jq --rawfile x raw -c '[$x,.]' input", '["a\\r\\nb","é"]\n'],
    ] as const) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("jq file bindings populate ARGS.named and retain the first binding without opening duplicates", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/raw", Buffer.from("text"));
  await fs.writeFile("/json", Buffer.from("1 true"));
  const result = await run(["-nc", "--rawfile", "x", "raw", "--arg", "x", "later", "--slurpfile", "y", "json",
    "--rawfile", "x", "missing", "--slurpfile", "y", "missing", "--rawfile", "ARGS", "raw", "$ARGS"], unreadable, {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '{"positional":[],"named":{"x":"text","y":[1,true],"ARGS":"text"}}\n');
  for (const option of ["--rawfile", "--slurpfile"]) {
    const duplicate = await run(["--argjson", "x", "2", option, "x", "missing", "-nc", "$x"], unreadable, {}, { fs });
    assert.equal(duplicate.exitCode, 0, duplicate.stderr);
    assert.equal(duplicate.stdout, "2\n");
  }
});

for (const flags of [["-Rsc"], ["--stream", "-c"], ["--stream-errors", "-c"], ["--seq", "-c"]]) {
  test(`jq slurpfile parses ordinary JSON independently of ${flags.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/json", Buffer.from('1 {"x":true}'));
    const result = await run([...flags, "--slurpfile", "x", "json", "-n", "$x"], unreadable, {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${flags.includes("--seq") ? "\x1e" : ""}[1,{"x":true}]\n`);
  });
}

for (const option of ["--rawfile", "--slurpfile"]) {
  test(`jq ${option} rejects missing operands and files before evaluating or acquiring input`, async () => {
    for (const args of [[option], [option, "x"], [option, "x", "missing", "-n", "0"]]) {
      const result = await run(args, unreadable);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
      assert.ok(!result.stderr.includes("unsupported option"), result.stderr);
    }
  });

  test(`jq ${option} respects per-path streaming capabilities and bounded readFile fallback`, async () => {
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/data", Buffer.from("1"));
    const signal = new AbortController().signal;
    const observed: number[] = [];
    fs.capabilitiesFor = async (path, options) => {
      assert.equal(path, "/data"); assert.equal(options?.signal, signal);
      return { ...fs.capabilities, streamingRead: false };
    };
    fs.readStream = () => { throw new Error("streaming disabled for path"); };
    const original = fs.readFile.bind(fs);
    fs.readFile = async (path, options) => {
      assert.equal(options?.signal, signal); observed.push(options!.maxBytes!);
      return original(path, options);
    };
    const result = await run([option, "x", "data", option, "y", "data", "-nc", "[$x,$y]"], unreadable,
      { limits: { maxInputBytes: 64 } }, { fs, signal });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, option === "--rawfile" ? '["1","1"]\n' : '[[1],[1]]\n');
    assert.deepEqual(observed, [64, 63]);
  });

  test(`jq ${option} charges file and stdin bytes to the same input budget`, async () => {
    const fs = new MemoryFileSystem();
    fs.readStream = () => chunks("1" + " ".repeat(23));
    const args = [option, "x", "data", "-c", "."];
    const accepted = await run(args, '"123456"', { limits: { maxInputBytes: 32 } }, { fs });
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    const rejected = await run(args, '"1234567"', { limits: { maxInputBytes: 32 } }, { fs });
    assert.equal(rejected.exitCode, 5);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /maxInputBytes/);
  });

  test(`jq ${option} closes streamed files and preserves abort reasons`, async () => {
    const fs = new MemoryFileSystem();
    const controller = new AbortController();
    const reason = new Error("stop file binding");
    let closed = false;
    fs.readStream = (_path, options) => {
      assert.equal(options?.signal, controller.signal);
      return (async function* () {
        try { yield Buffer.from("1"); controller.abort(reason); yield Buffer.from("2"); }
        finally { closed = true; }
      })();
    };
    await assert.rejects(run([option, "x", "data", "-nc", "0"], unreadable, {}, { fs, signal: controller.signal }), error => error === reason);
    assert.equal(closed, true);
  });

  test(`jq ${option} owns reused chunk bytes before producer advancement and finalization`, async () => {
    const fs = new MemoryFileSystem();
    const backing = Buffer.from('x"é"y');
    fs.readStream = () => (async function* () {
      try {
        yield backing.subarray(1, 3);
        backing.set(Buffer.from('é"'), 1);
        yield backing.subarray(2, 4);
      } finally { backing.fill(0); }
    })();
    const result = await run([option, "x", "data", "-nc", "$x"], unreadable, {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, option === "--rawfile" ? '"\\"é\\""\n' : '["é"]\n');
  });
}

test("jq slurpfile rejects malformed JSON even when unused or stream error recovery is requested", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/bad", Buffer.from("1 {"));
  for (const mode of ["--stream-errors", "--seq"]) {
    const result = await run([mode, "--slurpfile", "x", "bad", "-nc", "0"], unreadable, {}, { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Bad JSON in --slurpfile x bad:/);
  }
});

test("jq file bindings share aggregate variable bytes with literal bindings", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data", Buffer.from("cd"));
  const args = ["--arg", "x", "ab", "--rawfile", "y", "data", "-nc", "0"];
  const accepted = await run(args, unreadable, { limits: { maxValueBytes: 10 } }, { fs });
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  const rejected = await run(args, unreadable, { limits: { maxValueBytes: 9 } }, { fs });
  assert.equal(rejected.exitCode, 5);
  assert.match(rejected.stderr, /maxValueBytes/);
});

for (const [option, text, limits, expected] of [
  ["--rawfile", "1".repeat(40), { maxInputBytes: 32 }, "maxInputBytes"],
  ["--slurpfile", "1" + " ".repeat(40), { maxInputBytes: 32 }, "maxInputBytes"],
  ["--rawfile", "\n".repeat(10), { maxValueBytes: 16 }, "maxValueBytes"],
  ["--slurpfile", "1 ".repeat(7), { maxCollectionSize: 6 }, "maxCollectionSize"],
  ["--slurpfile", "[1]", { maxDepth: 1 }, "maxDepth"],
  ["--slurpfile", "1 ".repeat(10), { maxValueBytes: 16 }, "maxValueBytes"],
] as const) test(`jq unused ${option} retains ${expected}`, async () => {
  const fs = new MemoryFileSystem();
  let closed = false;
  fs.readStream = () => (async function* () { try { yield* chunks(text); } finally { closed = true; } })();
  const result = await run([option, "x", "data", "-nc", "0"], unreadable, { limits }, { fs });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(expected), result.stderr);
  assert.equal(closed, true);
});
