import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { createCommandArguments } from "../../src/contracts/command.js";
import { FsError } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { utf8Codec } from "safe-bash-command-csvkit";
import statGuards from "../../../../docs/csvkit/stat-guard-operation-reference.json" with { type: "json" };
import parserContract from "../../../../docs/csvkit/parser-contract-audit-20260917.json" with { type: "json" };
import expectationReference from "../../../../docs/csvkit/integration-expectation-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec], locale: { profile: "C.UTF-8", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

test("csvkit shell exports preserve the complete PYTHONIOENCODING input codec name", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const inherited = await shell.exec("export PYTHONIOENCODING=utf-8:replace; csvcut", { stdin: "a\nx\n" });
    assert.deepEqual({ status: inherited.exitCode, stdout: inherited.stdout, stderr: inherited.stderr }, {
      status: 1, stdout: "", stderr: "LookupError: unknown encoding: utf-8:replace\n"
    });
    const local = await shell.exec("PYTHONIOENCODING=utf-8:replace; csvcut", { stdin: "a\nx\n" });
    assert.deepEqual({ status: local.exitCode, stdout: local.stdout, stderr: local.stderr }, {
      status: 0, stdout: "a\nx\n", stderr: ""
    });
    const overridden = await shell.exec("export PYTHONIOENCODING=utf-8:replace; csvcut -e utf-8", { stdin: "a\nx\n" });
    assert.deepEqual({ status: overridden.exitCode, stdout: overridden.stdout, stderr: overridden.stderr }, {
      status: 0, stdout: "a\nx\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvkit common BOM boundary preserves raw bytes for names, empty output and delayed errors", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [command, input, expectedText, status, stderr] of [
      ["csvcut --add-bom -n", "a,b\nx,y\n", "  1: a\n  2: b\n", 0, ""],
      ["csvcut --add-bom", "", "\n", 0, ""],
      ["csvcut --add-bom missing.csv", "", "", 1, "FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n"]
    ] as const) {
      const writes: Uint8Array[] = [];
      const result = await shell.exec(command, { stdin: input, stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); } } });
      assert.equal(result.exitCode, status, command);
      assert.equal(result.stderr, stderr, command);
      assert.deepEqual(Uint8Array.from(writes.flatMap(bytes => Array.from(bytes))),
        Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode(expectedText)), command);
    }
  } finally { await shell.dispose(); }
});

test("csvkit cancellation during awaited BOM write never acquires stdin", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writes: Uint8Array[] = [];
  try {
    const execution = shell.exec("csvcut --add-bom", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("input admission must await BOM backpressure"); yield new Uint8Array(); } },
      stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); started(); await pending; } }
    });
    await admitted;
    assert.deepEqual(writes, [Uint8Array.of(0xef, 0xbb, 0xbf)]);
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(writes.length, 1);
  } finally { release(); await shell.dispose(); }
});

test("csvkit Python UTF-8 read-ahead distinguishes invalid bytes from final truncation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [lastByte, stdout] of [[0xff, ""], [0xc3, "a\nx\n"]] as const) {
      for (const fragmented of [false, true]) {
        const bytes = Uint8Array.of(0x61, 0x0a, 0x78, 0x0a, lastByte);
        const stdin = fragmented ? { async *[Symbol.asyncIterator]() {
          yield new Uint8Array();
          for (const byte of bytes) { yield Uint8Array.of(byte); yield new Uint8Array(); }
        } } : bytes;
        const result = await shell.exec("csvcut", { stdin });
        assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
          status: 1, stdout,
          stderr: 'Your file is not "utf-8-sig" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n'
        }, `last byte ${lastByte.toString(16)}, fragmented=${fragmented}`);
      }
    }
  } finally { await shell.dispose(); }
});

test("csvkit decoding errors retain the caller's Python encoding alias spelling", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -e UTF_8", { stdin: Uint8Array.of(0xff) });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "",
      stderr: 'Your file is not "UTF_8" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n'
    });
  } finally { await shell.dispose(); }
});

test("csvkit named pending reads reach cooperative return during caller cancellation", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("stream-capable input must not bulk-read"); },
    readStream(path: string) {
      assert.equal(path, "/pending.csv");
      // This producer cooperates through return(), without its own signal
      // listener. A generator wrapper must not queue return behind next().
      return { [Symbol.asyncIterator]: () => ({
        next: () => { started(); return pending; },
        return: async () => { returned++; release(); return { done: true, value: undefined }; }
      }) };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec("csvcut pending.csv", {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("named input must not acquire stdin"); yield new Uint8Array(); } }
  });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1, "caller cancellation must reach the cooperative producer without external release");
    await rejection;
  } finally {
    // Rescue the original regression so a failed assertion never leaves a
    // hanging canonical test or invocation cleanup barrier.
    release();
    await rejection;
    await shell.dispose();
  }
});

test("csvkit preclosed stdout preserves stderr-only argparse diagnostics", async () => {
  const consumer = new AbortController();
  consumer.abort(new FsError("EPIPE"));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const write = async () => { assert.fail("parser errors must not write stdout"); };
  try {
    const result = await shell.exec("csvcut -K invalid", { stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("parser errors must not acquire stdin"); yield new Uint8Array(); } }
    });
    const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvcut")!.usage;
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 2, stdout: "", stderr: usage + "csvcut: error: argument -K/--skip-lines: invalid int value: 'invalid'\n"
    });
  } finally { await shell.dispose(); }
});

