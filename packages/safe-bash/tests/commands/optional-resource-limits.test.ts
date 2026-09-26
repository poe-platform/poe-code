import assert from "node:assert/strict";
import test from "node:test";
import { settings as timeEnvSettings, type TimeEnvCommandsOptions } from "../../src/commands/time-env/shared.js";
import { settings as metadataSettings, type MetadataCommandsOptions } from "../../src/commands/metadata/internal.js";
import { settings as getoptSettings } from "../../src/commands/getopt/internal.js";
import { settings as factorSettings } from "../../src/commands/factor/internal.js";
import { settings as tsortSettings } from "../../src/commands/tsort/internal.js";
import { settings as columnSettings } from "../../src/commands/column/options.js";
import { settings as prSettings } from "../../src/commands/pr/internal.js";
import { settings as tableSettings } from "../../src/commands/table-text/internal.js";
import { settings as streamSettings } from "../../src/commands/stream-format/shared.js";
import { settings as whichSettings } from "../../src/commands/which/options.js";
import { settings as archiveSettings } from "../../src/commands/archive/internal.js";
import { settings as hexdumpSettings } from "../../src/commands/hexdump/internal.js";
import { limitsFor } from "../../src/commands/network/shared.js";
import { settings as shufSettings } from "../../src/commands/shuf/options.js";
import { settings as exprSettings } from "../../src/commands/expr/internal.js";
import { settings as lineEndingSettings } from "../../src/commands/line-endings/internal.js";
import { settings as iconvSettings } from "../../src/commands/iconv/internal.js";
import { settings as splitSettings } from "../../src/commands/split/options.js";
import { settings as patchSettings } from "../../src/commands/apply-patch/options.js";
import { settings as csplitSettings } from "../../src/commands/csplit/internal.js";
import { limitsFor as cmpSettings } from "../../src/commands/cmp/options.js";
import { createTimeEnvCommands } from "../../src/commands/time-env/index.js";
import { createMetadataCommands } from "../../src/commands/metadata/index.js";
import { createGetoptCommand } from "../../src/commands/getopt/index.js";
import { createFactorCommand } from "../../src/commands/factor/index.js";
import { createTsortCommand } from "../../src/commands/tsort/index.js";
import { createColumnCommand } from "../../src/commands/column/index.js";
import { createPrCommand } from "../../src/commands/pr/index.js";
import { createTableTextCommands } from "../../src/commands/table-text/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { createDos2unixCommand } from "../../src/commands/line-endings/index.js";
import { createWhichCommand } from "../../src/commands/which/index.js";
import { createSplitCommands } from "../../src/commands/split/index.js";
import { createCmpCommand } from "../../src/commands/cmp/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandContext, type CommandDefinition } from "../../src/contracts/index.js";

const families = [
  ["time-env", (options: TimeEnvCommandsOptions) => timeEnvSettings(options).limits],
  ["metadata", (options: MetadataCommandsOptions) => metadataSettings(options).limits],
  ["getopt", getoptSettings], ["factor", factorSettings], ["tsort", tsortSettings],
  ["column", columnSettings], ["pr", prSettings], ["table-text", tableSettings],
  ["stream-format", streamSettings], ["which", whichSettings], ["archive", archiveSettings],
  ["hexdump", hexdumpSettings], ["expr", exprSettings], ["line-endings", lineEndingSettings],
  ["iconv", iconvSettings], ["split", splitSettings], ["apply-patch", patchSettings], ["csplit", csplitSettings], ["cmp", cmpSettings],
] as const;

for (const [family, settings] of families) {
  test(`${family}: resource limits default to Infinity and finite overrides are independent`, () => {
    const defaults = settings({});
    for (const [key, value] of Object.entries(defaults)) {
      // These control stream batching, not how much input a command accepts.
      if (key === "chunkSize" || family === "split" && key === "maxChunkBytes") continue;
      assert.equal(value, Infinity, key);
      assert.deepEqual(settings({ limits: { [key]: 64 } }), { ...defaults, [key]: 64 });
    }
  });

  test(`${family}: every limit accepts explicit Infinity and rejects invalid values`, () => {
    const unlimited = Object.fromEntries(Object.keys(settings({})).map(key => [key, Infinity]));
    assert.deepEqual(settings({ limits: unlimited }), family === "archive" ? { ...unlimited, chunkSize: 65_536 } : unlimited);
    for (const key of Object.keys(unlimited)) {
      for (const value of [-1, -Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => settings({ limits: { [key]: value } }), RangeError, key);
      }
    }
  });
}

