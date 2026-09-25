import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext, InvocationCleanup } from "safe-bash-contracts/command";
import { csvgrep, createCsvgrepCommand, parseCsvgrepArguments } from "./index.js";
import { CsvBudget, CsvError } from "safe-bash-csv-engine";
const encoder = new TextEncoder();
function fixture(args: readonly string[], input: string, files: Record<string, string> = {}) {
  const out: number[] = [],
    err: number[] = [],
    cleanups: InvocationCleanup[] = [];
  const controller = new AbortController();
  let closed = 0,
    reads = 0;
  const context: CommandContext = {
    command: "csvgrep",
    args,
    stdin: (async function* () {
      try {
        yield encoder.encode(input);
      } finally {
        closed++;
      }
    })(),
    stdout: {
      async write(bytes) {
        out.push(...bytes);
      }
    },
    stderr: {
      async write(bytes) {
        err.push(...bytes);
      }
    },
    cwd: "/vfs",
    env: { PYTHONIOENCODING: "ascii" },
    signal: controller.signal,
    fs: {
      readStream(path: string) {
        reads++;
        return (async function* () {
          if (!(path in files)) throw new Error("unexpected read");
          yield encoder.encode(files[path]!);
        })();
      }
    } as unknown as CommandContext["fs"],
    registerCleanup(c) {
      cleanups.push(c);
    }
  };
  return {
    context,
    controller,
    cleanups,
    out,
    err,
    closed: () => closed,
    reads: () => reads,
    text: () => new TextDecoder().decode(Uint8Array.from(out)),
    error: () => new TextDecoder().decode(Uint8Array.from(err))
  };
}
const base = "x,y,id\na,a,1\na,b,2\nb,a,3\nb,b,4\n";
test("empty input emits LF for filtering and fails names with CLI/SDK parity", async () => {
  for (const file of [false, true]) for (const sdk of [false, true]) {
    for (const mode of ["filter", "headerless", "names"] as const) {
      const names = mode === "names", headerless = mode === "headerless";
      const args = names ? ["--names"] : ["-c1", "-mAda", ...(headerless ? ["-H"] : [])];
      const f = fixture([...args, ...(file ? ["data"] : [])], "", { "/vfs/data": "" });
      const result = await csvgrep(f.context, sdk ? {
        ...(names ? { names: true } : { columns: "1", match: "Ada", headerless }),
        ...(file ? { filePath: "data" } : {})
      } : undefined);
      assert.equal(result.exitCode, names ? 1 : 0);
      assert.equal(f.text(), names ? "" : "\n");
      assert.equal(f.error(), names ? "error: No header row available\n" : "");
      assert.equal(result.accounting.retainedBytes, 0);
      assert.equal(f.reads(), file ? 1 : 0);
    }
  }
});
test("empty-input output and diagnostics respect output quotas", async () => {
  for (const args of [["-c1", "-mAda"], ["--names"]]) {
    const f = fixture(args, "");
    const result = await csvgrep(f.context, undefined, { limits: { outputBytes: 0 } });
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), "");
    assert.equal(f.error(), "");
    assert.equal(result.accounting.outputBytes, 0);
  }
});
test("line numbers preserve data positions and named access with CLI/SDK parity", async () => {
  for (const [flags, columns, zero, headerless, match, expected] of [
    [["-l"], "1", false, false, "Ada", "line_numbers,name,n\n1,Ada,1\n"],
    [["--linenumbers"], "1", false, false, "Ada", "line_numbers,name,n\n1,Ada,1\n"],
    [["-l", "--zero"], "0", true, false, "Ada", "line_numbers,name,n\n1,Ada,1\n"],
    [["-l", "-H"], "1", false, true, "Ada", "a,b,c\n1,Ada,1\n"],
    [["-l"], "name", false, false, "Ada", "line_numbers,name,n\n1,Ada,1\n"],
    [["-l"], "line_numbers", false, false, "2", "line_numbers,name,n\n2,Bob,2\n"],
    [["-l"], "1-2", false, false, "Ada", "line_numbers,name,n\n"],
    [["-l", "-H"], "b", false, true, "Ada", "a,b,c\n1,Ada,1\n"]
  ] as const) {
    const input = (headerless ? "" : "name,n\n") + "Ada,1\nBob,2\n";
    for (const file of [false, true]) {
      const cli = fixture([...flags, "-c", columns, "-m", match, ...(file ? ["data"] : [])], input,
        { "/vfs/data": input });
      const sdk = fixture([], input, { "/vfs/data": input });
      assert.equal((await csvgrep(cli.context)).exitCode, 0);
      assert.equal((await csvgrep(sdk.context, {
        columns, zero, headerless, match, lineNumbers: true, ...(file ? { filePath: "data" } : {})
      })).exitCode, 0);
      assert.equal(cli.text(), expected, JSON.stringify({ flags, columns, file }));
      assert.deepEqual(cli.out, sdk.out);
      assert.deepEqual(cli.err, sdk.err);
    }
  }
});
test("exhausted diagnostic budgets return failure without exceeding quotas", async () => {
  for (const limits of [{ outputBytes: 2 }, { work: 0 }, { retainedBytes: 0 }]) {
    const f = fixture(["-c", "x", "-m", "a"], "x\na\n");
    const result = await createCsvgrepCommand({ limits }).execute(f.context);
    assert.equal(result.exitCode, 1);
    assert.equal(f.error(), "");
    assert.equal(f.text(), "outputBytes" in limits ? "x\n" : "");
    assert.equal(result.accounting.retainedBytes, 0);
    if (limits.outputBytes !== undefined)
      assert.ok(result.accounting.outputBytes <= limits.outputBytes);
    await Promise.all(f.cleanups.map((cleanup) => cleanup()));
    assert.equal(f.closed(), "outputBytes" in limits ? 1 : 0);
  }
});
test("independent quota cells retire inputs and permit a fresh invocation", async () => {
  for (const limits of [
    { inputBytes: 1 }, { decodedBytes: 1 }, { fieldBytes: 1 }, { cells: 0 },
    { scannedCells: 0 }, { patternBytes: 0 }, { argumentBytes: 0 },
    { setEntries: 0 }, { setBytes: 0 }
  ]) {
    const f = fixture(["-cx", "patternBytes" in limits ? "-ra" : "-fF"], "x\na\n", { "/vfs/F": "a\n" });
    const result = await csvgrep(f.context, undefined, { limits });
    assert.equal(result.exitCode, 1, JSON.stringify(limits));
    assert.equal(result.accounting.retainedBytes, 0);
    assert.doesNotMatch(f.text(), /a\n/);
    await Promise.all(f.cleanups.map((cleanup) => cleanup()));
  }
  const fresh = fixture(["-cx", "-ma"], "x\na\n");
  assert.equal((await csvgrep(fresh.context)).exitCode, 0);
  assert.equal(fresh.text(), "x\na\n");
});
test("blocked output cancellation closes the producer and idempotent cleanup", async () => {
  const f = fixture(["-cx", "-ma"], "x\na\n");
  let writes = 0;
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => { entered = resolve; });
  const run = csvgrep({ ...f.context, stdout: {
    async write() {
      writes++;
      entered();
      await new Promise<void>((_resolve, reject) => {
        f.controller.signal.addEventListener("abort", () => reject(f.controller.signal.reason), { once: true });
      });
    }
  } });
  await writing;
  f.controller.abort(false);
  await assert.rejects(run, (error) => error === false);
  await Promise.all(f.cleanups.flatMap((cleanup) => [cleanup(), cleanup()]));
  assert.equal(writes, 1);
  assert.equal(f.closed(), 1);
  assert.equal(f.error(), "");
});
test("cancellation during an unfinished CSV field and match-file line retires each source", async () => {
  for (const fileMode of [false, true]) {
    const f = fixture(["-cx", fileMode ? "-fF" : "-ma"], "unused");
    let retired = 0;
    const input = (async function* () {
      try {
        yield encoder.encode(fileMode ? "a" : 'x\n"unfinished');
        f.controller.abort("parse canceled");
        yield encoder.encode("never consumed");
      } finally { retired++; }
    })();
    const fs = { readStream() { return input; } } as unknown as CommandContext["fs"];
    await assert.rejects(csvgrep({ ...f.context, ...(fileMode ? { fs } : { stdin: input }) }),
      (error) => error === "parse canceled");
    assert.equal(retired, 1);
    assert.equal(f.text(), fileMode ? "" : "x\n");
    assert.equal(f.closed(), 0);
    await Promise.all(f.cleanups.map((cleanup) => cleanup()));
  }
});
test("invalid and truncated UTF-8 match files fail before CSV input admission", async () => {
  for (const bytes of [Uint8Array.of(255), Uint8Array.of(0xc3)]) {
    const f = fixture(["-cx", "-fF"], "x\na\n");
    let retired = 0;
    const fs = { readStream() { return (async function* () {
      try { yield bytes; } finally { retired++; }
    })(); } } as unknown as CommandContext["fs"];
    const result = await csvgrep({ ...f.context, fs });
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), "");
    assert.match(f.error(), /error: (Invalid|Truncated) UTF-8 match file\n/);
    assert.equal(f.closed(), 0);
    assert.equal(retired, 1);
  }
});
test("Unicode inline flags have equivalent CLI and SDK bytes and status", async () => {
  const input = "x,id\n١,1\na,2\n1,3\n";
  for (const [regex, expected, status] of [
    ["(?u)\\d", "x,id\n١,1\n1,3\n", 0],
    ["(?au)\\d", "", 1]
  ] as const) {
    const cli = fixture(["-cx", `-r${regex}`], input), sdk = fixture([], input);
    assert.equal((await csvgrep(cli.context)).exitCode, status);
    assert.equal((await csvgrep(sdk.context, { columns: "x", regex })).exitCode, status);
    assert.equal(cli.text(), expected);
    assert.deepEqual(cli.out, sdk.out);
    assert.deepEqual(cli.err, sdk.err);
  }
});
test("independent aggregate controls and CLI/SDK parity", async () => {
  for (const [flags, any, invert, expected] of [
    [[], false, false, "a,a,1\n"],
    [["-a"], true, false, "a,a,1\na,b,2\nb,a,3\n"],
    [["-i"], false, true, "a,b,2\nb,a,3\nb,b,4\n"],
    [["-a", "-i"], true, true, "b,b,4\n"]
  ] as const) {
    const cli = fixture(["-c", "x,y", "-m", "a", ...flags], base),
      sdk = fixture([], base);
    assert.equal((await createCsvgrepCommand().execute(cli.context)).exitCode, 0);
    assert.equal(
      (await csvgrep(sdk.context, { columns: "x,y", match: "a", any, invert })).exitCode,
      0
    );
    assert.equal(cli.text(), "x,y,id\n" + expected);
    assert.deepEqual(cli.out, sdk.out);
    await Promise.all(cli.cleanups.map((c) => c()));
    assert.equal(cli.closed(), 1);
  }
});
test("match-file Unicode rstrip exactness, losing file is never opened", async () => {
  const f = fixture(["-c", "x", "-f", "F"], "x,id\na,1\na ,2\na\t,3\n,4\n", {
    "/vfs/F": "a \na\t\n\u00a0\n"
  });
  assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0);
  assert.equal(f.text(), "x,id\na,1\n,4\n");
  const losing = fixture(["-c", "x", "-r", "b", "-f", "missing"], base);
  await createCsvgrepCommand().execute(losing.context);
  assert.equal(losing.reads(), 0);
});
test("an explicitly supplied empty match-file path cannot fall through to substring mode", async () => {
  for (const sdk of [false, true]) {
    const f = fixture(["-c", "x", "-f", "", "-m", "a"], base);
    const fs = {
      readStream(path: string, options: { signal: AbortSignal }) {
        assert.equal(path, "/vfs/");
        assert.ok(f.cleanups.length);
        options.signal.throwIfAborted();
        throw new CsvError("INPUT", "Match file is a directory");
      }
    } as unknown as CommandContext["fs"];
    const result = await csvgrep(
      { ...f.context, fs },
      sdk ? { columns: "x", file: "", match: "a" } : undefined
    );
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), "");
    assert.equal(f.error(), "error: Match file is a directory\n");
    assert.equal(f.closed(), 0);
  }
});
test("short rows stay short; physical numbering precedes filtering", async () => {
  const f = fixture(["-c", "y", "-r", "^$"], "x,y\na\na,b\n");
  await createCsvgrepCommand().execute(f.context);
  assert.equal(f.text(), "x,y\na\n");
  const numbered = fixture(["-c", "x", "-m", "a", "-l"], 'x,id\n"a\nb",1\nc,2\na,3\n');
  await createCsvgrepCommand().execute(numbered.context);
  assert.equal(numbered.text(), 'line_numbers,x,id\n2,"a\nb",1\n4,a,3\n');
});
test("no matches is success with header; errors have explicit statuses before output", async () => {
  const none = fixture(["-c", "x", "-m", "z"], base);
  assert.equal((await createCsvgrepCommand().execute(none.context)).exitCode, 0);
  assert.equal(none.text(), "x,y,id\n");
  for (const args of [[], ["-c", "x"], ["-c"], ["--wat"], ["-c", "x", "-m", "a", "one", "two"]]) {
    const f = fixture(args, base);
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 2);
    assert.equal(f.text(), "");
  }
  const invalid = fixture(["-c", "x", "-r", "("], base);
  assert.equal((await createCsvgrepCommand().execute(invalid.context)).exitCode, 1);
  assert.equal(invalid.text(), "");
  assert.equal(invalid.error(), "error: missing ), unterminated subpattern at position 0\n");
});
test("every byte split and reused producer buffer has identical output", async () => {
  const input = encoder.encode('\ufeffx,y\r\n"é\nq",a\r\n');
  for (let split = 0; split <= input.length; split++) {
    const f = fixture(["-c", "x", "-m", "é"], "");
    const context = {
      ...f.context,
      stdin: (async function* () {
        yield input.subarray(0, split);
        yield new Uint8Array();
        yield input.subarray(split);
      })()
    };
    await createCsvgrepCommand().execute(context);
    assert.equal(f.text(), 'x,y\n"é\nq",a\n');
  }
  const f = fixture(["-c", "x", "-m", "a"], "");
  const buffer = encoder.encode("x\na\n");
  await createCsvgrepCommand().execute({
    ...f.context,
    stdin: (async function* () {
      yield buffer;
      buffer.fill(0);
    })()
  });
  assert.equal(f.text(), "x\na\n");
});
test("cancellation closes input and forbids post-abort writes; limits are invocation local", async () => {
  const f = fixture(["-c", "x", "-m", "a"], base);
  f.controller.abort("stop");
  await assert.rejects(createCsvgrepCommand().execute(f.context), (e) => e === "stop");
  assert.equal(f.text(), "");
  const during = fixture(["-c", "x", "-m", "a"], base);
  let closed = 0;
  const source = (async function* () {
    try {
      yield encoder.encode("x\n");
      during.controller.abort("stop");
      yield encoder.encode("a\n");
    } finally {
      closed++;
    }
  })();
  await assert.rejects(
    createCsvgrepCommand().execute({ ...during.context, stdin: source }),
    (e) => e === "stop"
  );
  assert.equal(closed, 1);
  assert.equal(during.text(), "x\n");
  const cmd = createCsvgrepCommand({ limits: { scannedCells: 1 } }),
    limited = fixture(["-c", "x", "-m", "a"], base);
  assert.equal((await cmd.execute(limited.context)).exitCode, 1);
  const again = fixture(["-c", "x", "-m", "a"], "x\na\n");
  assert.equal((await cmd.execute(again.context)).exitCode, 0);
});
test("names shortcut emits only names and closes input, tabs override delimiter, skip physical lines", async () => {
  const names = fixture(["-n"], base);
  assert.equal((await createCsvgrepCommand().execute(names.context)).exitCode, 0);
  assert.equal(names.text(), "  1: x\n  2: y\n  3: id\n");
  const tabs = fixture(["-c", "x", "-m", "a", "-d", ";", "-t"], "x\ty\na\tb\n");
  await createCsvgrepCommand().execute(tabs.context);
  assert.equal(tabs.text(), "x,y\na,b\n");
  const skip = fixture(["-c", "x", "-m", "a", "-K", "1"], "ignored\r\nx,y\r\na,b\r\n");
  await createCsvgrepCommand().execute(skip.context);
  assert.equal(skip.text(), "x,y\na,b\n");
});
test("match-file split CRLF, set retention budgets and concurrent isolation", async () => {
  const input = "x,id\na,1\n,2\na ,3\n",
    file = encoder.encode("a \r\n\u00a0\r\na");
  for (let split = 0; split <= file.length; split++) {
    const f = fixture(["-c", "x", "-f", "F"], input);
    const fs = {
      readStream() {
        return (async function* () {
          yield file.subarray(0, split);
          yield file.subarray(split);
        })();
      }
    } as unknown as CommandContext["fs"];
    await createCsvgrepCommand().execute({ ...f.context, fs });
    assert.equal(f.text(), "x,id\na,1\n,2\n");
  }
  const command = createCsvgrepCommand({ limits: { setEntries: 1 } }),
    bad = fixture(["-c", "x", "-f", "F"], input, { "/vfs/F": "a\nb\n" }),
    good = fixture(["-c", "x", "-f", "F"], input, { "/vfs/F": "a\n" });
  const results = await Promise.all([command.execute(bad.context), command.execute(good.context)]);
  assert.deepEqual(
    results.map((r) => r.exitCode),
    [1, 0]
  );
  assert.equal(bad.text(), "");
  assert.equal(good.text(), "x,id\na,1\n");
});
test("cleanup admission, blocked cooperative read, sink failure and falsey throw are preserved", async () => {
  const f = fixture(["-c", "x", "-m", "a"], "");
  let closeCount = 0,
    readSignal: AbortSignal | undefined;
  const fs = {
    readStream(_path: string, options: { signal: AbortSignal }) {
      assert.ok(f.cleanups.length);
      readSignal = options.signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) =>
                options.signal.addEventListener("abort", () => reject(options.signal.reason), {
                  once: true
                })
              );
            },
            async return() {
              closeCount++;
              return { done: true as const, value: undefined };
            }
          };
        }
      };
    }
  } as unknown as CommandContext["fs"];
  const run = createCsvgrepCommand().execute({
    ...f.context,
    args: ["-c", "x", "-m", "a", "data"],
    fs
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(readSignal);
  f.controller.abort("cancel");
  await assert.rejects(run, (e) => e === "cancel");
  assert.equal(closeCount, 1);
  await Promise.all(f.cleanups.map((c) => c()));
  const falsey = fixture(["-c", "x", "-m", "a"], base);
  await assert.rejects(
    createCsvgrepCommand().execute({
      ...falsey.context,
      stdout: {
        async write() {
          throw 0;
        }
      }
    }),
    (e) => e === 0
  );
  assert.equal(falsey.closed(), 1);
});
test("names stops after header across producer chunks", async () => {
  const f = fixture(["-n"], "");
  let advanced = false;
  const stdin = (async function* () {
    yield encoder.encode("x,y\n");
    advanced = true;
    yield encoder.encode("a,b\n");
  })();
  await createCsvgrepCommand().execute({ ...f.context, stdin });
  assert.equal(f.text(), "  1: x\n  2: y\n");
  assert.equal(advanced, false);
});
test("input cleanup failure retains the original falsey execution error", async () => {
  const f = fixture(["-c", "x", "-m", "a"], "");
  const stdin = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false as const, value: encoder.encode("x\n") };
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          throw false;
        }
      };
    }
  };
  await assert.rejects(
    createCsvgrepCommand().execute({
      ...f.context,
      stdin,
      stdout: {
        async write() {
          throw 0;
        }
      }
    }),
    (error) =>
      error instanceof AggregateError && error.errors.includes(0) && error.errors.includes(false)
  );
});
test("long equals options and missing values follow argument controls", async () => {
  const f = fixture(["--columns=x", "--match=a"], base);
  assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0);
  assert.equal(f.text(), "x,y,id\na,a,1\na,b,2\n");
  const missing = fixture(["-c", "x", "-m", "-a"], base);
  assert.equal((await createCsvgrepCommand().execute(missing.context)).exitCode, 2);
  assert.equal(missing.text(), "");
  const negative = fixture(["--columns=x", "--match=-a"], "x\n-a\na\n");
  assert.equal((await createCsvgrepCommand().execute(negative.context)).exitCode, 0);
  assert.equal(negative.text(), "x\n-a\n");
});
test("independent empty-mode controls preserve headers and precedence", async () => {
  for (const [flags, expected] of [
    [["-m", ""], base],
    [["-m", "", "-a"], "x,y,id\n"],
    [["-m", "", "-i"], "x,y,id\n"],
    [["-m", "", "-a", "-i"], base],
    [["-r", ""], base],
    [["-r", "", "-a"], "x,y,id\n"],
    [["-r", "", "-m", "a"], "x,y,id\na,a,1\na,b,2\n"],
    [["-r", "", "-f", "F", "-m", "a"], "x,y,id\nb,a,3\nb,b,4\n"],
    [["-f", "empty"], "x,y,id\n"]
  ] as const) {
    const f = fixture(["-c", "x", ...flags], base, { "/vfs/F": "b\n", "/vfs/empty": "" });
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0);
    assert.equal(f.text(), expected);
  }
});
test("versioned profile rejects unqualified codecs, quoting modes and open ranges before output", async () => {
  for (const flags of [
    ["-e", "latin1"],
    ["-u", "1"],
    ["-u", "2"],
    ["-c", "1-"]
  ]) {
    const f = fixture(["-c", "x", "-m", "a", ...flags], base);
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 1);
    assert.equal(f.text(), "");
  }
});
test("producer constructor and species callbacks are never used to slice input", async () => {
  const f = fixture(["-c", "x", "-m", "a"], "");
  const bytes = encoder.encode("x\na\n");
  Object.defineProperty(bytes, "constructor", {
    get() {
      throw new Error("Producer constructor accessed");
    }
  });
  await createCsvgrepCommand().execute({
    ...f.context,
    stdin: (async function* () {
      yield bytes;
    })()
  });
  assert.equal(f.text(), "x\na\n");
});
test("prototype-looking VFS basenames are literal operands, never inherited flag keys", async () => {
  for (const path of ["constructor", "toString", "__proto__"]) {
    const f = fixture(["-c", "x", "-m", "a", path], "", { [`/vfs/${path}`]: "x\na\n" });
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0);
    assert.equal(f.reads(), 1);
    assert.equal(f.text(), "x\na\n");
  }
});
test("SDK dialect strings consume the same argument budget as CLI values", async () => {
  const f = fixture([], "x\na\n");
  const result = await csvgrep(
    f.context,
    { columns: "x", match: "a", dialect: { delimiter: ",", quote: '"', escape: "\\" } },
    { limits: { argumentBytes: 4 } }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(f.text(), "");
  assert.equal(f.error(), "error: argumentBytes limit exceeded\n");
});
test("dialect boolean options reject attached values", async () => {
  for (const option of ["--tabs=false", "--no-doublequote=false", "--skipinitialspace=false"]) {
    const f = fixture(["-c", "x", "-m", "a", option], "x\na\n");
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 2);
    assert.equal(f.text(), "");
    assert.equal(
      f.error(),
      `error: ${option.slice(0, option.indexOf("="))} does not accept a value\n`
    );
  }
});
test("headerless names after z repeat letters; multiline headers retain physical numbering", async () => {
  const row = Array.from({ length: 28 }, (_, i) => String(i)).join(",");
  const f = fixture(["-H", "-c", "bb,aa", "-m", "2"], `${row}\n`);
  assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0);
  assert.equal(
    f.text(),
    "abcdefghijklmnopqrstuvwxyz".split("").concat("aa", "bb").join(",") + `\n${row}\n`
  );
  const multiline = fixture(["-c", "id", "-m", "a", "-l"], '"x\ny",id\nv,a\n');
  assert.equal((await createCsvgrepCommand().execute(multiline.context)).exitCode, 0);
  assert.equal(multiline.text(), 'line_numbers,"x\ny",id\n2,v,a\n');
});
test("skip-lines uses integer argument grammar rather than JavaScript number syntax", async () => {
  for (const value of ["0x1", "0b1", "1e0", "1.0", " ", "1__0", "_1", "1_"]) {
    const f = fixture(["-c", "x", "-m", "a", `--skip-lines=${value}`], "ignored\nx\na\n");
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 2, value);
    assert.equal(f.text(), "", value);
    assert.equal(f.error(), "error: Invalid skip-lines value\n", value);
    assert.equal(f.closed(), 0, "invalid arguments must not acquire stdin");
  }
  for (const value of ["1", "+01", "\u00a01\t", "0_1"]) {
    const f = fixture(["-c", "x", "-m", "a", `--skip-lines=${value}`], "ignored\nx\na\n");
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 0, value);
    assert.equal(f.text(), "x\na\n", value);
  }
});
test("skip-lines decimal conversion preserves integers at the safe-number boundary", () => {
  for (const [source, expected] of [
    ["9007199254740989", 9007199254740989],
    ["9007199254740991", Number.MAX_SAFE_INTEGER]
  ] as const) {
    const budget = new CsvBudget({}, new AbortController().signal);
    assert.equal(parseCsvgrepArguments([`--skip-lines=${source}`], budget).dialect?.skipLines, expected);
  }
  assert.throws(() => parseCsvgrepArguments(
    ["--skip-lines=9007199254740992"], new CsvBudget({}, new AbortController().signal)
  ), { code: "ARGUMENT" });
});