test("csvkit preclosed stdout preserves delayed named-file application diagnostics", async () => {
  const consumer = new AbortController();
  consumer.abort(new FsError("EPIPE"));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const write = async () => { assert.fail("missing named input must not write stdout"); };
  try {
    const result = await shell.exec("csvcut missing.csv", { stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("named-file errors must not acquire stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n"
    });
  } finally { await shell.dispose(); }
});

test("csvkit enrolled stdout closure returns a pending stdin iterator before any output write", async () => {
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = new FsError("EPIPE");
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = () => { resolve({ done: true, value: undefined }); }; });
  let returned = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const definition = createCsvkitCommands(options).find(command => command.name === "csvcut")!;
  const write = async () => { assert.fail("closed output must not write"); };
  const execution = Promise.resolve(definition.execute({
    command: "csvcut", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({ next: () => { started(); return pending; }, return: async () => {
      returned++; release(); return { done: true, value: undefined };
    } }) },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } },
    stderr: { write: async () => { assert.fail("output closure must not produce Python diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  try {
    await admitted;
    consumer.abort(reason);
    await rejected;
    assert.equal(returned, 1);
    assert.equal(caller.signal.aborted, false);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});

test("csvkit delayed input errors retain argv paths while eager match-file opens use argparse status", async () => {
  const effects: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path) { effects.push(path); throw new Error("[Errno 2] No such file or directory: 'matches'"); }
  }));
  const stdin = { async *[Symbol.asyncIterator]() { assert.fail("named-input failures must not acquire stdin"); yield new Uint8Array(); } };
  try {
    const delayed = await shell.exec("csvcut missing.csv", { stdin });
    assert.deepEqual({ status: delayed.exitCode, stdout: delayed.stdout, stderr: delayed.stderr }, {
      status: 1, stdout: "", stderr: "FileNotFoundError: [Errno 2] No such file or directory: 'missing.csv'\n"
    });
    const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvgrep")!.usage;
    const eager = await shell.exec("csvgrep -f matches --help", { stdin });
    assert.deepEqual({ status: eager.exitCode, stdout: eager.stdout, stderr: eager.stderr }, {
      status: 2, stdout: "", stderr: usage + "csvgrep: error: argument -f/--file: can't open 'matches': [Errno 2] No such file or directory: 'matches'\n"
    });
    assert.deepEqual(effects, ["matches"]);
    const help = await shell.exec("csvcut missing.csv --help", { stdin });
    assert.equal(help.exitCode, 0);
    assert.equal(help.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvkit enrolled stdout consumer closure maps to SIGPIPE status without Python diagnostics", async () => {
  const consumer = new AbortController();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let writes = 0;
  const write = async () => {
    writes++;
    const reason = new FsError("EPIPE");
    consumer.abort(reason);
    throw reason;
  };
  try {
    const result = await shell.exec("csvcut", {
      stdin: "a,b\nx,y\n", stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 141, stdout: "a,b\n", stderr: ""
    });
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

test("csvgrep cancellation during eager open preserves errno-shaped reasons without argparse stderr", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "/cancelled" });
  let opens = 0;
  let diagnosticWrites = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile() { opens++; controller.abort(reason); throw reason; }
  }));
  try {
    await assert.rejects(shell.exec("csvgrep -f matches --help", {
      signal: controller.signal,
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("cancelled parse must not acquire CSV input"); yield new Uint8Array(); } },
      stderr: { async write() { diagnosticWrites++; } }
    }), caught => caught === reason);
    assert.equal(opens, 1);
    assert.equal(diagnosticWrites, 0);
  } finally { await shell.dispose(); }
});

test("csvkit actual Shell defers unknown short-cluster tails until later actions complete", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvclean")!.usage;
  const stdin = { async *[Symbol.asyncIterator]() { assert.fail("parser exits must not read CSV input"); yield new Uint8Array(); } };
  try {
    for (const [argv, diagnostic] of [
      ["-txyz", "unrecognized arguments: -xyz"],
      ["-tx -K bad", "argument -K/--skip-lines: invalid int value: 'bad'"],
      ["-t-", "argument -t/--tabs: ignored explicit argument '-'"],
      ["-t-encoding", "argument -t/--tabs: ignored explicit argument '-encoding'"],
      ["-t- -V", "argument -t/--tabs: ignored explicit argument '-'"]
    ]) {
      const result = await shell.exec(`csvclean ${argv}`, { stdin });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 2, stdout: "", stderr: usage + `csvclean: error: ${diagnostic}\n`
      });
    }
    const result = await shell.exec("csvclean -tx -V", { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "csvclean 2.2.0\n", stderr: ""
    });
  } finally { await shell.dispose(); }
});

test("csvcut actual Shell reports a terminator left after an already consumed positional group", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvcut")!.usage;
  try {
    for (const [argv, extras] of [["a -t -- b", "-- b"], ["a -- b", "b"]]) {
      const result = await shell.exec(`csvcut ${argv}`, { stdin: {
        async *[Symbol.asyncIterator]() { assert.fail("extra arguments must not read CSV input"); yield new Uint8Array(); }
      } });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 2, stdout: "", stderr: usage + `csvcut: error: unrecognized arguments: ${extras}\n`
      });
    }
  } finally { await shell.dispose(); }
});

test("csvsql actual Shell fixed nargs consumes help and integer flags as pair values", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvsql")!.usage;
  try {
    const result = await shell.exec("csvsql --engine-option --help -K --unknown", { stdin: {
      async *[Symbol.asyncIterator]() { assert.fail("parser exit must not read CSV input"); yield new Uint8Array(); }
    } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 2, stdout: "", stderr: usage + "csvsql: error: unrecognized arguments: --unknown\n"
    });
  } finally { await shell.dispose(); }
});

