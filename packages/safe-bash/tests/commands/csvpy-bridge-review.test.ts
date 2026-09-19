import test from "node:test";
import assert from "node:assert/strict";
import { createCsvpyInterpreter, utf8Codec } from "@poe-code/csvkit";
import { PythonSession } from "@poe-code/safe-python";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

async function consoleRun(command: string, csv: string, lines: readonly string[]) {
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(csv);
  await fs.writeFile("/data.csv", bytes);
  let index = 0, closed = 0;
  class Guest extends PythonSession { override close(): void { closed++; super.close(); } }
  const interpreter = createCsvpyInterpreter({
    createSession: options => new Guest({ ...options, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } }),
    terminal: { async readLine(signal) { signal.throwIfAborted(); return lines[index++] ?? null; } }
  });
  const shell = new Shell({ fs }).use(csvkitCommands({
    interpreter, codecs: [utf8Codec], clock: { now: () => 0 },
    locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw Error("unexpected inference"); } },
    terminal: { stdinIsTTY: true, stdoutIsTTY: true, stderrIsTTY: true, columns: 80, lines: 24 }
  }));
  try {
    const result = await shell.exec(command);
    assert.equal(closed, 1);
    assert.deepEqual(await fs.readFile("/data.csv"), bytes);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["data.csv"]);
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } finally { await shell.dispose(); }
}

const banner = (kind = "reader") => `Welcome! "/data.csv" has been loaded in an agate.csv.${kind} object named "reader".\n`;
const eof = "\nnow exiting InteractiveConsole...\n";

test("csvpy bridge review raw and wrapper iterators share progress and exhaustion", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", "a,b\n1,2\n3,4\n", [
    "r=iter(reader.reader); reader.line_numbers=True\n", "next(r)\n", "next(reader)\n",
    "next(r)\n", "(reader.line_num,reader.reader.line_num)\n", "next(reader,'done')\n", "next(r,'done')\n"
  ]), {
    status: 0, stdout: ">>> >>> ['a', 'b']\n>>> ['1', '1', '2']\n>>> ['3', '4']\n>>> (3, 3)\n>>> 'done'\n>>> 'done'\n>>> ", stderr: banner() + eof
  });
});

test("csvpy bridge review DictReader accepts empty, string and tuple fieldnames mutations", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict -y0 /data.csv", "a,b\n1,2\n3,4\n5,6\n7,8\n", [
    "reader.fieldnames\n", "reader.fieldnames=[]\n", "next(reader)\n",
    "reader.fieldnames='xy'\n", "next(reader)\n", "reader.fieldnames=('z','z')\n", "next(reader)\n",
    "reader.fieldnames=('only',); reader.restkey='only'\n", "next(reader)\n"
  ]), {
    status: 0, stdout: ">>> ['a', 'b']\n>>> >>> {None: ['1', '2']}\n>>> >>> {'x': '3', 'y': '4'}\n>>> >>> {'z': '6'}\n>>> >>> {'only': ['8']}\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy bridge review explicit fieldnames preserve the first record as data", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict -y0 /data.csv", "a,b\n1,2\n", [
    "reader.fieldnames=('left','right')\n", "(reader.line_num,reader.fieldnames)\n", "next(reader)\n", "next(reader)\n", "list(reader)\n"
  ]), {
    status: 0, stdout: ">>> >>> (0, ('left', 'right'))\n>>> {'left': 'a', 'right': 'b'}\n>>> {'left': '1', 'right': '2'}\n>>> []\n>>> ", stderr: banner("DictReader") + eof
  });
});

test("csvpy bridge review generator errors close only the generator and retain reader progress", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", "number\n1\n0\n2\n", [
    "next(reader)\n", "g=(1/int(row[0]) for row in reader)\n", "next(g)\n", "next(g)\n",
    "next(g,'closed')\n", "next(reader)\n", "next(reader,'done')\n"
  ]), {
    status: 0, stdout: ">>> ['number']\n>>> >>> 1.0\n>>> >>> 'closed'\n>>> ['2']\n>>> 'done'\n>>> ",
    stderr: banner() + 'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nZeroDivisionError: division by zero\n' + eof
  });
});

test("csvpy bridge review compound console input consumes rows and prints without display duplication", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", "x\none\ntwo\n", [
    "for row in reader:\n", " print(row[0],end='!')\n", "\n", "list(reader)\n", "print('done',flush=True)\n"
  ]), {
    status: 0, stdout: ">>> ... ... x!one!two!>>> []\n>>> done\n>>> ", stderr: banner() + eof
  });
});

test("csvpy bridge review explicit generator close runs finally without closing the reader", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", "x\none\ntwo\n", [
    "def consume():\n", " try:\n", "  yield from reader\n", " finally:\n", "  print('closed')\n", "\n",
    "g=consume()\n", "next(g)\n", "g.close()\n", "next(g,'done')\n", "list(reader)\n", "g.close()\n"
  ]), {
    status: 0, stdout: ">>> ... ... ... ... ... >>> >>> ['x']\n>>> closed\n>>> 'done'\n>>> [['one'], ['two']]\n>>> >>> ", stderr: banner() + eof
  });
});

test("csvpy bridge review failing exception string formatting preserves the console", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", "x\n", [
    "class E(Exception):\n", " def __str__(self):raise ValueError('broken')\n", "\n", "raise E()\n", "42\n"
  ]), {
    status: 0, stdout: ">>> ... ... >>> >>> 42\n>>> ",
    stderr: banner() + 'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nE: <exception str() failed>\n' + eof
  });
});
