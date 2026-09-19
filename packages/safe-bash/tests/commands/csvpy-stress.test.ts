import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { utf8Codec, createCsvpyInterpreter } from "@poe-code/csvkit";
import { PythonSession } from "@poe-code/safe-python";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw Error("unexpected inference"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: true, stdoutIsTTY: true, stderrIsTTY: true, columns: 80, lines: 24 }
};

const usage = "usage: csvpy [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n             [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n             [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n             [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n             [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-V] [--dict]\n             [--agate] [--no-number-ellipsis] [-y SNIFF_LIMIT] [-I]\n             [FILE]\n";

async function consoleRun(command: string, csv: string, lines: readonly string[]) {
  let closed = 0, index = 0;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode(csv));
  const interpreter = createCsvpyInterpreter({
    createSession: ({ signal, output }) => {
      class TrackedSession extends PythonSession { override close(): void { closed++; super.close(); } }
      return new TrackedSession({ signal, output, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } });
    },
    terminal: {
      async readLine(signal) { signal.throwIfAborted(); return lines[index++] ?? null; }
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter }));
  try {
    const result = await shell.exec(command, { stdin: { async *[Symbol.asyncIterator]() { assert.fail("CSV-file console must preserve REPL stdin"); yield new Uint8Array(); } } });
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr, closed };
  } finally { await shell.dispose(); }
}