test("csvgrep overwritten FileType handles close once after a later parser failure", async () => {
  const effects: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path) {
      effects.push(`open:${path}`);
      return { async *lines() { assert.fail("parser failure must not read match lines"); yield ""; },
        async close() { effects.push(`close:${path}`); } };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -f first -f second -K invalid", { stdin: {
      async *[Symbol.asyncIterator]() { assert.fail("parser failure must not read CSV input"); yield new Uint8Array(); }
    } });
    const usage = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!.commands.find(command => command.name === "csvgrep")!.usage;
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 2, stdout: "", stderr: usage + "csvgrep: error: argument -K/--skip-lines: invalid int value: 'invalid'\n"
    });
    assert.deepEqual(effects, ["open:first", "open:second", "close:first", "close:second"]);
    await shell.dispose();
    assert.equal(effects.length, 4);
  } finally { await shell.dispose(); }
});

test("csvgrep actual Shell cancellation drains an admitted pending FileType open before settling", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let closed = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(_path, context) {
      assert.equal(context.signal.aborted, false);
      started(); await barrier;
      return { async *lines() { assert.fail("cancelled parse must not read match lines"); yield ""; },
        async close() { closed++; } };
    }
  }));
  let settled = false;
  try {
    const execution = shell.exec("csvgrep -f pending --help", { signal: controller.signal, stdin: {
      async *[Symbol.asyncIterator]() { assert.fail("cancelled parse must not read CSV input"); yield new Uint8Array(); }
    } });
    const rejection = assert.rejects(execution, reason => reason === false).then(() => { settled = true; });
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.equal(closed, 0);
    release(); await rejection;
    assert.equal(closed, 1);
    await shell.dispose();
    assert.equal(closed, 1);
  } finally { release(); await shell.dispose(); }
});

test("csvkit Shell choices preserve CPython 3.14 rejected-value repr and allowed-value str", async () => {
  const reference = parserContract.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [command, argv, message] of [
      ["in2csv", "-f=x", "argument -f/--format: invalid choice: 'x' (choose from csv, dbf, fixed, geojson, json, ndjson, xls, xlsx)"],
      ["csvformat", "-U6", "argument -U/--out-quoting: invalid choice: '6' (choose from 0, 1, 2, 3, 4, 5)"]
    ]) {
      const result = await shell.exec(`${command} ${argv}`, { stdin: {
        async *[Symbol.asyncIterator]() { assert.fail("invalid choices must not acquire input"); yield new Uint8Array(); }
      } });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 2, stdout: "", stderr: reference.commands.find(item => item.name === command)!.usage + `${command}: error: ${message}\n`
      });
    }
  } finally { await shell.dispose(); }
});

test("csvgrep Shell missing match-file capability is an explicit blocker without acquiring input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvgrep -f matches --help", { stdin: {
      async *[Symbol.asyncIterator]() { assert.fail("missing match-file capability must not acquire CSV input"); yield new Uint8Array(); }
    } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: csvgrep match-file opening capability\n"
    });
    const help = await shell.exec("csvgrep --help -f matches");
    assert.equal(help.exitCode, 0);
    assert.ok(help.stdout.startsWith("usage: csvgrep "));
    assert.equal(help.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvgrep Shell FileType opens and closes eagerly before help without reading lines", async () => {
  const effects: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path, context) {
      effects.push(`open:${path}:${context.cwd}`);
      return { async *lines() { assert.fail("help must not read match-file lines"); yield ""; }, async close() { effects.push(`close:${path}`); } };
    }
  }));
  try {
    const result = await shell.exec("csvgrep -f matches --help", { stdin: {
      async *[Symbol.asyncIterator]() { assert.fail("help must not acquire CSV input"); yield new Uint8Array(); }
    } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.startsWith("usage: csvgrep "));
    assert.equal(result.stderr, "");
    assert.deepEqual(effects, ["open:matches:/", "close:matches"]);
  } finally { await shell.dispose(); }
});

test("csvgrep Shell FileType failure beats help while leading version skips acquisition", async () => {
  const effects: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options,
    async openMatchFile(path) { effects.push(path); throw new Error("No such file or directory"); }
  }));
  try {
    const result = await shell.exec("csvgrep -f missing --help");
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.endsWith("csvgrep: error: argument -f/--file: can't open 'missing': No such file or directory\n"));
    assert.deepEqual(effects, ["missing"]);
    const version = await shell.exec("csvgrep -V -f other");
    assert.equal(version.exitCode, 0);
    assert.equal(version.stdout, "csvgrep 2.2.0\n");
    assert.equal(version.stderr, "");
    assert.deepEqual(effects, ["missing"]);
  } finally { await shell.dispose(); }
});

test("csvkit cancellation forwards cooperative stdin return while next is pending", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const definition = createCsvkitCommands(options).find(command => command.name === "csvcut")!;
  const execution = Promise.resolve(definition.execute({
    command: "csvcut", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: controller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({ next: () => { started(); return pending; }, return: async () => {
      returned++; release(); return { done: true, value: undefined };
    } }) },
    stdout: { write: async () => { assert.fail("cancelled input must not emit output"); } },
    stderr: { write: async () => { assert.fail("cancelled input must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    // Drain queued cleanup microtasks without waiting on the blocked producer.
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1);
  } finally {
    release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup()));
  }
});

test("csvkit shell accepts literal option-looking filenames after --", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/--version", new TextEncoder().encode("a,b\nx,y\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut -c b -- --version");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "b\ny\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvkit shell retains exact partial stdout and field-limit status", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a,b\nabcd,y\n"); })();
    const result = await shell.exec("csvcut -z 3", { stdin });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "a,b\n");
    assert.equal(result.stderr, "FieldSizeLimitError: CSV contains a field longer than the maximum length of 3 characters on line 2. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.\n");
  } finally { await shell.dispose(); }
});

