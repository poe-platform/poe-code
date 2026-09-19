import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, createCsvpyInterpreter } from "@poe-code/csvkit";
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

// Source-derived assertions exercise the registered command and real interpreter,
// rather than asserting a seeded namespace or a host-side expression matcher.
test("csvpy object stress reader is its own iterator and reports physical multiline progress", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", 'a,b\n"first\nsecond",x\n', [
    "(iter(reader) is reader, reader.header, reader.line_num)\n", "next(reader)\n", "reader.line_num\n", "next(reader)\n", "reader.line_num\n", "list(reader)\n", "next(reader, 'exhausted')\n"
  ]), {
    status: 0,
    stdout: ">>> (True, True, 0)\n>>> ['a', 'b']\n>>> 1\n>>> ['first\\nsecond', 'x']\n>>> 3\n>>> []\n>>> 'exhausted'\n>>> ",
    stderr: banner() + eof
  });
});

test("csvpy object stress guest generator consumes reader once and stays exhausted", async () => {
  assert.deepEqual(await consoleRun("csvpy /data.csv", "x\none\ntwo\n", [
    "next(reader)\n", "g=(row[0].upper() for row in reader)\n", "next(g)\n", "list(g)\n", "list(g)\n", "list(reader)\n"
  ]), { status: 0, stdout: ">>> ['x']\n>>> >>> 'ONE'\n>>> ['TWO']\n>>> []\n>>> []\n>>> ", stderr: banner() + eof });
});

test("csvpy object stress duplicate dictionary names and rest cells survive native mutation", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict /data.csv", "a,a,c\n1,2,3,4\n5\n", [
    "reader.fieldnames\n", "reader.restkey='overflow'; reader.restval='missing'\n", "next(reader)\n", "next(reader)\n", "next(reader, False)\n", "next(reader, False)\n"
  ]), { status: 0, stdout: ">>> ['a', 'a', 'c']\n>>> >>> {'a': '2', 'c': '3', 'overflow': ['4']}\n>>> {'a': 'missing', 'c': 'missing'}\n>>> False\n>>> False\n>>> ", stderr: banner("DictReader") + eof });
});

test("csvpy object stress reader errors expose importable Python error classes", async () => {
  assert.deepEqual(await consoleRun("csvpy -z1 /data.csv", "a\nlong\n", [
    "from agate.csv_py3 import FieldSizeLimitError; from csv import Error\n", "issubclass(FieldSizeLimitError, ValueError)\n", "issubclass(Error, Exception)\n", "next(reader)\n", "next(reader)\n", "42\n"
  ]), {
    status: 0, stdout: ">>> >>> False\n>>> True\n>>> ['a']\n>>> >>> 42\n>>> ",
    stderr: banner() + 'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nFieldSizeLimitError: CSV contains a field longer than the maximum length of 1 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n' + eof
  });
});

test("csvpy object stress imported config mutations persist and remain session-local", async () => {
  const lines = ["from agate import config\n", "config.get_option('number_truncation_chars')\n", "config.set_options({'number_truncation_chars':'!', 'default_locale':'fr_FR'})\n", "print(config.get_option('default_locale'), config.get_option('number_truncation_chars'))\n"];
  assert.deepEqual(await consoleRun("csvpy --no-number-ellipsis /data.csv", "x\n", lines), {
    status: 0, stdout: ">>> >>> ''\n>>> >>> fr_FR !\n>>> ", stderr: banner() + eof
  });
  assert.deepEqual(await consoleRun("csvpy /data.csv", "x\n", ["from agate import config\n", "config.get_option('number_truncation_chars')\n"]), {
    status: 0, stdout: ">>> >>> '…'\n>>> ", stderr: banner() + eof
  });
});


test("csvpy object stress mutable reader line_numbers follows physical header indexing", async () => {
  assert.deepEqual(await consoleRun("csvpy -y0 /data.csv", 'a,b\n"first\nsecond",x\nlast,y\n', [
    "reader.line_numbers=True\n", "next(reader)\n", "next(reader)\n", "reader.header=False\n", "next(reader)\n"
  ]), {
    status: 0, stdout: ">>> >>> ['line_numbers', 'a', 'b']\n>>> ['2', 'first\\nsecond', 'x']\n>>> >>> ['4', 'last', 'y']\n>>> ", stderr: banner() + eof
  });
});


test("csvpy object stress raw reader dialect and readonly properties match captured native transcript", async () => {
  assert.deepEqual(await consoleRun("csvpy /data.csv", "a,b\n1,2\n", [
    "(reader.dialect.delimiter,reader.dialect.quotechar,reader.dialect.escapechar,reader.dialect.quoting,reader.dialect.doublequote,reader.dialect.skipinitialspace,reader.dialect.lineterminator,reader.dialect.strict)\n",
    "reader.line_num=99\n", "reader.dialect.delimiter=';'\n", "next(reader.reader)\n", "reader.line_num\n", "next(reader)\n"
  ]), {
    status: 0, stdout: ">>> (',', '\"', None, 0, True, False, '\\r\\n', False)\n>>> >>> >>> ['a', 'b']\n>>> 1\n>>> ['1', '2']\n>>> ",
    stderr: banner() + 'Traceback (most recent call last):\n  File "<console>", line 1, in <module>\nAttributeError: property \'line_num\' of \'Reader\' object has no setter\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nAttributeError: attribute \'delimiter\' of \'_csv.Dialect\' objects is not writable\n' + eof
  });
});

test("csvpy object stress module aliases config exports and exception constructors match native transcript", async () => {
  assert.deepEqual(await consoleRun("csvpy /data.csv", "a\n", [
    "import agate, agate.csv_py3, agate.exceptions\n", "agate.csv is agate.csv_py3\n", "agate.get_option('default_locale')\n",
    "agate.set_option('custom',42); agate.get_option('custom')\n", "from agate.exceptions import FieldSizeLimitError\n",
    "isinstance(FieldSizeLimitError(2,3),ValueError)\n", "str(FieldSizeLimitError(2,3))\n"
  ]), {
    status: 0,
    stdout: ">>> >>> True\n>>> 'en_US_POSIX'\n>>> 42\n>>> >>> False\n>>> 'CSV contains a field longer than the maximum length of 2 characters on line 3. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.'\n>>> ",
    stderr: banner() + eof
  });
});
