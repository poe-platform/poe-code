import assert from "node:assert/strict";
import { test } from "node:test";
import { commandRuntimeIdentity, createCommandArguments, toByteSource, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { createYqCommand, createYqCommands, yqCommands } from "../../../src/commands/yq/index.js";
import { Budget, JqLimitError } from "../../../src/commands/structured/limits.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run } from "./helpers.js";

const flowCases = [
  { input: "[\n  1, # comment\n  2\n]", value: [1, 2] },
  { input: "[\n  1, # [\n  2\n]", value: [1, 2] },
  { input: "[ # ] } '\" ignored\n  1,\n  # [ another\n  2 # final\n]", value: [1, 2] },
  { input: "{a: 1, # }\n b: [2, # [\n 3]}", value: { a: 1, b: [2, 3] } },
  { input: "[\"# quoted\", 'it''s # quoted', abc#plain]", value: ["# quoted", "it's # quoted", "abc#plain"] },
  { input: "[\"first\n# quoted continuation\", 2]", value: ["first # quoted continuation", 2] },
  { input: `[1, # ${"[".repeat(300)}\n 2]`, value: [1, 2] },
  { input: "[1,# comment\n2]", value: [1, 2] },
  { input: "[# comment\n1]", value: [1] },
  { input: '["a"# comment\n]', value: ["a"] },
] as const;

for (const [index, entry] of flowCases.entries()) test(`canonical flow comment case ${index + 1}`, async () => {
  assert.deepEqual(await run(["-o", "json", "-c", "."], entry.input), {
    status: 0, stdout: `${JSON.stringify(entry.value)}\n`, stderr: "",
  });
});

for (const input of ["[foo # comment\nbar]", "[foo\n# comment\nbar]"]) test(`comments terminate plain scalars: ${JSON.stringify(input)}`, async () => {
  const result = await run(["-o", "json", "-c", "."], input);
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /INPUT_YAML_SYNTAX/u);
});