test("csvpy stress plain reader retains header and skip-lines consumes physical lines", async () => {
  assert.deepEqual(await consoleRun("csvpy -H -I -y 0 -K 1 /data.csv", "comment\nname,value\nalpha,001\n", ["next(reader)\n", "next(reader)\n"]), {
    status: 0, stdout: ">>> ['name', 'value']\n>>> ['alpha', '001']\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress dict wins over agate, lazily consumes header and preserves surplus/missing cells", async () => {
  assert.deepEqual(await consoleRun("csvpy --agate --dict /data.csv", "name,value\nalpha,001,extra\nbeta\n", ["reader.line_num\n", "reader.fieldnames\n", "next(reader)\n", "next(reader)\n"]), {
    status: 0, stdout: ">>> 0\n>>> ['name', 'value']\n>>> {'name': 'alpha', 'value': '001', None: ['extra']}\n>>> {'name': 'beta', 'value': None}\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.DictReader object named "reader".\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress an unread oversized record cannot fail reader construction", async () => {
  assert.deepEqual(await consoleRun("csvpy -z 1 /data.csv", "a\nlarge\n", ["next(reader)\n"]), {
    status: 0, stdout: ">>> ['a']\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.reader object named "reader".\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress DictReader rejects the source unsupported header keyword", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict -H /data.csv", "a\nb\n", []), {
    status: 1, stdout: "", stderr: "TypeError: 'header' is an invalid keyword argument for this function\n", closed: 1
  });
});

test("csvpy stress empty-message builtin exception omits colon and console continues", async () => {
  assert.deepEqual(await consoleRun("csvpy /data.csv", "a\nb\n", ["next(iter([]))\n", "42\n"]), {
    status: 0, stdout: ">>> >>> 42\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.reader object named "reader".\nTraceback (most recent call last):\n  File "<console>", line 1, in <module>\nStopIteration\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress DictReader fieldnames can be reassigned before header consumption", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict /data.csv", "a,b\n1,2\n", ["reader.fieldnames=['x','y']\n", "next(reader)\n", "next(reader)\n"]), {
    status: 0, stdout: ">>> >>> {'x': 'a', 'y': 'b'}\n>>> {'x': '1', 'y': '2'}\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.DictReader object named "reader".\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress DictReader exposes writable restkey and restval", async () => {
  assert.deepEqual(await consoleRun("csvpy --dict /data.csv", "a,b\n1,2,3\n4\n", ["(reader.restkey, reader.restval)\n", "reader.restkey='extra'; reader.restval='missing'\n", "next(reader)\n", "next(reader)\n"]), {
    status: 0, stdout: ">>> (None, None)\n>>> >>> {'a': '1', 'b': '2', 'extra': ['3']}\n>>> {'a': '4', 'b': 'missing'}\n>>> ",
    stderr: 'Welcome! "/data.csv" has been loaded in an agate.csv.DictReader object named "reader".\n\nnow exiting InteractiveConsole...\n', closed: 1
  });
});

test("csvpy stress omitted shared options stay rejected before interpreter or file acquisition", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader", "dict", "agate"],
    async load() { assert.fail("invalid argv must not acquire an interpreter"); }
  } }));
  try {
    for (const argument of ["--linenumbers", "--zero", "--names", "--add-bom", "--out-delimiter", "--out-quotechar", "--out-quoting", "--out-no-doublequote", "--out-escapechar", "--out-lineterminator"]) {
      const result = await shell.exec(`csvpy ${argument} /missing.csv`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 2, stdout: "", stderr: usage + `csvpy: error: unrecognized arguments: ${argument}\n`
      });
    }
  } finally { await shell.dispose(); }
});

test("csvpy stress stdin rejection precedes terminal session and input consumption", async () => {
  for (const command of ["csvpy", "csvpy -", "csvpy --agate -"]) {
    assert.deepEqual(await consoleRun(command, "a\nb\n", []), {
      status: 2, stdout: "", stderr: usage + "csvpy: error: csvpy cannot accept input as piped data via STDIN.\n", closed: 0
    });
  }
});

test("csvpy stress pending terminal cancellation preserves false reason and closes guest once", async () => {
  const controller = new AbortController();
  let entered!: () => void, closed = 0;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("a\nb\n"));
  const interpreter = createCsvpyInterpreter({
    createSession: ({ signal, output }) => {
      class TrackedSession extends PythonSession { override close(): void { closed++; super.close(); } }
      return new TrackedSession({ signal, output, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } });
    },
    terminal: {
      readLine(signal) {
        entered();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter }));
  try {
    const execution = shell.exec("csvpy /data.csv", { signal: controller.signal });
    const rejection = assert.rejects(execution, reason => reason === false);
    // Propagate unexpected startup failure instead of waiting indefinitely for
    // a terminal read that a broken interpreter never reaches.
    await Promise.race([reading, rejection.then(() => assert.fail("console unexpectedly completed"))]);
    controller.abort(false);
    await rejection;
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvpy stress exec and dispose drain an admitted cooperative terminal read", async () => {
  const controller = new AbortController();
  let entered!: () => void, sawAbort!: () => void, release!: () => void;
  let executionSettled = false, disposalSettled = false, terminalSettled = false, closed = 0;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const aborted = new Promise<void>(resolve => { sawAbort = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("a\nb\n"));
  const interpreter = createCsvpyInterpreter({
    createSession: ({ signal, output }) => {
      class TrackedSession extends PythonSession { override close(): void { closed++; super.close(); } }
      return new TrackedSession({ signal, output, hashSeed: [1n, 2n], limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 } });
    },
    terminal: {
      readLine(signal) {
        entered();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort();
            // Cooperative cleanup observes cancellation immediately, but must
            // finish its admitted resource work before the read settles.
            void barrier.then(() => { terminalSettled = true; reject(signal.reason); });
          }, { once: true });
        });
      }
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter }));
  const execution = shell.exec("csvpy /data.csv", { signal: controller.signal });
  const observation = execution.then(() => { executionSettled = true; }, () => { executionSettled = true; });
  let disposal: Promise<void> | undefined;
  try {
    await Promise.race([reading, observation.then(() => assert.fail("console never admitted terminal input"))]);
    controller.abort(false);
    await aborted;
    disposal = shell.dispose().then(() => { disposalSettled = true; });
    await setImmediate();
    assert.deepEqual({ terminalSettled, executionSettled, disposalSettled }, {
      terminalSettled: false, executionSettled: false, disposalSettled: false
    }, "exec and dispose must wait for the admitted cooperative terminal read");
    release();
    await assert.rejects(execution, reason => reason === false);
    await disposal;
    assert.equal(terminalSettled, true);
    assert.equal(closed, 1);
  } finally {
    release();
    await Promise.allSettled([observation, ...(disposal ? [disposal] : [])]);
    await shell.dispose();
  }
});