test("network and shuf accept explicit Infinity in their public limit configuration", () => {
  const limits = Object.fromEntries(Object.keys(limitsFor()).map(key => [key, Infinity]));
  assert.deepEqual(limitsFor(limits), limits);
  assert.deepEqual(shufSettings({ maxInputBytes: Infinity, maxSampleSize: Infinity }), {
    maxInputBytes: Infinity, maxSampleSize: Infinity,
  });
});

async function run(command: CommandDefinition, args: readonly string[], input = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await command.execute({
    command: command.name, args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

test("date formats past the former width cap, while an explicit width cap is enforced", async () => {
  const create = (limits = {}) => createTimeEnvCommands({ limits }).find(command => command.name === "date")!;
  const args = ["-d@0", "+%5000Y"];
  assert.deepEqual(await run(create(), args), { exitCode: 0, stdout: "1970".padStart(5000, "0") + "\n", stderr: "" });
  await assert.rejects(run(create({ maxFormatWidth: 4096 }), args), { code: "EFBIG" });
});

test("getopt accepts more than 4096 arguments unless a count cap is configured", async () => {
  const args = ["-o", "", "--", ...Array<string>(4097).fill("x")];
  assert.deepEqual(await run(createGetoptCommand(), args), { exitCode: 0, stdout: " --" + " 'x'".repeat(4097) + "\n", stderr: "" });
  assert.notEqual((await run(createGetoptCommand({ limits: { maxArguments: 4096 } }), args)).exitCode, 0);
});

test("metadata traverses past the former depth cap with optional depth enforcement", async () => {
  const fs = new MemoryFileSystem();
  const path = "/d".repeat(130);
  await fs.mkdir(path, { recursive: true });
  const create = (limits = {}) => createMetadataCommands({ limits }).find(command => command.name === "chmod")!;
  const result = await run(create(), ["-R", "700", "/d"], "", { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat(path)).mode & 0o777, 0o700);
  assert.notEqual((await run(create({ maxDepth: 128 }), ["-R", "755", "/d"], "", { fs })).exitCode, 0);
});

test("tsort accepts more than 4096 empty chunks unless an input cap is configured", async () => {
  const stdin = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 4097; index++) yield new Uint8Array();
    yield Buffer.from("a b");
  } };
  assert.deepEqual(await run(createTsortCommand(), [], "", { stdin }), { exitCode: 0, stdout: "a\nb\n", stderr: "" });
  assert.notEqual((await run(createTsortCommand({ limits: { maxEmptyChunks: 4096 } }), [], "", { stdin })).exitCode, 0);
});

test("tsort reads from filesystems without streaming without passing an infinite read bound", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a b"));
  const readFile = fs.readFile.bind(fs);
  Object.defineProperty(fs, "readStream", { value: undefined });
  Object.defineProperty(fs, "readFile", { value: (...args: Parameters<typeof readFile>) => {
    assert.equal(args[1]?.maxBytes, undefined);
    return readFile(...args);
  } });
  assert.deepEqual(await run(createTsortCommand(), ["/input"], "", { fs }), { exitCode: 0, stdout: "a\nb\n", stderr: "" });
  assert.notEqual((await run(createTsortCommand({ limits: { maxInputBytes: 2 } }), ["/input"], "", { fs })).exitCode, 0);
});

test("column accepts more than 1000 fields and pr accepts more than 256 columns", async () => {
  const row = Array<string>(1001).fill("x").join(" ") + "\n";
  assert.deepEqual(await run(createColumnCommand(), ["-t"], row), { exitCode: 0, stdout: Array<string>(1001).fill("x").join("  ") + "\n", stderr: "" });
  assert.notEqual((await run(createColumnCommand({ limits: { maxFields: 1000 } }), ["-t"], row)).exitCode, 0);
  const args = ["-t", "-257", "-w1024", "-s,"];
  assert.deepEqual(await run(createPrCommand(), args, "x\n"), { exitCode: 0, stdout: "x\n", stderr: "" });
  assert.notEqual((await run(createPrCommand({ limits: { maxColumns: 256 } }), args, "x\n")).exitCode, 0);
});

test("join accepts groups beyond 4096 records with optional group limits", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a x\n".repeat(4097)));
  await fs.writeFile("/right", Buffer.from("a y\n"));
  const create = (limits = {}) => createTableTextCommands({ limits }).find(command => command.name === "join")!;
  assert.deepEqual(await run(create(), ["/left", "/right"], "", { fs }), { exitCode: 0, stdout: "a x y\n".repeat(4097), stderr: "" });
  assert.notEqual((await run(create({ maxGroupRecords: 4096 }), ["/left", "/right"], "", { fs })).exitCode, 0);
});

