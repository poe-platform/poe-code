import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createStandardCommands, standardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { fixture, run } from "../helpers.js";

const cases: { name: string; args: string[]; input: string; expected: string }[] = [
  { name: "exact integers beyond binary precision", args: ["-k2,2n"], input: "z 9007199254740993\na 9007199254740992\nm -9007199254740993\n", expected: "m -9007199254740993\na 9007199254740992\nz 9007199254740993\n" },
  { name: "decimal precision and negative fractions", args: ["-s", "-k2,2n"], input: "a .0000000000000000002\nb -.0000000000000000002\nc .0000000000000000001\nd -.0000000000000000001\n", expected: "b -.0000000000000000002\nd -.0000000000000000001\nc .0000000000000000001\na .0000000000000000002\n" },
  { name: "grammar excludes plus exponent and hexadecimal", args: ["-s", "-k2,2n"], input: "a 1e9\nb +9\nc 0x10\nd -0.000\ne .5tail\nf 1.00\n", expected: "b +9\nc 0x10\nd -0.000\ne .5tail\na 1e9\nf 1.00\n" },
  { name: "default byte tie fallback", args: ["-k2,2n"], input: "z 01\na 1\nm 1.00\n", expected: "a 1\nm 1.00\nz 01\n" },
  { name: "stable equivalent records", args: ["-s", "-k2,2n"], input: "z 01\na 1\nm 1.00\n", expected: "z 01\na 1\nm 1.00\n" },
  { name: "unique keeps first equivalent record", args: ["-u", "-k2,2n"], input: "z 01\na 1\nm 1.00\nb 2\n", expected: "z 01\nb 2\n" },
  { name: "local numeric replaces global reverse", args: ["-r", "-k2,2n"], input: "a 1\nz 1\nb 2\n", expected: "z 1\na 1\nb 2\n" },
  { name: "local reverse leaves global byte tie forward", args: ["-k2,2nr"], input: "z 1\na 1\nb 2\n", expected: "b 2\na 1\nz 1\n" },
  { name: "inherited numeric reverse", args: ["-nr", "-k2,2"], input: "a 1\nz 1\nb 2\n", expected: "b 2\nz 1\na 1\n" },
  { name: "inclusive character offsets and separator", args: ["-t:", "-k2.2,2.3n"], input: "a:x20z\nb:x03z\nc:x11z\n", expected: "b:x03z\nc:x11z\na:x20z\n" },
  { name: "missing empty reversed and open-ended fields", args: ["-s", "-t:", "-k2n"], input: "a:2:9\nb:\nc\nd:-1:8\ne:1:7\n", expected: "d:-1:8\nb:\nc\ne:1:7\na:2:9\n" },
  { name: "reversed key boundary yields empty numeric keys", args: ["-s", "-t:", "-k2.3,1.1n"], input: "a:99\nb:11\n", expected: "a:99\nb:11\n" },
  { name: "effective blank and fold modes bypass", args: ["-bnf", "-k2.2,2"], input: "a  12\nb  21\n", expected: "b  21\na  12\n" },
  { name: "local flags replace global numeric", args: ["-n", "-k2,2r"], input: "a 2\nb 10\nc 1\n", expected: "a 2\nb 10\nc 1\n" },
  { name: "multiple numeric keys preserve secondary comparison", args: ["-k2,2n", "-k3,3nr"], input: "a 1 2\nb 1 10\nc 0 3\n", expected: "c 0 3\nb 1 10\na 1 2\n" },
];

for (const specimen of cases) test(`single numeric key: ${specimen.name}`, async () => {
  const result = await run("sort", specimen.args, { stdin: specimen.input });
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, specimen.expected);
});

test("single numeric key empty-entry saturation preserves stable and unique results", async () => {
  const stdin = "\n".repeat(16_390) + "x:1\nx:-1\nx:0\n";
  for (const mode of ["-s", "-u"]) {
    const result = await run("sort", [mode, "-t:", "-k2,2n"], { stdin });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, mode === "-s" ? "x:-1\n" + "\n".repeat(16_390) + "x:0\nx:1\n" : "x:-1\n\nx:1\n");
  }
});

