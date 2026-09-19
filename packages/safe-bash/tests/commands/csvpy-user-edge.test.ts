import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, createCsvpyInterpreter } from "@poe-code/csvkit";
import { PythonSession } from "@poe-code/safe-python";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

async function run(command: string, csv: string, lines: string[]) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode(csv));
  let closed = 0;
  class Guest extends PythonSession { override close(): void { closed++; super.close(); } }
  const interpreter = createCsvpyInterpreter({
    createSession: options => new Guest({ ...options, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } }),
    terminal: { async readLine(signal) { signal.throwIfAborted(); return lines.shift() ?? null; } }
  });
  const shell = new Shell({ fs }).use(csvkitCommands({
    interpreter, codecs: [utf8Codec], clock: { now: () => 0 },
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw Error("unexpected inference"); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
  }));
  try {
    const result = await shell.exec(command, { stdin: { async *[Symbol.asyncIterator]() { assert.fail("borrowed REPL stdin consumed as CSV"); yield new Uint8Array(); } } });
    assert.equal(closed, 1);
    assert.deepEqual(await fs.readFile("/data.csv"), new TextEncoder().encode(csv));
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["data.csv"]);
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } finally { await shell.dispose(); }
}

const banner = (kind = "reader") => `Welcome! "/data.csv" has been loaded in an agate.csv.${kind} object named "reader".\n`;
const eof = "\nnow exiting InteractiveConsole...\n";

for (const [quoting, csv, output] of [
  [2, '1,"2",3.5\n', "[1.0, '2', 3.5]"],
  [4, '1,"2",\n', "[1.0, '2', None]"],
  [5, '1,"2",\n', "['1', '2', None]"]
] as const) {
  test(`csvpy user edge quoting ${quoting} retains Python cell types`, async () => {
    assert.deepEqual(await run(`csvpy -u${quoting} /data.csv`, csv, ["next(reader)\n"]), {
      status: 0, stdout: `>>> ${output}\n>>> `, stderr: banner() + eof
    });
  });
}

test("csvpy user edge duplicate DictReader names use the final cell and blank rows are skipped", async () => {
  assert.deepEqual(await run("csvpy --dict /data.csv", "x,x\n\n1,2\n", ["next(reader)\n"]), {
    status: 0, stdout: ">>> {'x': '2'}\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy user edge DictReader line_num synchronizes through fieldnames after skipping blank records", async () => {
  // Frozen CPython 3.14.2 fieldnames.fget synchronizes line_num unconditionally.
  // __next__ accesses it after skipping blanks; the resulting value is line 4.
  assert.deepEqual(await run("csvpy --dict /data.csv", "x\n\n\nvalue\n", ["next(reader)\n", "reader.line_num\n"]), {
    status: 0, stdout: ">>> {'x': 'value'}\n>>> 4\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy user edge physical CRLF skipping precedes quoted multiline CSV parsing", async () => {
  assert.deepEqual(await run("csvpy -K1 /data.csv", 'comment\r\na,b\r\n"one\r\ntwo",three\r\n', ["list(reader)\n"]), {
    // csvkit opens text input with universal-newline conversion before parsing.
    status: 0, stdout: ">>> [['a', 'b'], ['one\\ntwo', 'three']]\n>>> ", stderr: banner() + eof
  });
});

test("csvpy user edge DictReader blank tail exhaustion updates line_num on later fieldnames access", async () => {
  assert.deepEqual(await run("csvpy --dict /data.csv", "x\n\n\n", ["next(reader,None)\n", "reader.line_num\n", "reader.fieldnames\n", "reader.line_num\n"]), {
    status: 0, stdout: ">>> >>> 2\n>>> ['x']\n>>> 3\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy user edge resetting DictReader fieldnames follows CPython row-before-header timing", async () => {
  assert.deepEqual(await run("csvpy --dict /data.csv", "a\nfirst\nvalue\nnewname\n", ["next(reader)\n", "reader.fieldnames=None\n", "next(reader)\n", "reader.line_num\n"]), {
    status: 0, stdout: ">>> {'a': 'first'}\n>>> >>> {'newname': 'value'}\n>>> 4\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy user edge string SystemExit writes its message and avoids EOF text", async () => {
  assert.deepEqual(await run("csvpy /data.csv", "x\n", ["raise SystemExit('bye')\n"]), {
    status: 1, stdout: ">>> ", stderr: banner() + "bye\n"
  });
});
