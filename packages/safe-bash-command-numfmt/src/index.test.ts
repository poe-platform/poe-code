import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createNumfmtCommand, createNumfmtCommands, numfmtCommands, settings, numfmtCommand } from "./index.js";

test("numfmt formats numbers to iec and si", async () => {
  assert.equal(createNumfmtCommands().length, 1);
  assert.equal(numfmtCommands().name, "numfmt-commands");
  const cmd = createNumfmtCommand();
  const out = createBytePipe();
  const res = await cmd.execute({
    command: "numfmt",
    args: createCommandArguments(["--to=iec", "1048576"]).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: out.writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  await out.close();
  assert.equal(res.exitCode, 0);
  const chunks: Uint8Array[] = [];
  for await (const c of out.readable) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "1.0M\n");
});

test("numfmt scales zero with --to=iec, --to=si, and --to=iec-i without (error)", async () => {
  const cmd = createNumfmtCommand();
  for (const [scale, expected] of [
    ["iec", "0\n"],
    ["si", "0\n"],
    ["iec-i", "0\n"],
  ] as const) {
    const out = createBytePipe();
    const res = await cmd.execute({
      command: "numfmt",
      args: createCommandArguments([`--to=${scale}`, "0", "1024"]).args,
      cwd: "/",
      env: {},
      fs: createMemoryFileSystem(),
      stdin: createBytePipe().readable,
      stdout: out.writable,
      stderr: createBytePipe().writable,
      signal: new AbortController().signal,
    });
    await out.close();
    assert.equal(res.exitCode, 0);
    const chunks: Uint8Array[] = [];
    for await (const c of out.readable) chunks.push(c);
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
    assert.equal(lines[0], expected.trim());
    assert.ok(!lines[0].includes("error"));
  }
});


test("numfmt admits input chunks larger than the former 32 MiB ceiling", async () => {
  const input = new Uint8Array(32 * 1024 * 1024 + 1);
  input.set(new TextEncoder().encode("1\n"));
  const stop = new Error("stop after verifying the first output");
  const errors: Uint8Array[] = [];
  await assert.rejects(async () => createNumfmtCommand().execute({
    command: "numfmt", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield input; } },
    stdout: { write: async chunk => {
      assert.equal(new TextDecoder().decode(chunk), "1\n");
      throw stop;
    } },
    stderr: { write: async chunk => { errors.push(chunk); } },
    signal: new AbortController().signal,
  }), error => error === stop);
  assert.equal(Buffer.concat(errors).toString(), "");
});

async function runNumfmt(args: string[], options: Parameters<typeof createNumfmtCommand>[0] = {}, chunks: Uint8Array[] = []) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createNumfmtCommand(options).execute({
    command: "numfmt", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield* chunks; } },
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
    stderr: { async write(chunk) { errors.push(chunk.slice()); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
}

test("numfmt defaults admit records, arguments, field ranges and empty chunks beyond former bounds", async () => {
  const header = "x".repeat(1024 * 1024 + 1);
  const record = await runNumfmt(["--header"], {}, [Buffer.from(header.slice(0, 100)), Buffer.from(header.slice(100) + "\n1\n")]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.stdout, header + "\n1\n");
  assert.equal((await runNumfmt(Array(4097).fill("1"))).exitCode, 0);
  assert.equal((await runNumfmt(["--suffix=" + "x".repeat(65537), "1"])).exitCode, 0);
  assert.equal((await runNumfmt(["--field=" + Array(4097).fill("1").join(","), "1"])).exitCode, 0);
  assert.equal((await runNumfmt([], {}, [...Array.from({ length: 4097 }, () => new Uint8Array()), Buffer.from("1\n")])).exitCode, 0);
});

test("numfmt enforces explicitly configured resource limits", async () => {
  const cases = [
    ["maxRecordBytes", 2, [], [Buffer.from("123\n")], "line buffer limit"],
    ["maxArguments", 1, ["1", "2"], [], "argument limit"],
    ["maxArgumentBytes", 1, ["é"], [], "argument limit"],
    ["maxFieldRanges", 1, ["--field=1,2", "1"], [], "field range limit"],
    ["maxEmptyChunks", 1, [], [new Uint8Array(), new Uint8Array()], "empty input chunk limit"],
    ["maxWork", 1, [], [Buffer.from("1\n")], "work limit"],
    ["maxSingleChunkBytes", 1, [], [Buffer.from("1\n")], "input limit"],
    ["maxInputBytes", 3, [], [Buffer.from("1\n"), Buffer.from("2\n")], "input limit"],
    ["maxOutputBytes", 100, ["--padding=200", "1"], [], "output limit"],
  ] as const;
  for (const [name, bound, args, chunks, diagnostic] of cases) {
    const result = await runNumfmt([...args], { limits: { [name]: bound } }, [...chunks]);
    assert.equal(result.exitCode, 1, name);
    assert.ok(result.stderr.includes(diagnostic), `${name}: ${result.stderr}`);
  }
  assert.equal((await runNumfmt([], { maxRecordBytes: 1 }, [Buffer.from("12\n")])).exitCode, 1);
  assert.equal((await runNumfmt([], { maxRecordBytes: 1, limits: { maxRecordBytes: Infinity } }, [Buffer.from("12\n")])).exitCode, 0);
});


test("numfmt validates every limit and defaults every resource budget to Infinity", () => {
  for (const name of Object.keys(settings()) as (keyof ReturnType<typeof settings>)[]) {
    assert.equal(settings()[name], Infinity, name);
    for (const invalid of [0, -1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createNumfmtCommand({ limits: { [name]: invalid } }), RangeError);
    }
    assert.equal(settings({ limits: { [name]: 1 } })[name], 1);
    assert.equal(settings({ limits: { [name]: Infinity } })[name], Infinity);
  }
});

test("numfmt accepts exact resource bounds and the direct factory honors limits", async () => {
  const result = await runNumfmt(["--field=1", "1"], { limits: { maxArguments: 2, maxArgumentBytes: 10, maxFieldRanges: 1, maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1\n");
  assert.equal((await runNumfmt([], { limits: { maxRecordBytes: 2, maxInputBytes: 3, maxSingleChunkBytes: 2, maxEmptyChunks: 1 } }, [new Uint8Array(), Buffer.from("12"), Buffer.from("\n")])).exitCode, 0);
  assert.throws(() => numfmtCommand({ limits: { maxWork: 0 } }), RangeError);
});

for (const delimiter of [" ", ","]) test(`numfmt charges every unselected field with delimiter ${JSON.stringify(delimiter)}`, async () => {
  const args = delimiter === "," ? ["--delimiter=,"] : [];
  const line = Array(30).fill("1").join(delimiter) + "\n";
  const result = await runNumfmt(args, { limits: { maxWork: 300 } }, Array.from({ length: 10 }, () => Buffer.from(line)));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /work limit exceeded/);
});