test("seq accepts more than 1024 decimal digits with optional numeric limits", async () => {
  const value = "1" + "0".repeat(1024);
  const create = (limits = {}) => createStreamFormatCommands({ limits }).find(command => command.name === "seq")!;
  assert.deepEqual(await run(create(), [value, value]), { exitCode: 0, stdout: value + "\n", stderr: "" });
  assert.notEqual((await run(create({ maxNumericDigits: 1024 }), [value, value])).exitCode, 0);
});

test("which accepts PATH beyond the former byte cap and enforces an explicit cap", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", new Uint8Array(), { mode: 0o755 });
  const env = { PATH: "/bin:" + "/x".repeat(32_768) };
  assert.deepEqual(await run(createWhichCommand(), ["tool"], "", { fs, env }), { exitCode: 0, stdout: "/bin/tool\n", stderr: "" });
  assert.notEqual((await run(createWhichCommand({ limits: { maxPathEnvBytes: 65_536 } }), ["tool"], "", { fs, env })).exitCode, 0);
});

test("line-ending conversion accepts an unlimited chunk size on streams and VFS files", async () => {
  const command = createDos2unixCommand({ limits: { chunkSize: Infinity, maxBufferedBytes: Infinity } });
  assert.deepEqual(await run(command, [], "a\r\nb\r\n"), { exitCode: 0, stdout: "a\nb\n", stderr: "" });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a\r\n"));
  const result = await run(command, ["-q", "/input"], "", { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a\n");
});

test("split accepts an unlimited chunk size for VFS input", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a\nb\n"));
  const command = createSplitCommands({ limits: { maxChunkBytes: Infinity } })[0]!;
  const result = await run(command, ["-l", "1", "/input"], "", { fs });
  assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "a\n");
  assert.equal(Buffer.from(await fs.readFile("/xab")).toString(), "b\n");
});

test("cmp accepts explicit Infinity for streaming and buffered file comparison", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("same"));
  await fs.writeFile("/right", Buffer.from("same"));
  const command = createCmpCommand({ limits: { maxChunkBytes: Infinity, maxFallbackBytes: Infinity } });
  assert.deepEqual(await run(command, ["/left", "/right"], "", { fs }), { exitCode: 0, stdout: "", stderr: "" });
  Object.defineProperty(fs, "readStream", { value: undefined });
  assert.deepEqual(await run(command, ["/left", "/right"], "", { fs }), { exitCode: 0, stdout: "", stderr: "" });
});

test("factor supports exact integers beyond uint32 and Number.MAX_SAFE_INTEGER", async () => {
  const args = ["--exponents", "4294967296", "9007199254740991", "9007199254740993", (2n ** 128n).toString()];
  assert.deepEqual(await run(createFactorCommand(), args), {
    exitCode: 0, stdout: "4294967296: 2^32\n9007199254740991: 6361 69431 20394401\n9007199254740993: 3 107 28059810762433\n" + `${2n ** 128n}: 2^128\n`, stderr: "",
  });
});

test("factor accepts safe integer and bigint magnitude limits without rounding", async () => {
  for (const maxValue of [Number.MAX_SAFE_INTEGER, 9007199254740993n, Infinity]) {
    const result = await run(createFactorCommand({ limits: { maxValue } }), ["--exponents", "9007199254740992"]);
    if (maxValue === Number.MAX_SAFE_INTEGER) {
      assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: "factor: '9007199254740992' exceeds supported maximum 9007199254740991\n" });
    } else assert.deepEqual(result, { exitCode: 0, stdout: "9007199254740992: 2^53\n", stderr: "" });
  }
  assert.deepEqual(await run(createFactorCommand({ limits: { maxValue: 9007199254740992n } }), ["9007199254740993", "12"]), {
    exitCode: 1, stdout: "12: 2 2 3\n", stderr: "factor: '9007199254740993' exceeds supported maximum 9007199254740992\n",
  });
});

test("factor publishes complete records larger than its ordinary output batch", async () => {
  const value = 2n ** 600n;
  const expected = `${value}:` + " 2".repeat(600) + "\n";
  assert.deepEqual(await run(createFactorCommand(), ["12", String(value), "18"]), {
    exitCode: 0, stdout: "12: 2 2 3\n" + expected + "18: 2 3 3\n", stderr: "",
  });
  assert.notEqual((await run(createFactorCommand({ limits: { maxOutputBytes: 1024 } }), [String(value)])).exitCode, 0);
});