test("csvkit pipeline settles after downstream closes without acquiring unrelated capabilities", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a,b\nx,y\nz,q\n"));
  await fs.writeFile("/backpressure.csv", new TextEncoder().encode("a,b\n" + ("x".repeat(1024) + ",y\n").repeat(128)));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  let stages: readonly string[] | undefined;
  let producerFinished = false;
  let waitForProducer = false;
  let producerDone = Promise.resolve();
  let releaseProducer = () => {};
  shell.use(async (context, next) => {
    try { return await next(); }
    finally {
      if (context.command === "csvcut") {
        producerFinished = true;
        releaseProducer();
      }
    }
  });
  shell.commands.register({ name: "one-chunk", execute: async context => {
    for await (const bytes of context.stdin) {
      await context.stdout.write(bytes);
      if (waitForProducer) await producerDone;
      assert.equal(producerFinished, waitForProducer);
      break;
    }
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: "pipeline-stages", execute: async context => {
    stages = [...context.args];
    return { exitCode: 0 };
  } });
  try {
    // Hold the small-output reader open until producer cleanup finishes; backpressure closes early.
    for (const [path, expectedStages] of [["/input.csv", ["0", "0"]], ["/backpressure.csv", ["141", "0"]]] as const) {
      stages = undefined;
      producerFinished = false;
      waitForProducer = path === "/input.csv";
      producerDone = new Promise(resolve => { releaseProducer = resolve; });
      const result = await shell.exec(`csvcut ${path} | one-chunk; pipeline-stages "\${PIPESTATUS[@]}"`).finally(() => releaseProducer());
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "a,b\n");
      assert.equal(result.stderr, "");
      assert.deepEqual(stages, expectedStages, path);
    }
  } finally { releaseProducer(); await shell.dispose(); }
});

test("csvkit shell consumes owned byte arguments through literal command invocation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a,b\nx,y\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  shell.commands.register({ name: "owned-cut", execute: async context => {
    const incoming = new TextEncoder().encode("b");
    const carrier = createCommandArguments(["-c", shellValueFromBytes(incoming), "/input.csv"]);
    incoming.fill(97);
    carrier.bytes(1)!.fill(97);
    return context.invoke!("csvcut", carrier.args, { argumentValues: carrier });
  } });
  try {
    const result = await shell.exec("owned-cut");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "b\ny\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvkit family collision refuses registration even at the last executable", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.commands.register({ name: "sql2csv", execute: async () => ({ exitCode: 9 }) });
  try {
    assert.throws(() => csvkitCommands(options).setup(shell), /already registered/);
    for (const name of ["csvclean", "csvcut", "csvformat", "csvgrep", "csvjoin", "csvjson", "csvlook", "csvpy", "csvsort", "csvsql", "csvstack", "csvstat", "in2csv"]) assert.equal(shell.commands.has(name), false);
    assert.equal((await shell.exec("sql2csv")).exitCode, 9);
    assert.throws(() => createCsvkitCommands(undefined as unknown as CsvkitCommandsOptions), /explicit codec/);
  } finally { await shell.dispose(); }
});

test("csvkit missing codec capability returns explicit status 78 through actual shell", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, codecs: [] }));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a,b\nx,y\n"); })();
    const result = await shell.exec("csvcut", { stdin });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: codec utf-8-sig\n");
  } finally { await shell.dispose(); }
});

test("csvkit shell preserves distinct malformed raw argv bytes instead of display replacements", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  shell.commands.register({ name: "raw-skip", execute: async context => {
    const argumentValues = createCommandArguments(["-K", shellValueFromBytes(Uint8Array.of(Number(context.args[0])))]);
    return context.invoke!("csvcut", argumentValues.args, { argumentValues });
  } });
  try {
    for (const [byte, escaped] of [[255, "\\udcff"], [254, "\\udcfe"]] as const) {
      const result = await shell.exec(`raw-skip ${byte}`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.endsWith(`csvcut: error: argument -K/--skip-lines: invalid int value: '${escaped}'\n`));
      assert.equal(result.stderr.includes("�"), false);
    }
  } finally { await shell.dispose(); }
});

test("csvsort custom null values normalize case while preserving the configured whitespace", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [nullValue, expected] of [
      ["CUSTOM", "a,b\nZ,4\n,1\n,2\n,3\n"],
      [" CUSTOM ", "a,b\n Custom ,3\nCUSTOM,1\nZ,4\ncustom,2\n"]
    ]) {
      const stdin = (async function* () { yield new TextEncoder().encode("a,b\nCUSTOM,1\ncustom,2\n Custom ,3\nZ,4\n"); })();
      const result = await shell.exec(`csvsort -I -y 0 -c a --null-value '${nullValue}'`, { stdin });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("csvsort uses Unicode codepoint order and stable reverse ordering through the actual shell", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [flags, input, expected] of [
      ["", "a,b\n😀,astral\n\ue000,bmp\n", "a,b\n\ue000,bmp\n😀,astral\n"],
      ["-r", "a,b\nx,first\nx,second\ny,third\nx,fourth\n", "a,b\ny,third\nx,first\nx,second\nx,fourth\n"],
      ["-i", "a,b\nz,😀\nA,α\n", "a,b\nA,α\nz,😀\n"]
    ]) {
      const stdin = (async function* () { yield new TextEncoder().encode(input); })();
      const result = await shell.exec(`csvsort -I -y 0 -c a ${flags}`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("csvsort actual shell row budget refuses the collected table before output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxRows: 2 } }));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a\nz\ny\n"); })();
    const result = await shell.exec("csvsort -I -y 0", { stdin });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: row budget exceeded\n");
  } finally { await shell.dispose(); }
});

test("csvsort actual shell refuses terminal input without an explicit path", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, terminal: { ...options.terminal, stdinIsTTY: true } }));
  try {
    const stdin = { async *[Symbol.asyncIterator]() { assert.fail("terminal input must not be acquired"); yield new Uint8Array(); } };
    const result = await shell.exec("csvsort -I -y 0", { stdin });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.endsWith("csvsort: error: You must provide an input file or piped data.\n"));
  } finally { await shell.dispose(); }
});