test("grouped flags and attached values preserve CLI/SDK parity and literal operands", async () => {
  for (const args of [
    ["-ai", "-cx,y", "-ma"],
    ["-aicx,y", "-ma"],
    ["-c", "x,y", "-aim", "a"]
  ]) {
    const cli = fixture(args, base), sdk = fixture([], base);
    assert.equal((await createCsvgrepCommand().execute(cli.context)).exitCode, 0);
    assert.equal((await csvgrep(sdk.context, { columns: "x,y", match: "a", any: true, invert: true })).exitCode, 0);
    assert.equal(cli.text(), "x,y,id\nb,b,4\n");
    assert.deepEqual(cli.out, sdk.out);
    assert.equal(cli.error(), "");
  }
  assert.equal(parseCsvgrepArguments(["-c=x"], new CsvBudget({}, new AbortController().signal)).columns, "=x");
  const literal = fixture(["-cx", "-m-a", "--", "-ai"], "", { "/vfs/-ai": "x\n-a\nb\n" });
  assert.equal((await createCsvgrepCommand().execute(literal.context)).exitCode, 0);
  assert.equal(literal.text(), "x\n-a\n");
  const dialect = fixture(["-tcx", "-ma", "-d;"], "x\ty\na\tb\n");
  assert.equal((await createCsvgrepCommand().execute(dialect.context)).exitCode, 0);
  assert.equal(dialect.text(), "x,y\na,b\n");
  for (const args of [["-ax"], ["-aic"]]) {
    const f = fixture(args, base);
    assert.equal((await createCsvgrepCommand().execute(f.context)).exitCode, 2);
    assert.equal(f.text(), "");
  }
});

test("csvgrep -n flushes a single-line header without trailing newline and accepts negative numeric option values", async () => {
  const eofHeader = fixture(["-n"], "name,n");
  assert.equal((await createCsvgrepCommand().execute(eofHeader.context)).exitCode, 0, eofHeader.error());
  assert.equal(eofHeader.text(), "  1: name\n  2: n\n");

  const openStart = fixture(["-c", "-1", "-m", "1"], "a,b\n1,-5\n2,3\n");
  assert.equal((await createCsvgrepCommand().execute(openStart.context)).exitCode, 0, openStart.error());
  assert.equal(openStart.text(), "a,b\n1,-5\n");

  const negMatch = fixture(["-c", "2", "-m", "-5"], "a,b\n1,-5\n2,3\n");
  assert.equal((await createCsvgrepCommand().execute(negMatch.context)).exitCode, 0, negMatch.error());
  assert.equal(negMatch.text(), "a,b\n1,-5\n");

  const negRegex = fixture(["-c", "2", "-r", "-5"], "a,b\n1,-5\n2,3\n");
  assert.equal((await createCsvgrepCommand().execute(negRegex.context)).exitCode, 0, negRegex.error());
  assert.equal(negRegex.text(), "a,b\n1,-5\n");
});