for (const streaming of [true, false]) test(`symlink/.. traversal belongs to VFS (stream=${streaming})`, async () => {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/a", { recursive: true });
  await memory.mkdir("/b/child", { recursive: true });
  await memory.symlink!("/b/child", "/a/link");
  await memory.writeFile("/a/data.yaml", Buffer.from("label: wrong\n"));
  await memory.writeFile("/b/data.yaml", Buffer.from("label: right\n"));
  const fallback: FileSystem = new Proxy(memory, {
    get(target, property) {
      if (property === "readStream") return undefined;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  for (const operand of ["link/../data.yaml", "/a/link/../data.yaml"]) {
    assert.deepEqual(await run(["-o", "json", ".label", operand], "", { cwd: "/a", fs: streaming ? memory : fallback }), {
      status: 0, stdout: '"right"\n', stderr: "",
    });
  }
});

test("invalid raw filename is rejected before any replacement-name access", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/�", Buffer.from("label: replacement-file\n"));
  let accessed = false;
  const readFile = fs.readFile.bind(fs);
  const readStream = fs.readStream.bind(fs);
  context.mock.method(fs, "readStream", (...args: Parameters<typeof readStream>) => { accessed = true; return readStream(...args); });
  context.mock.method(fs, "readFile", (...args: Parameters<typeof readFile>) => { accessed = true; return readFile(...args); });
  const argumentValues = createCommandArguments(["-o", "json", ".label", shellValueFromBytes(Uint8Array.of(255))]);
  const result = await run(argumentValues.args, "", { argumentValues, fs });
  assert.deepEqual(result, { status: 2, stdout: "", stderr: "yq: cli: CLI_INVALID_UNICODE\n" });
  assert.equal(accessed, false);
});

for (const filename of ["�", "\ufeffdata.yaml", "café.yaml"]) test(`valid raw pathname retains identity: ${JSON.stringify(filename)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile(`/${filename}`, Buffer.from("label: right\n"));
  const argumentValues = createCommandArguments(["-o", "json", ".label", shellValueFromBytes(Buffer.from(filename))]);
  assert.deepEqual(await run(argumentValues.args, "", { fs, argumentValues }), { status: 0, stdout: '"right"\n', stderr: "" });
});

test("empty chunks charge cooperative work rather than growing retained chunk storage", async () => {
  const controller = new AbortController();
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
  const stdin = (async function* () { for (let index = 0; index < 4096; index++) yield new Uint8Array(); })();
  assert.deepEqual(await run(["."], "", { stdin, signal: controller.signal }), { status: 0, stdout: "", stderr: "" });
  assert.ok(checkpoints > 0, "zero-byte chunks must consume work and yield");
});

for (const vfs of [false, true]) test(`empty producer allows timer cancellation and is returned (vfs=${vfs})`, async context => {
  const controller = new AbortController();
  const reason = new Error("timer cancellation");
  let produced = 0;
  let closed = false;
  const source: ByteSource = (async function* () {
    try { for (; produced < 4096; produced++) yield new Uint8Array(); }
    finally { closed = true; }
  })();
  const fs = createMemoryFileSystem();
  context.mock.method(fs, "readStream", () => source);
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(run(vfs ? [".", "/data.yaml"] : ["."], "", {
      signal: controller.signal,
      ...(vfs ? { fs } : { stdin: source }),
    }), error => error === reason);
    assert.ok(produced < 4096);
    assert.equal(closed, true);
  } finally { clearTimeout(timer); }
});

test("factories carry the command runtime identity", () => {
  assert.equal(createYqCommand().runtimeIdentity, commandRuntimeIdentity);
  assert.equal(createYqCommands()[0]!.runtimeIdentity, commandRuntimeIdentity);
});

test("empty chunk work refusal stops consumption and returns the producer", async context => {
  let produced = 0;
  let closed = false;
  let admitted = 0;
  const step = Budget.prototype.step;
  context.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) {
    if (produced > 0) {
      admitted += count;
      if (admitted > 3) throw new JqLimitError("maxSteps");
    }
    return step.call(this, count);
  });
  const stdin = (async function* () {
    try { while (produced < 20) { produced++; yield new Uint8Array(); } }
    finally { closed = true; }
  })();
  assert.deepEqual(await run(["."], "", { stdin }), { status: 5, stdout: "", stderr: "yq: limit: LIMIT_MAX_STEPS\n" });
  assert.equal(produced, 4);
  assert.equal(closed, true);
});

test("empty fragments and reused buffers preserve input byte ownership", async () => {
  const buffer = Buffer.from("[1,");
  const stdin = (async function* () {
    yield buffer;
    yield new Uint8Array();
    buffer.set(Buffer.from("2]\n"));
    yield buffer;
    buffer.fill(0);
  })();
  assert.deepEqual(await run(["-o", "json", "-c", "."], "", { stdin }), { status: 0, stdout: "[1,2]\n", stderr: "" });
});

test("opt-in Shell invocation uses the owned byte carrier and corrected parser", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data.yaml", Buffer.from("[1, # comment\n 2]"));
  await fs.writeFile("/�", Buffer.from("replacement-file"));
  const shell = new Shell({ fs }).use(yqCommands());
  try {
    const result = await shell.exec("yq -o json -c . /data.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "[1,2]\n");
    assert.equal(result.stderr, "");
    const invalid = await shell.exec("yq -o json . $'\\xff'");
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr, "yq: cli: CLI_INVALID_UNICODE\n");
  } finally { await shell.dispose(); }
});

test("relative operands do not introduce a new double-leading-slash namespace", async context => {
  for (const [cwd, expected] of [["/", "/data.yaml"], ["/a/", "/a/data.yaml"], ["/a", "/a/data.yaml"]]) {
    const fs = createMemoryFileSystem();
    context.mock.method(fs, "readStream", (pathname: string) => {
      assert.equal(pathname, expected);
      return toByteSource("1");
    });
    assert.equal((await run([".", "data.yaml"], "", { fs, cwd: cwd! })).status, 0);
  }
});