test("csvjoin actual shell matches duplicate null keys and preserves deterministic row order", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left.csv", new TextEncoder().encode("id,left\nNULL,L1\n,L2\nx,L3\n"));
  await fs.writeFile("/right.csv", new TextEncoder().encode("id,right\nNA,R1\nnone,R2\nx,R3\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjoin -I -y 0 -c id /left.csv /right.csv");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "id,left,right\n,L1,R1\n,L1,R2\n,L2,R1\n,L2,R2\nx,L3,R3\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvjoin actual shell enforces multiplicative result budgets before emitting a table", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left.csv", new TextEncoder().encode("id,left\nx,L1\nx,L2\nx,L3\nx,L4\n"));
  await fs.writeFile("/right.csv", new TextEncoder().encode("id,right\nx,R1\nx,R2\nx,R3\nx,R4\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxRows: 10 } }));
  try {
    const result = await shell.exec("csvjoin -I -y 0 -c id /left.csv /right.csv");
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: join result row budget exceeded\n");
  } finally { await shell.dispose(); }
});

test("csvjoin repeated output-column warning provenance remains an explicit blocker", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left.csv", new TextEncoder().encode("id,left\nx,L\n"));
  await fs.writeFile("/right.csv", new TextEncoder().encode("id,right\ny,R\n"));
  await fs.writeFile("/third.csv", new TextEncoder().encode("id,third\ny,T\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjoin -I -y 0 --outer -c id /left.csv /right.csv /third.csv");
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    // Joined headers now use the same Agate normalizer as input table headers.
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: Agate duplicate/unnamed column warning provenance\n");
  } finally { await shell.dispose(); }
});

test("csvpy actual shell rejects stdin before loading any interpreter", async () => {
  let loads = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader"], load: async () => { loads++; throw new Error("unexpected interpreter acquisition"); }
  } }));
  try {
    const stdin = { async *[Symbol.asyncIterator]() { assert.fail("unexpected stdin acquisition"); yield new Uint8Array(); } };
    for (const command of ["csvpy", "csvpy -"]) {
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.endsWith("csvpy: error: csvpy cannot accept input as piped data via STDIN.\n"));
    }
    assert.equal(loads, 0);
  } finally { await shell.dispose(); }
});

test("csvpy actual shell chooses dict before agate and closes the injected session once", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("a,b\nx,y\n"));
  const effects: unknown[] = [];
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["dict", "agate", "reader"], load: async (mode, source, settings, signal) => {
      let input = "";
      for await (const bytes of source) input += new TextDecoder().decode(bytes);
      effects.push(["load", mode, input, settings.input_path]); signal.throwIfAborted();
      return { profile: "test-only guest orchestration", interact: async banner => { effects.push(["interact", banner]); }, close: async () => { effects.push("close"); } };
    }
  } }));
  try {
    const result = await shell.exec("csvpy --dict --agate /data.csv");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(effects, [["load", "dict", "a,b\nx,y\n", "/data.csv"], ["interact", 'Welcome! "/data.csv" has been loaded in an agate.csv.DictReader object named "reader".'], "close"]);
  } finally { await shell.dispose(); }
  assert.equal(effects.filter(value => value === "close").length, 1);
});

test("csvpy actual shell preserves falsey interact failure in the host hook while draining cleanup", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new Uint8Array());
  let closed = 0;
  const failures: unknown[] = [];
  const shell = new Shell({ fs, onInternalError: failure => { failures.push(failure); } }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader"], load: async () => ({ profile: "test-only", interact: async () => { throw false; }, close: async () => { closed++; throw new Error("cleanup failure"); } })
  } }));
  try {
    const result = await shell.exec("csvpy /data.csv");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "shell: line 1: internal error\n");
    assert.deepEqual(failures, [false]);
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvpy actual shell cancellation awaits failing cooperative session close and keeps false reason", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new Uint8Array());
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let closed = 0;
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader"], load: async () => ({ profile: "test-only", interact: async () => { started(); await barrier; }, close: async () => { closed++; release(); throw new Error("losing cleanup failure"); } })
  } }));
  try {
    const execution = shell.exec("csvpy /data.csv", { signal: controller.signal });
    await admitted;
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(closed, 1);
  } finally { release(); await shell.dispose(); }
});

