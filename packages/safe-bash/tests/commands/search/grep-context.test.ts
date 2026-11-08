import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createGrepCommands } from "../../../src/commands/search/grep.js";
import type { RegexWorkerRequest } from "../../../src/commands/regex-execution/provider.js";
import { createNodeRegexProvider } from "../../../src/node.js";
import { grepCommands } from "../../../src/commands/grep.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run } from "../grep-aliases/helpers.js";

const fixture = "zero\none\nalpha\nthree\nfour\nfive\nalpha\nseven\neight\n";
const cases = [
  { args: ["-A1"], input: "alpha\nbeta\n", expected: "alpha\nbeta\n" },
  { args: ["-n", "-B", "1"], expected: "2-one\n3:alpha\n--\n6-five\n7:alpha\n" },
  { args: ["-n", "-C1"], expected: "2-one\n3:alpha\n4-three\n--\n6-five\n7:alpha\n8-seven\n" },
  { args: ["--before-context=1", "--after-context", "1"], expected: "one\nalpha\nthree\n--\nfive\nalpha\nseven\n" },
  { args: ["--context=2", "-n"], expected: "1-zero\n2-one\n3:alpha\n4-three\n5-four\n6-five\n7:alpha\n8-seven\n9-eight\n" },
  { args: ["-A0", "-C2", "-n"], expected: "1-zero\n2-one\n3:alpha\n4-three\n5-four\n6-five\n7:alpha\n8-seven\n9-eight\n" },
  { args: ["-C2", "-A0", "-n"], expected: "1-zero\n2-one\n3:alpha\n--\n5-four\n6-five\n7:alpha\n" },
  { args: ["-C2", "-C1", "-n"], expected: "2-one\n3:alpha\n4-three\n--\n6-five\n7:alpha\n8-seven\n" },
  { args: ["-n", "-C0"], expected: "3:alpha\n7:alpha\n" },
  { args: ["-n", "-C1"], input: "alpha\nalpha\nother\nalpha", expected: "1:alpha\n2:alpha\n3-other\n4:alpha\n" },
  { args: ["-m1", "-A3", "-n"], input: "alpha\nalpha\nother\nlast\nignored\n", expected: "1:alpha\n2-alpha\n3-other\n4-last\n" },
  { args: ["-v", "-m1", "-A2", "-n"], input: "other\nother\nalpha\nignored\n", expected: "1:other\n2-other\n3-alpha\n" },
  { args: ["-c", "-C2"], expected: "2\n" },
  { args: ["-q", "-C2"], expected: "" },
  { args: ["-m0", "-C2"], expected: "", code: 1 },
  { args: ["-C2"], input: "other\n", expected: "", code: 1 },
  { args: ["-o", "-C1", "-n"], expected: "3:alpha\n--\n7:alpha\n" },
  { args: ["-o", "-v", "-C1"], expected: "" },
  { args: ["-z", "-C1", "-n"], input: "one\0alpha\0three\0four\0five\0alpha\0seven", expected: "1-one\u00002:alpha\u00003-three\u0000--\u00005-five\u00006:alpha\u00007-seven\u0000" },
];

for (const [index, entry] of cases.entries()) test(`grep context GNU case ${index + 1}: ${entry.args.join(" ")}`, async () => {
  const result = await run(grepCommands()[0]!, [...entry.args, "alpha"], entry.input ?? fixture);
  assert.equal(result.code, entry.code ?? 0);
  assert.equal(result.stdout.toString(), entry.expected);
  assert.equal(result.stderr.toString(), "");
});

test("grep context uses the VFS and separates groups across files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("before\nalpha\nafter\n"));
  await fs.writeFile("/second", Buffer.from("alpha\nlast\n"));
  const shell = new Shell({ fs });
  shell.register(grepCommands()[0]!);
  try {
    const result = await shell.exec("grep -nC1 alpha first second");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "first-1-before\nfirst:2:alpha\nfirst-3-after\n--\nsecond:1:alpha\nsecond-2-last\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("grep retains raw context bytes from reused streaming buffers", async () => {
  const chunk = Buffer.from([255, 10]);
  const source = (async function* () {
    yield chunk;
    chunk.fill(120);
    yield Buffer.from("alpha\n");
    yield Buffer.from([254, 10]);
  })();
  const result = await run(grepCommands({ regexExecutor: createNodeRegexProvider() })[0]!, ["-F", "-C1", "alpha"], source);
  assert.equal(result.code, 0);
  assert.deepEqual(result.stdout, Buffer.from([255, 10, ...Buffer.from("alpha\n"), 254, 10]));
  assert.equal(result.stderr.length, 0);
});

for (const length of ["-1", "1.5", "bad", "9007199254740992"]) test(`grep rejects invalid context length ${length}`, async () => {
  const result = await run(grepCommands()[0]!, ["-C", length, "alpha"], fixture);
  assert.equal(result.code, 2);
  assert.ok(result.stderr.toString().includes("invalid context length argument"));
});

test("grep max-count closes stdin after its trailing context", async () => {
  let closed = false;
  const source = (async function* () {
    try {
      yield Buffer.from("alpha\n");
      yield Buffer.from("after\n");
      assert.fail("must not consume beyond trailing context");
    } finally { closed = true; }
  })();
  const result = await run(grepCommands()[0]!, ["-m1", "-A1", "alpha"], source);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "alpha\nafter\n");
  assert.equal(closed, true);
});

test("grep bounds retained before-context bytes and closes input on overflow", async () => {
  let closed = false;
  const chunk = Buffer.alloc(65536, 120);
  chunk[chunk.length - 1] = 10;
  const source = (async function* () {
    try { for (let index = 0; index < 513; index++) yield chunk; }
    finally { closed = true; }
  })();
  const executor = new RegexExecutor({ createWorker() {
    const worker = new EventEmitter();
    queueMicrotask(() => worker.emit("message", { ready: true }));
    return Object.assign(worker, {
      postMessage(request: RegexWorkerRequest) {
        queueMicrotask(() => worker.emit("message", { id: request.id, results: request.rows.map(() => new Float64Array()) }));
      },
      async terminate() {},
    });
  } });
  const result = await run(createGrepCommands(executor, { maxContextBytes: 1024 * 1024 })[0]!, ["-F", "-B1000", "alpha"], source);
  await executor.dispose();
  assert.equal(result.code, 2);
  assert.equal(result.stdout.length, 0);
  assert.ok(result.stderr.toString().includes("context byte limit exceeded"));
  assert.equal(closed, true);
});

for (const args of [["-A3", "-C0"], ["-B3", "-C0"], ["-A0"], ["-B0"]]) test(`grep zero context ${args.join(" ")}`, async () => {
  const result = await run(grepCommands()[0]!, [...args, "alpha"], fixture);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "alpha\nalpha\n");
});

for (const args of [["foo\n"], ["-e", "foo\n"], ["-F", "foo\n"]]) test(`grep preserves trailing empty argument pattern ${JSON.stringify(args)}`, async () => {
  const result = await run(grepCommands()[0]!, args, "bar\nfoo\n");
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "bar\nfoo\n");
});

test("grep include whitelist survives following exclusions", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  for (const name of ["app.ts", "app.test.ts", "README.md"]) await fs.writeFile("/dir/" + name, Buffer.from("match\n"));
  const result = await run(grepCommands()[0]!, ["-r", "--include=*.ts", "--exclude=*.test.ts", "match", "/dir"], "", { fs });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "/dir/app.ts:match\n");
});