test("single numeric key character saturation and huge suffix use valid fallback", async () => {
  const decimals = Array.from({ length: 9 }, (_, index) => `tag:0.${"1".repeat(24_000)}${index + 1}`);
  const ordered = ["tag:0", ...decimals, `tag:${"0".repeat(180_000)}2`, `tag:3${"x".repeat(180_000)}`, `tag:${"9".repeat(180_000)}`];
  const result = await run("sort", ["-s", "-t:", "-k2,2n"], { stdin: [...ordered].reverse().join("\n") });
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, ordered.join("\n") + "\n");
});

test("single numeric key does not confuse large record backing with selected numeric field", async () => {
  const prefix = "p".repeat(180_000);
  const result = await run("sort", ["-t:", "-k2,2n"], { stdin: `${prefix}:2\n${prefix}:1\n` });
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, `${prefix}:1\n${prefix}:2\n`);
});

for (const delimiter of [10, 0]) test(`single numeric key owns reused Buffer views, delimiter=${delimiter}`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = Buffer.from([255, 58, 50, delimiter, 128, 58, 49, delimiter]);
  await fs.writeFile("/input", bytes);
  const original = fs.readStream.bind(fs);
  fs.readStream = (path, options) => path !== "/input" ? original(path, options) : (async function* () {
    const backing = Buffer.alloc(19, 255);
    const view = backing.subarray(7, 9);
    for (let offset = 0; offset < bytes.length; offset += view.length) { view.set(bytes.subarray(offset, offset + view.length)); yield view; }
    backing.fill(0);
  })();
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec(`sort ${delimiter === 0 ? "-z" : ""} -t: -k2,2n -o /output /input`);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    assert.deepEqual(Buffer.from(await fs.readFile("/output")), Buffer.from([128, 58, 49, delimiter, 255, 58, 50, delimiter]));
    assert.deepEqual(Buffer.from(await fs.readFile("/input")), bytes);
  } finally { await shell.dispose(); }
});

test("single numeric key check mode preserves duplicate diagnostic", async () => {
  const result = await run("sort", ["-cu", "-k2,2n"], { stdin: "z 01\na 1\n" });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "sort: disorder at record 2\n");
});

test("single numeric key source errors preserve destination and status", async () => {
  const fs = await fixture({ kept: "unchanged" });
  const missing = await run("sort", ["-k2,2n", "-o", "kept", "missing"], { fs });
  assert.equal(missing.exitCode, 2); assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "sort: ENOENT: no such file or directory, readStream '/work/missing'\n");
  const failed = await run("sort", ["-k2,2n", "-o", "kept"], { fs, stdin: (async function* () {
    yield Buffer.from("a 2\nb 1\n"); throw new FsError("EIO", { message: "key source failed" });
  })() });
  assert.equal(failed.exitCode, 2); assert.equal(failed.stdout, ""); assert.equal(failed.stderr, "sort: EIO: key source failed\n");
  assert.equal(Buffer.from(await fs.readFile("/work/kept")).toString(), "unchanged");
});

test("single numeric key respects cancellation during backpressured output", async () => {
  const controller = new AbortController();
  let writes = 0;
  let first!: () => void;
  const started = new Promise<void>(resolve => { first = resolve; });
  const context: CommandContext = {
    command: "sort", args: ["-k2,2n"], cwd: "/work", env: {}, fs: await fixture(), signal: controller.signal,
    stdin: toByteSource("a 2\nb 1\n"), stderr: { async write() {} },
    stdout: { async write() { writes++; first(); await new Promise<void>(() => {}); } },
  };
  const sort = createStandardCommands().find(command => command.name === "sort")!;
  const pending = Promise.resolve(sort.execute(context));
  const rejection = assert.rejects(pending, /stop keyed output/);
  await started; controller.abort(new Error("stop keyed output")); await rejection;
  assert.equal(writes, 1);
});

test("single numeric key descriptors never cross invocations", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    for (const stdin of ["a 2\nb 1\n", "a 4\nb 3\n", "a 2\nb 1\n"]) {
      const result = await shell.exec("sort -k2,2n", { stdin });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdin.split("\n").filter(Boolean).reverse().join("\n") + "\n");
    }
  } finally { await shell.dispose(); }
});