test("csvpy successful interaction keeps cooperative close failure observable", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new Uint8Array());
  const failure = new Error("owned close failed");
  let closed = 0;
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader"], load: async () => ({ profile: "test-only", interact: async () => {}, close: async () => { closed++; throw failure; } })
  } }));
  try {
    await assert.rejects(shell.exec("csvpy /data.csv"), reason => reason instanceof AggregateError && reason.errors.length === 1 && reason.errors[0] === failure);
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvlook actual shell retains Python negative slice semantics for narrow truncation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [width, expected] of [
      [2, "| abcde... | b |\n| -------- | - |\n| longe... | y |\n"],
      [0, "| abc... | ... |\n| ------ | --- |\n| lon... | ... |\n"],
      [-1, "| ab... | ... |\n| ----- | --- |\n| lo... | ... |\n"]
    ] as const) {
      const stdin = (async function* () { yield new TextEncoder().encode("abcdef,b\nlonger,y\n"); })();
      const result = await shell.exec(`csvlook -I -y 0 --max-column-width ${width}`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("csvlook maxrows zero avoids parsing invalid later records", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a,b\nx,y,z\n"); })();
    const result = await shell.exec("csvlook -I -y 0 --max-rows 0", { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "| a | b |\n| - | - |\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvlook display width counts astral and combining codepoints like Python", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("😀,combining\n\ue000,e\u0301\n"); })();
    const result = await shell.exec("csvlook -I -y 0", { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "| 😀 | combining |\n| - | --------- |\n| \ue000 | é        |\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvlook actual shell awaits output backpressure before later table lines", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let writes = 0;
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const seen: Uint8Array[] = [];
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a,b\nx,y\nz,q\n"); })();
    const execution = shell.exec("csvlook -I -y 0", { stdin, stdout: { write: async bytes => {
      seen.push(Uint8Array.from(bytes)); writes++;
      if (writes === 1) { started(); await barrier; }
    } } });
    await admitted;
    assert.equal(writes, 1);
    release();
    const result = await execution;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(writes, 4);
    assert.equal(seen.map(bytes => new TextDecoder().decode(bytes)).join(""), "| a | b |\n| - | - |\n| x | y |\n| z | q |\n");
  } finally { release(); await shell.dispose(); }
});

test("csvlook output-budget refusal keeps partial output and suppresses diagnostics that cannot fit", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxOutputBytes: 25 } }));
  try {
    const stdin = (async function* () { yield new TextEncoder().encode("a,b\nx,y\nz,q\n"); })();
    const result = await shell.exec("csvlook -I -y0", { stdin });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "| a | b |\n| - | - |\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [label, limits, incoming, diagnostic] of [
  ["count", { maxArguments: 1 }, ["-c", "a"], "argv count limit exceeded"],
  ["byte extent", { maxArgumentBytes: 3 }, [shellValueFromBytes(new TextEncoder().encode("😀"))], "argv byte limit exceeded"]
] as const) {
  test(`csvkit authentic argument carrier admits ${label} before allocating payload copies`, async () => {
    let reservations = 0;
    const argumentValues = createCommandArguments([...incoming], {
      assertOpen() {},
      reserve() { reservations++; return { commit() {}, release() {} }; }
    });
    reservations = 0;
    const definition = createCsvkitCommands({ ...options, limits }).find(command => command.name === "csvcut")!;
    const cleanups: (() => void | Promise<void>)[] = [];
    let stdout = "", stderr = "";
    try {
      const result = await definition.execute({
        command: "csvcut", args: argumentValues.args, argumentValues, cwd: "/", env: {},
        fs: new MemoryFileSystem(), signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { assert.fail("admission refusal must not acquire stdin"); yield new Uint8Array(); } },
        stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        registerCleanup: cleanup => { cleanups.push(cleanup); }
      });
      assert.deepEqual({ result, stdout, stderr }, {
        result: { exitCode: 78 }, stdout: "", stderr: `csvkit: unsupported or unqualified: ${diagnostic}\n`
      });
      assert.equal(reservations, 0);
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
  });
}

test("csvcut generated line-number column is admitted against the actual output column budget", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxColumns: 1 } }));
  try {
    const result = await shell.exec("csvcut -l", { stdin: "a\nx\n" });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: output column budget exceeded\n");
  } finally { await shell.dispose(); }
});

test("csvpy zero interpreter work budget refuses admission before invoking guest load", async () => {
  let loads = 0;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("a\nx\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxInterpreterWork: 0 }, interpreter: {
    modes: ["reader"], load: async () => { loads++; throw new Error("unexpected guest acquisition"); }
  } }));
  try {
    const result = await shell.exec("csvpy /data.csv");
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: interpreter work budget exceeded\n");
    assert.equal(loads, 0);
  } finally { await shell.dispose(); }
});

test("csvpy mapped interpreter-work refusal survives secondary close failure", async () => {
  let loads = 0;
  let closed = 0;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("a\nx\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxInterpreterWork: 1 }, interpreter: {
    modes: ["reader"], load: async (_mode, _source, _settings, _signal, work) => {
      loads++;
      return { profile: "test-only", interact: async () => { work.consume(); }, close: async () => { closed++; throw new Error("secondary close failure"); } };
    }
  } }));
  try {
    const result = await shell.exec("csvpy /data.csv");
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: interpreter work budget exceeded\n");
    assert.equal(loads, 1);
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvjson keyed null values use Python string identity without collapsing a literal null string", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjson -I -y0 --blanks --null-value MISSING -k id", { stdin: "id,v\nMISSING,first\nnull,second\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '{"None": {"id": null, "v": "first"}, "null": {"id": "null", "v": "second"}}');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvjson keyed objects preserve insertion order for integer-like and prototype-looking keys", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjson -I -y0 -k id", { stdin: "id\n2\n10\n1\n__proto__\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '{"2": {"id": "2"}, "10": {"id": "10"}, "1": {"id": "1"}, "__proto__": {"id": "__proto__"}}');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvjson nonstream key uniqueness checks Python stringified null identities before output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjson -I -y0 --blanks --null-value MISSING -k id", { stdin: "id\nMISSING\nNone\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ValueError: Value None is not unique in the key column.\n");
  } finally { await shell.dispose(); }
});

test("csvjson nonstream serialization awaits backpressure at each byte sink write", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let writes = 0;
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const seen: Uint8Array[] = [];
  try {
    const execution = shell.exec("csvjson -I -y0", { stdin: "a,b\nx,NULL\ny,z\n", stdout: { write: async bytes => {
      seen.push(Uint8Array.from(bytes)); writes++;
      if (writes === 1) { started(); await barrier; }
    } } });
    await admitted;
    assert.equal(writes, 1);
    assert.equal(new TextDecoder().decode(seen[0]), "[");
    release();
    const result = await execution;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(seen.map(bytes => new TextDecoder().decode(bytes)).join(""), '[{"a": "x", "b": null}, {"a": "y", "b": "z"}]');
  } finally { release(); await shell.dispose(); }
});

test("csvjson nonstream output refusal keeps admitted punctuation within the byte budget", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxOutputBytes: 3 } }));
  try {
    const result = await shell.exec("csvjson -I -y0", { stdin: "a\nx\n" });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "[{");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvjson nonstream cancellation preserves a falsey caller reason during an opaque awaited sink", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  try {
    const execution = shell.exec("csvjson -I -y0", { stdin: "a\nx\n", signal: controller.signal, stdout: { write: async () => { writes++; started(); await barrier; } } });
    await admitted;
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(writes, 1);
  } finally { release(); await shell.dispose(); }
});

