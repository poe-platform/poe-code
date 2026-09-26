import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands } from "../../src/commands/csvkit/index.js";

const options = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unmeasured locale formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Released convert.fixed slices the original Python input line before strip().
test("in2csv fixed stress preserves borrowed CRLF when negative slices reach terminators", async () => {
  const fs = new MemoryFileSystem();
  const schema = new TextEncoder().encode("column,start,length\ntail,-2,1\n");
  await fs.writeFile("/schema.csv", schema);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -f fixed -s /schema.csv", { stdin: "ab\r\ncd\r\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
      { stdout: 'tail\n""\n""\n', stderr: "", status: 0 });
    assert.deepEqual(await fs.readFile("/schema.csv"), schema);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["schema.csv"]);
  } finally { await shell.dispose(); }
});

test("in2csv fixed stress keeps codepoint slices overlapping fields and first-row index mode", async () => {
  const fs = new MemoryFileSystem();
  const schema = new TextEncoder().encode("length,extra,column,start\n2,ignored,head,0\n1,ignored,astral,1\n2,ignored,overlap,1\n0,ignored,zero,0\n-1,ignored,negative,3\n900719925474099300,ignored,all,-900719925474099300\n");
  await fs.writeFile("/schema.csv", schema);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const zero of ["", " --zero"]) {
      const result = await shell.exec("in2csv -f fixed -s /schema.csv" + zero, { stdin: "é😀xy\nq\n" });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: "head,astral,overlap,zero,negative,all\né😀,😀,😀x,,,\nq,,,,,\n", stderr: "", status: 0 });
    }
    assert.deepEqual(await fs.readFile("/schema.csv"), schema);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["schema.csv"]);
  } finally { await shell.dispose(); }
});

test("in2csv fixed stress borrowed bare CR remains data and named iteration removes NUL", async () => {
  const fs = new MemoryFileSystem();
  const schema = new TextEncoder().encode("column,start,length\na,0,10\n");
  const data = new TextEncoder().encode("x\0y\r\nz\n");
  await fs.writeFile("/schema.csv", schema);
  await fs.writeFile("/data.fixed", data);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const [command, stdin, stdout] of [
      ["in2csv -f fixed -s /schema.csv", "x\ry\r\nz\n", 'a\n"x\ny"\nz\n'],
      ["in2csv -f fixed -s /schema.csv", "x\0y\n", "a\nx\0y\n"],
      ["in2csv -s /schema.csv /data.fixed", "", "a\nxy\nz\n"]
    ] as const) {
      const result = await shell.exec(command, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout, stderr: "", status: 0 });
    }
    assert.deepEqual(await fs.readFile("/schema.csv"), schema);
    assert.deepEqual(await fs.readFile("/data.fixed"), data);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["data.fixed", "schema.csv"]);
  } finally { await shell.dispose(); }
});

test("in2csv fixed stress first start one offsets later zero and negative starts independently of --zero", async () => {
  const fs = new MemoryFileSystem();
  const schema = new TextEncoder().encode("column,start,length\nhead,1,2\nlaterZero,0,1\nlaterNegative,-2,1\n");
  await fs.writeFile("/schema.csv", schema);
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    for (const zero of ["", " --zero"]) {
      const result = await shell.exec("in2csv -s /schema.csv" + zero, { stdin: "abcd\n" });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: "head,laterZero,laterNegative\nab,,c\n", stderr: "", status: 0 });
    }
    assert.deepEqual(await fs.readFile("/schema.csv"), schema);
  } finally { await shell.dispose(); }
});

test("in2csv fixed stress awaits row backpressure and drains registered stdin cleanup after cancellation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/schema.csv", new TextEncoder().encode("column,start,length\na,0,1\n"));
  const command = createCsvkitCommands(options).find(item => item.name === "in2csv")!;
  const controller = new AbortController();
  const reason = new Error("fixed input cancelled");
  const cleanups: (() => void | Promise<void>)[] = [];
  let pulls = 0; let returns = 0;
  let release!: () => void; let admitted!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const rowAdmitted = new Promise<void>(resolve => { admitted = resolve; });
  const writes: string[] = [];
  const execution = Promise.resolve(command.execute({ command: "in2csv", args: ["-f", "fixed", "-s", "/schema.csv"], cwd: "/", env: {}, fs,
    signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() {
      assert.ok(cleanups.length > 0, "register cleanup before acquiring input");
      return {
        // Codec admission reads a bounded 8192-byte prefix before yielding text.
        async next() { pulls++; return { done: false as const, value: new TextEncoder().encode("x\n".repeat(4096)) }; },
        async return() { returns++; return { done: true as const, value: undefined }; }
      };
    } },
    stdout: { async write(bytes) {
      writes.push(new TextDecoder().decode(bytes));
      if (writes.length === 2) { admitted(); await paused; controller.signal.throwIfAborted(); }
    } },
    stderr: { async write() { assert.fail("cancellation must not print diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  await rowAdmitted;
  assert.equal(pulls, 1, "do not pull the next line while a row write is pending");
  assert.deepEqual(writes, ["a\n", "x\n"]);
  controller.abort(reason); release();
  await rejected;
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.equal(returns, 1, "registered/finally cleanup closes the borrowed iterator once");
  assert.equal(pulls, 1);
});