test("in2csv JSON preserves numeric lexical precision, nonfinite values and nested union order", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -I -f json", { stdin: '[{"a":NaN,"nested":{"n":1.2300}},{"a":Infinity,"items":[9007199254740993,true]},{"a":-Infinity}]' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a,nested/n,items/0,items/1\nnan,1.2300,,\ninf,,9007199254740993,True\n-inf,,,\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("in2csv NDJSON preserves borrowed stdin and named-file newline differences", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const borrowed = expectationReference.cases.find(item => item.name === 'borrowed-ndjson-newlines')!;
    const named = expectationReference.cases.find(item => item.name === 'named-ndjson-newlines')!;
    const result = await shell.exec("in2csv -I -f ndjson", { stdin: borrowed.stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: borrowed.stdout, stderr: borrowed.stderr, status: borrowed.status
    });
    const bytes = new TextEncoder().encode(named.stdin);
    await fs.writeFile('/csvkit-integration-newlines.ndjson', bytes);
    const converted = await shell.exec('in2csv ' + named.argv.join(' '));
    assert.deepEqual({ stdout: converted.stdout, stderr: converted.stderr, status: converted.exitCode }, {
      stdout: named.stdout, stderr: named.stderr, status: named.status
    });
    assert.deepEqual(await fs.readFile('/csvkit-integration-newlines.ndjson'), bytes);
  } finally { await shell.dispose(); }
});

test("in2csv JSON frozen integer profile rejects oversized values before CSV output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -I -f json", { stdin: '[{"a":' + "1".repeat(4301) + "}]" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ValueError: Exceeds the limit (4300 digits) for integer string conversion: value has 4301 digits; use sys.set_int_max_str_digits() to increase the limit\n");
  } finally { await shell.dispose(); }
});

test("in2csv unpaired surrogate output encoding remains an explicit blocker", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("in2csv -I -f json", { stdin: '[{"a":"\\ud800"}]' });
    assert.equal(result.exitCode, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "csvkit: unsupported or unqualified: JSON unpaired surrogate output encoding profile\n");
  } finally { await shell.dispose(); }
});

test("in2csv JSON output obeys awaited backpressure and row byte admission", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, limits: { maxOutputBytes: 3 } }));
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const writes: Uint8Array[] = [];
  try {
    const execution = shell.exec("in2csv -I -f json", { stdin: '[{"a":"x"}]', stdout: { write: async bytes => { writes.push(Uint8Array.from(bytes)); started(); await barrier; } } });
    await admitted;
    assert.equal(writes.length, 1);
    assert.equal(new TextDecoder().decode(writes[0]), "a\n");
    release();
    const result = await execution;
    assert.equal(result.exitCode, 78);
    assert.equal(result.stderr, "");
    assert.equal(writes.length, 1);
  } finally { release(); await shell.dispose(); }
});

test("in2csv JSON cancellation preserves the caller false reason during an opaque sink", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  try {
    const execution = shell.exec("in2csv -I -f json", { stdin: '[{"a":"x"}]', signal: controller.signal, stdout: { write: async () => { writes++; started(); await barrier; } } });
    await admitted;
    controller.abort(false);
    await assert.rejects(execution, reason => reason === false);
    assert.equal(writes, 1);
  } finally { release(); await shell.dispose(); }
});

test("csvsql DDL quotes schema and embedded identifier delimiters with unique deduplication", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsql -I -y0 --tables 'a\"b' --db-schema select --unique-constraint select,select", { stdin: '"a""b",select\nx,y\n' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'CREATE TABLE "select"."a""b" (\n\t"a""b" VARCHAR NOT NULL, \n\t"select" VARCHAR NOT NULL, \n\tUNIQUE ("select")\n);\n');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("csvsql DDL percent escaping follows declarative dialect parameter metadata", async () => {
  for (const [dialect, table, column, type] of [
    ["mysql", "`t%%q`", "`a%%b`", "VARCHAR(1)"],
    ["postgresql", '"t%%q"', '"a%%b"', "VARCHAR"],
    ["sqlite", '"t%q"', '"a%b"', "VARCHAR"],
    ["oracle", '"t%q"', '"a%b"', "VARCHAR"],
    ["mssql", "[t%q]", "[a%b]", "VARCHAR(max)"]
  ]) {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`csvsql -I -y0 -i ${dialect} --tables t%q`, { stdin: "a%b\nx\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `CREATE TABLE ${table} (\n\t${column} ${type} NOT NULL\n);\n`);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  }
});

test("csvsql MySQL codepoint lengths and no-constraints compiler failure match reference", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsql -I -y0 -i mysql", { stdin: "a,b\n😀,\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "CREATE TABLE stdin (\n\ta VARCHAR(1) NOT NULL, \n\tb VARCHAR(1)\n);\n");
    assert.equal(result.stderr, "");
    const failure = await shell.exec("csvsql -I -y0 -i mysql --no-constraints", { stdin: "a,b\n😀,\n" });
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.stdout, "");
    assert.equal(failure.stderr, "CompileError: (in table 'stdin', column 'a'): VARCHAR requires a length on dialect mysql\n");
  } finally { await shell.dispose(); }
});

test("csvsql multiple VFS inputs retain earlier DDL when a later table has invalid arity", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first.data.csv", new TextEncoder().encode("a\nx\n"));
  await fs.writeFile("/second.csv", new TextEncoder().encode("a,b\nx,y,z\n"));
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvsql -I -y0 /first.data.csv /second.csv");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, 'CREATE TABLE "first.data" (\n\ta VARCHAR NOT NULL\n);\n');
    assert.equal(result.stderr, "ValueError: Row 0 has 3 values, but Table only has 2 columns.\n");
  } finally { await shell.dispose(); }
});

test("in2csv NDJSON diagnostics preserve blank and malformed physical-line terminators", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [input, detail] of [
      ["\n", "Expecting value: line 2 column 1 (char 1)"],
      ["\r\n", "Expecting value: line 2 column 1 (char 2)"],
      ["\r", "Expecting value: line 1 column 2 (char 1)"],
      ["{\n", "Expecting property name enclosed in double quotes: line 2 column 1 (char 2)"],
      ["{\r\n", "Expecting property name enclosed in double quotes: line 2 column 1 (char 3)"],
      ["{\r", "Expecting property name enclosed in double quotes: line 1 column 3 (char 2)"]
    ]) {
      const result = await shell.exec("in2csv -I -f ndjson", { stdin: input! });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `JSONDecodeError: ${detail}\n`);
    }
  } finally { await shell.dispose(); }
});

test("csvstat operation admission matches frozen errors without acquiring input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const candidate of statGuards.cases) {
      const stdin = candidate.status === 0 ? candidate.stdin : {
        async *[Symbol.asyncIterator]() { assert.fail("csvstat admission errors must not acquire stdin"); yield new Uint8Array(); }
      };
      const result = await shell.exec([candidate.command, ...candidate.argv].join(" "), { stdin });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: candidate.status, stdout: candidate.stdout, stderr: candidate.stderr
      }, candidate.argv.join(" "));
    }
  } finally { await shell.dispose(); }
});

test("csvstat terminal admission precedes metric conflicts while names bypasses them", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, terminal: { ...options.terminal, stdinIsTTY: true } }));
  try {
    const stdin = { async *[Symbol.asyncIterator]() { assert.fail("csvstat terminal errors must not acquire stdin"); yield new Uint8Array(); } };
    const result = await shell.exec("csvstat --count --min --max", { stdin });
    const expected = statGuards.cases.find(candidate => candidate.argv.includes("--min"))!;
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, expected.stderr.slice(0, expected.stderr.lastIndexOf("csvstat: error:")) + "csvstat: error: You must provide an input file or piped data.\n");
    const names = await shell.exec("csvstat --names --count --min --max --csv --json", { stdin: "a,b\nx,y\n" });
    assert.equal(names.exitCode, 0, names.stderr);
    assert.equal(names.stdout, "  1: a\n  2: b\n");
    assert.equal(names.stderr, "");
    const header = await shell.exec("csvstat --names -H --count --min --max", { stdin });
    assert.deepEqual({ status: header.exitCode, stdout: header.stdout, stderr: header.stderr }, {
      status: 1, stdout: "", stderr: "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n"
    });
  } finally { await shell.dispose(); }
});

test("sql2csv actual Shell cancellation drains admitted database acquisition before settling", async () => {
  const effects: string[] = [];
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, databases: [{
    schemes: ["bound"], profile: "test-only",
    async connect(_url, _settings, signal) {
      assert.equal(signal.aborted, false);
      started(); await barrier;
      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, false);
      return { profile: "test-only", async begin() { assert.fail("unexpected begin"); },
        async commit() { assert.fail("unexpected commit"); }, async query() { assert.fail("cancelled acquisition must not query"); },
        async rollback() { effects.push("rollback"); }, async close() { effects.push("close"); } };
    }
  }] }));
  let settled = false;
  try {
    const execution = shell.exec("sql2csv --db bound://owned --query 'select 1'", { signal: controller.signal });
    const rejected = assert.rejects(execution, caught => caught === false).then(() => { settled = true; });
    await admitted;
    controller.abort(false);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(effects, []);
    release(); await rejected;
    assert.deepEqual(effects, ["rollback", "close"]);
    await shell.dispose();
    assert.deepEqual(effects, ["rollback", "close"]);
  } finally { release(); await shell.dispose(); }
});

test("sql2csv stdout consumer closure returns pending driver rows and drains each database resource once", async () => {
  const consumer = new AbortController();
  const caller = new AbortController();
  const reason = new FsError("EPIPE");
  const effects: string[] = [];
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<readonly string[]>>(resolve => { release = () => resolve({ done: true, value: undefined }); });
  const definition = createCsvkitCommands({ ...options, databases: [{ schemes: ["bound"], profile: "test-only",
    async connect() { return { profile: "test-only", async begin() { assert.fail("unexpected begin"); }, async commit() { assert.fail("unexpected commit"); },
      async rollback() { effects.push("rollback"); }, async close() { effects.push("session-close"); },
      async query() { return { columns: ["a"], rows: { [Symbol.asyncIterator]: () => ({
        next: () => { started(); return pending; }, return: async () => { effects.push("rows-return"); release(); return { done: true, value: undefined }; }
      }) }, async close() { effects.push("result-close"); } }; }
    }; }
  }] }).find(command => command.name === "sql2csv")!;
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  const write = async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); };
  const execution = Promise.resolve(definition.execute({ command: "sql2csv", args: ["--db", "bound://owned", "--query", "select 1"],
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("explicit query must not consume stdin"); yield new Uint8Array(); } },
    stdout: { write, ownedOutput: { consumerClosed: consumer.signal, write } }, stderr: { async write() { assert.fail("consumer closure must not emit diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  }));
  const rejected = assert.rejects(execution, caught => caught === reason);
  try {
    await admitted; consumer.abort(reason); await rejected;
    assert.deepEqual(writes, ["a\n"]);
    assert.deepEqual(effects, ["rows-return", "result-close", "rollback", "session-close"]);
    assert.equal(caller.signal.aborted, false);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
  assert.deepEqual(effects, ["rows-return", "result-close", "rollback", "session-close"]);
});
