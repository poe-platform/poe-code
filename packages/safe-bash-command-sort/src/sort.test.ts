import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setImmediate as nextTurn } from "node:timers/promises";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { type ByteSource, type CommandContext, toByteSource } from "safe-bash-contracts";
import { createSortCommand } from "./index.js";
import { SortRecord, SortStorage, defaultSortLimits } from "./records.js";
import { SortWork } from "./work.js";
import { SortRuns } from "./runs.js";
import { mergeRecords } from "./merge.js";

async function context(args: readonly string[] = []): Promise<CommandContext & { output: Uint8Array[]; errors: Uint8Array[] }> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  return {
    command: "sort", args, fs, cwd: "/work", env: { LC_ALL: "C" }, signal: new AbortController().signal,
    stdin: toByteSource(""), output, errors,
    stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } },
    onInternalError(error) { throw error; },
  };
}

for (const [args, stdin, stdout] of [
  [["-n", "-T", "/tmp"], "3\n1\n2\n", "1\n2\n3\n"],
  [["--temporary-directory=/tmp"], "b\na\n", "a\nb\n"],
  [["--compress-program=gzip"], "b\na\n", "a\nb\n"],
  [["-T/scratch"], "b\na\n", "a\nb\n"],
  [["--temporary-directory", "/scratch"], "b\na\n", "a\nb\n"],
  [["--compress-program", "gzip"], "b\na\n", "a\nb\n"],
] as const) {
  test(`accepts GNU scratch options: ${args.join(" ")}`, async () => {
    const ctx = await context(args);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(stdin) });
    assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
    assert.equal(Buffer.concat(ctx.output).toString(), stdout);
    assert.equal(Buffer.concat(ctx.errors).toString(), "");
  });
}

for (const option of ["-T", "--temporary-directory", "--compress-program"]) {
  test(`requires a value for ${option}`, async () => {
    const ctx = await context([option]);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource("b\na\n") });
    assert.equal(result.exitCode, 2);
    assert.equal(Buffer.concat(ctx.output).toString(), "");
    assert.match(Buffer.concat(ctx.errors).toString(), /requires an argument/);
  });
}

test("spilled runs use caller handles with bounded I/O and a slow sink", async t => {
  const ctx = await context(["-S", "1M"]);
  const fs = ctx.fs as MemoryFileSystem;
  t.mock.method(fs, "readFile", () => { throw new Error("payload-wide read forbidden"); });
  t.mock.method(fs, "writeFile", () => { throw new Error("payload-wide write forbidden"); });
  t.mock.method(SortRecord.prototype, "materialize", () => { throw new Error("payload materialization forbidden"); });
  const open = fs.open.bind(fs);
  let opened = 0, closed = 0, written = 0, read = 0, outstanding = 0, peak = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    opened++;
    const handle = await open(...args);
    return {
      ...handle, capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      async write(bytes: Uint8Array, ...rest: Parameters<typeof handle.write> extends [unknown, ...infer Tail] ? Tail : never) {
        assert.ok(bytes.length <= 16 * 1024);
        outstanding += bytes.length; peak = Math.max(peak, outstanding);
        try { written += bytes.length; return await handle.write(bytes, ...rest); }
        finally { outstanding -= bytes.length; }
      },
      async read(bytes: Uint8Array, ...rest: Parameters<typeof handle.read> extends [unknown, ...infer Tail] ? Tail : never) {
        assert.ok(bytes.length <= 16 * 1024);
        outstanding += bytes.length; peak = Math.max(peak, outstanding);
        try { read += bytes.length; return await handle.read(bytes, ...rest); }
        finally { outstanding -= bytes.length; }
      },
      async close(...args: Parameters<typeof handle.close>) { closed++; return handle.close(...args); },
    };
  });
  const row = new Uint8Array(4096).fill(120); row[row.length - 1] = 10;
  const makeRow = (i: number) => { row.set(new TextEncoder().encode(String(i).padStart(4, "0"))); return row; };
  const expected = createHash("sha256");
  for (let i = 0; i < 512; i++) expected.update(makeRow(i));
  const actual = createHash("sha256"); let bytes = 0, pendingWrites = 0;
  const stdin = (async function* () { for (let i = 511; i >= 0; i--) yield makeRow(i); row.fill(255); })();
  const stdout = { async write(chunk: Uint8Array) {
    assert.equal(pendingWrites++, 0);
    const owned = new Uint8Array(chunk);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(chunk, owned);
    actual.update(chunk); bytes += chunk.length; pendingWrites--;
  } };
  const result = await createSortCommand().execute({ ...ctx, stdin, stdout });
  assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
  assert.equal(bytes, 512 * 4096);
  assert.equal(actual.digest("hex"), expected.digest("hex"));
  assert.ok(opened > 0 && written > 1024 * 1024 && read > 0, "external backing must actually be exercised");
  assert.equal(closed, opened);
  assert.equal(outstanding, 0); assert.ok(peak <= 16 * 1024);
  assert.deepEqual(await fs.readdir("/work"), []);
  // This is an instrumented mock backing store, not a Worker heap measurement.
});

test("individual byte-ordered records may exceed the working-memory budget", async t => {
  const ctx = await context(["-S", "1M"]);
  t.mock.method(SortRecord.prototype, "materialize", () => { throw new Error("oversized record materialization forbidden"); });
  const chunk = new Uint8Array(8192).fill(97);
  const stdin = (async function* () {
    for (const end of [99, 98]) {
      for (let i = 0; i < 160; i++) yield chunk;
      yield Uint8Array.of(end, 10);
    }
    chunk.fill(255);
  })();
  const expected = createHash("sha256");
  for (const end of [98, 99]) { for (let i = 0; i < 160; i++) expected.update(chunk); expected.update(Uint8Array.of(end, 10)); }
  const actual = createHash("sha256");
  const result = await createSortCommand().execute({ ...ctx, stdin, stdout: { async write(bytes) { actual.update(bytes); } } });
  assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
  assert.equal(actual.digest("hex"), expected.digest("hex"));
  assert.deepEqual(await ctx.fs.readdir("/work"), []);
});

test("merge fan-in spills intermediate groups and preserves native stable key order", async () => {
  const ctx = await context(["-m", "-s", "-k1,1n", "--batch-size=2", "a", "b", "c", "d", "e"]);
  for (const name of ["a", "b", "c", "d", "e"]) await ctx.fs.writeFile(`/work/${name}`, new TextEncoder().encode(`1 ${name}\n2 ${name}\n`));
  const result = await createSortCommand().execute(ctx);
  assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
  assert.equal(Buffer.concat(ctx.output).toString(), "1 a\n1 b\n1 c\n1 d\n1 e\n2 a\n2 b\n2 c\n2 d\n2 e\n");
  assert.deepEqual((await ctx.fs.readdir("/work")).map(entry => entry.name), ["a", "b", "c", "d", "e"]);
});

test("sort modes match the native utility after the storage refactor", async () => {
  const stdin = "3 x\n1 b\n2 q\n1 a\n-9 z\n";
  for (const args of [[], ["-r"], ["-n"], ["-s", "-k1,1n"], ["-u", "-k1,1n"]]) {
    const expected = execFileSync("/usr/bin/sort", args, { input: stdin, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
    const ctx = await context(args);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(stdin) });
    assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
    assert.deepEqual(Buffer.concat(ctx.output), expected);
  }
});

for (const length of [0, 20_000]) for (const dots of [".", "..", "..."]) {
  test(`version archive suffixes restart after dots (${dots.length} dots, ${length} padding)`, async () => {
    const prefix = `${"a".repeat(length)}pkg-2${dots}`;
    const sorted = `${prefix}tar.gz\n${prefix}1\n`;
    const reversed = `${prefix}1\n${prefix}tar.gz\n`;
    for (const [args, stdin, exitCode, stdout] of [
      [["-V"], reversed, 0, sorted],
      [["-VC"], reversed, 1, ""],
      [["-VC"], sorted, 0, ""],
    ] as const) {
      const ctx = await context(args);
      const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(stdin) });
      assert.equal(result.exitCode, exitCode, args.join(" "));
      assert.equal(Buffer.concat(ctx.output).toString(), stdout);
      assert.equal(Buffer.concat(ctx.errors).toString(), "");
    }
  });
}

test("check input caps are independent of its memory budget", async () => {
  const ctx = await context(["-c", "--buffer-size=1M", "--max-input-bytes=5"]);
  const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource("a\nb\nc\n") });
  assert.equal(result.exitCode, 2);
  assert.match(Buffer.concat(ctx.errors).toString(), /input byte limit/);
});

test("merge closes all sources when its sink fails", async () => {
  const ctx = await context(["-m"]); let closed = false;
  const stdin: ByteSource = (async function* () { try { yield Uint8Array.of(97, 10); throw new Error("must not read ahead"); } finally { closed = true; } })();
  const failure = new Error("sink failure");
  const result = await createSortCommand().execute({ ...ctx, stdin, stdout: { write() { throw failure; } } });
  assert.equal(result.exitCode, 2);
  assert.equal(closed, true);
});

test("oversized keys and numeric modes compare without contiguous materialization", async t => {
  const pad = "0".repeat(20_000), letters = "a".repeat(20_000);
  t.mock.method(SortRecord.prototype, "materialize", function (this: SortRecord) {
    assert.ok(this.length <= 16 * 1024, "oversized materialization is forbidden");
    return Promise.resolve(this.bytes!);
  });
  for (const [args, first, second] of [
    [["-n"], `${pad}1`, `${pad}2`],
    [["-h"], `${pad}1K`, `${pad}2M`],
    [["-g"], `0.${pad}1e20001`, `0.${pad}2e20001`],
    [["-M"], ` ${" ".repeat(20_000)}Jan`, ` ${" ".repeat(20_000)}Feb`],
    [["-V"], `${letters}9`, `${letters}10`],
    [["-f"], `${letters}B`, `${letters}c`],
    [["-d"], `${letters}!b`, `${letters}c`],
    [["-i"], `${letters}\x01b`, `${letters}c`],
    [["-t", ":", "-k2,2n"], `x:${pad}1`, `x:${pad}2`],
  ] as const) {
    const ctx = await context(args);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(`${second}\n${first}\n`) });
    assert.equal(result.exitCode, 0, args.join(" ") + Buffer.concat(ctx.errors).toString());
    assert.equal(Buffer.concat(ctx.output).toString(), `${first}\n${second}\n`, args.join(" "));
  }
});

test("merge retires every owned head when heap comparison fails", async () => {
  const retired: number[] = []; let comparisons = 0;
  const failure = new Error("comparator failed");
  const sources = [1, 2, 3].map(value => (async function* () {
    yield new SortRecord(1, Uint8Array.of(value), undefined, 0, 0, () => { retired.push(value); if (value === 2) throw new Error("secondary cleanup failure"); });
  })());
  await assert.rejects(async () => {
    for await (const record of mergeRecords(sources, (a, b) => {
      if (++comparisons === 3) throw failure;
      return a.bytes![0]! - b.bytes![0]!;
    })) await record.close();
  }, error => error === failure);
  assert.deepEqual(retired.sort(), [1, 2, 3]);
});

test("registered cleanup cancels pending spill I/O and drains its handle", async t => {
  const ctx = await context(["-S", "1M"]);
  const fs = ctx.fs as MemoryFileSystem, open = fs.open.bind(fs);
  let closed = 0, writes = 0;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const cleanups: (() => void | Promise<void>)[] = [];
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    return {
      ...handle, capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), read: handle.read.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      write(_bytes: Uint8Array, _position: number | null, options?: { signal?: AbortSignal }) {
        writes++; started();
        return new Promise<number>((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async close(...args: Parameters<typeof handle.close>) { closed++; return handle.close(...args); },
    };
  });
  const stdin = (async function* () { const chunk = new Uint8Array(8192).fill(97); for (let i = 0; i < 10; i++) yield chunk; })();
  const pending = createSortCommand().execute({ ...ctx, stdin, registerCleanup(cleanup) { cleanups.push(cleanup); } });
  await writing;
  assert.equal(cleanups.length, 1, "cleanup must register before spill acquisition");
  await Promise.all([cleanups[0]!(), cleanups[0]!()]);
  const result = await pending;
  assert.equal(result.exitCode, 2);
  assert.equal(writes, 1); assert.equal(closed, 1);
  assert.deepEqual(await fs.readdir("/work"), []);
  assert.equal(ctx.output.length, 0);
});

test("general numeric whitespace semantics do not change at the spill threshold", async () => {
  for (const token of ["0x1p\t2", "0x1p\xa02", "\xa02", "\xa0Infinity", "\xa0inf", "\xa00x3", "1e\t2"]) {
    let expectedOrder: number | undefined;
    for (const length of [0, 20_000]) {
      const tail = Buffer.alloc(length, 120);
      const first = Buffer.concat([Buffer.from(token, "latin1"), tail, Buffer.from("\n")]);
      const second = Buffer.concat([Buffer.from("1\n").subarray(0, 1), tail, Buffer.from("\n")]);
      const ctx = await context(["-gs"]);
      const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(Buffer.concat([first, second])) });
      assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
      const actual = Buffer.concat(ctx.output);
      const order = actual.subarray(0, first.length).equals(first) ? 0 : 1;
      expectedOrder ??= order;
      assert.equal(order, expectedOrder, JSON.stringify(token));
    }
  }
});

test("output uses retained writes when the backend has no writeStream", async t => {
  const ctx = await context(["-m", "-o", "alias", "a", "b"]);
  await ctx.fs.writeFile("/work/a", Buffer.from("1\n3\n"));
  await ctx.fs.writeFile("/work/b", Buffer.from("2\n4\n"));
  await ctx.fs.link!("/work/a", "/work/alias");
  const fs = ctx.fs as MemoryFileSystem;
  const read = fs.readFile.bind(fs);
  const initial = await fs.stat("/work/a");
  t.mock.method(fs, "readFile", () => { throw new Error("whole file read forbidden"); });
  t.mock.method(fs, "writeFile", () => { throw new Error("whole file write forbidden"); });
  const adapter = new Proxy(fs, { get(target, key) {
    if (key === "writeStream" || key === "capabilitiesFor") return undefined;
    if (key === "capabilities") return { ...target.capabilities, streamingWrite: false };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await createSortCommand().execute({ ...ctx, fs: adapter });
  assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
  assert.equal(Buffer.from(await read("/work/a")).toString(), "1\n2\n3\n4\n");
  assert.notEqual(initial.ino, undefined);
  assert.equal((await fs.stat("/work/a")).ino, initial.ino);
  assert.equal((await fs.stat("/work/alias")).ino, initial.ino);
});

test("registered cleanup retires a cooperative pending input before settling", async () => {
  const ctx = await context(["-m"]);
  let started!: () => void, finish!: (result: IteratorResult<Uint8Array>) => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let closed = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(resolve => { finish = resolve; }); },
    async return() { closed++; finish({ done: true, value: undefined }); return { done: true, value: undefined }; },
  }; } };
  const pending = createSortCommand().execute({ ...ctx, stdin, registerCleanup(cleanup) { cleanups.push(cleanup); } });
  await reading;
  await cleanups[0]!();
  const result = await pending;
  assert.equal(result.exitCode, 2);
  assert.equal(closed, 1);
  assert.equal(ctx.output.length, 0);
});

for (const args of [[], ["-m"], ["-c"]]) for (const heldReturn of [false, true]) {
  test(`blocked input cancels ${JSON.stringify(args)} and ${heldReturn ? "drains" : "finishes"} retirement before a late rejection`, async () => {
    const ctx = await context(args), controller = new AbortController();
    let started!: () => void, rejectNext!: (reason: unknown) => void, releaseReturn!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const next = new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectNext = reject; });
    const returning = new Promise<void>(resolve => { releaseReturn = resolve; });
    const cleanups: (() => void | Promise<void>)[] = [];
    let returned = 0, settled = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { started(); return next; },
      async return() { returned++; if (heldReturn) await returning; return { done: true, value: undefined }; },
    }; } };
    const reason = heldReturn ? false : new Error("cancel blocked input");
    const pending = Promise.resolve(createSortCommand().execute({ ...ctx, stdin, signal: controller.signal,
      registerCleanup(cleanup) { cleanups.push(cleanup); } }));
    const observed = pending.then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
    await reading;
    controller.abort(reason);
    await nextTurn();
    const retiredBeforeLateRejection = returned;
    const settledBeforeLateRejection = settled;
    const closing = Promise.all(cleanups.map(cleanup => cleanup()));
    rejectNext(new Error("late producer rejection"));
    releaseReturn();
    const outcome = await observed;
    await closing;
    await nextTurn();
    assert.deepEqual(outcome, { error: reason });
    assert.equal(retiredBeforeLateRejection, 1);
    assert.equal(settledBeforeLateRejection, !heldReturn);
    assert.equal(returned, 1);
    assert.equal(ctx.output.length, 0);
    assert.equal(ctx.errors.length, 0);
  });
}

test("spooled records have no implicit legacy payload cap", async () => {
  const storage = new SortStorage(await context(), defaultSortLimits);
  try { storage.admitRecord(64 * 1024 * 1024); }
  finally { await storage.close(); }
});

test("run storage preserves a falsey write failure over record retirement", async t => {
  const storage = new SortStorage(await context(), defaultSortLimits);
  const backing = storage.acquire();
  t.mock.method(storage, "acquire", () => backing);
  t.mock.method(backing, "write", async () => { throw false; });
  const record = new SortRecord(1, Uint8Array.of(97), undefined, 0, 0, () => { throw new Error("retire"); });
  try {
    await assert.rejects(new SortRuns(storage, async () => 0).save((async function* () { yield record; })()), error => error === false);
  } finally { await storage.close(); }
});

test("comparison failure retires the full batch even after merge passes overwrite its array", async () => {
  const storage = new SortStorage(await context(), defaultSortLimits);
  const closed: number[] = [];
  const records = [4, 3, 2, 1].map(n => new SortRecord(1, Uint8Array.of(n), undefined, 0, 0, () => { closed.push(n); }));
  let comparisons = 0;
  const runs = new SortRuns(storage, async (a, b) => { if (++comparisons === 4) throw false; return a.bytes![0]! - b.bytes![0]!; });
  try {
    await assert.rejects(runs.sort((async function* () { yield* records; })(), new SortWork(storage.context.signal)), error => error === false);
    assert.deepEqual(closed.sort(), [1, 2, 3, 4]);
  } finally { await storage.close(); }
});

test("early output retirement closes every record even when one close fails", async () => {
  const storage = new SortStorage(await context(), defaultSortLimits);
  const failure = new Error("retire");
  const closed: number[] = [];
  const records = [1, 2, 3].map(n => new SortRecord(1, Uint8Array.of(n), undefined, 0, 0, () => {
    closed.push(n); if (n === 1) throw failure;
  }));
  try {
    const sorted = await new SortRuns(storage, async () => 0).sort((async function* () { yield* records; })(), new SortWork(storage.context.signal));
    const iterator = sorted[Symbol.asyncIterator]();
    await iterator.next();
    await assert.rejects(iterator.return!(), error => error === failure);
    assert.deepEqual(closed, [1, 2, 3]);
  } finally { await storage.close(); }
});

for (const flag of ["-R", "--random-sort", "--sort=random"]) {
  test(`random sort preserves records and groups duplicates (${flag})`, async () => {
    const ctx = await context([flag]);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource("a\nb\na\nc\nb\n") });
    assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
    const lines = Buffer.concat(ctx.output).toString().trimEnd().split("\n");
    assert.deepEqual([...lines].sort(), ["a", "a", "b", "b", "c"]);
    assert.equal(lines.lastIndexOf("a") - lines.indexOf("a"), 1);
    assert.equal(lines.lastIndexOf("b") - lines.indexOf("b"), 1);
  });
}

test("random sort uses a new seed per invocation and respects reverse order", async t => {
  let seed = 0;
  t.mock.method(Math, "random", () => seed);
  const input = "a\nb\nc\nd\ne\nf\ng\nh\n";
  const outputs: string[] = [];
  for (const [nextSeed, args] of [[0.1, ["-R"]], [0.8, ["-R"]], [0.1, ["-Rr"]]] as const) {
    seed = nextSeed;
    const ctx = await context(args);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(input) });
    assert.equal(result.exitCode, 0);
    outputs.push(Buffer.concat(ctx.output).toString());
  }
  assert.notEqual(outputs[0], outputs[1]);
  assert.equal(outputs[2], outputs[0]!.trimEnd().split("\n").reverse().join("\n") + "\n");
});

test("random keys preserve stable groups and unique keys across spilled runs", async t => {
  t.mock.method(Math, "random", () => 0.25);
  const lines = Array.from({ length: 80 }, (_, index) => `${index % 4}:${"x".repeat(4000)}:${index}`);
  for (const unique of [false, true]) {
    const ctx = await context(["-S1M", "-t:", "-k1,1R", unique ? "-u" : "-s"]);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(lines.join("\n") + "\n") });
    assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
    const output = Buffer.concat(ctx.output).toString().trimEnd().split("\n");
    const groups = [...new Set(output.map(line => line[0]))];
    assert.equal(groups.length, 4);
    assert.deepEqual(output, groups.flatMap(key => {
      const matching = lines.filter(line => line[0] === key);
      return unique ? matching.slice(0, 1) : matching;
    }));
    assert.deepEqual(await ctx.fs.readdir("/work"), []);
  }
});

test("random ordering is identical for resident and oversized records", async t => {
  t.mock.method(Math, "random", () => 0.5);
  const lines = ["a", "b", "c", "a"].map(key => key + "x".repeat(8000));
  const outputs: string[] = [];
  for (const budget of ["1M", "8M"]) {
    const ctx = await context(["-R", "-S", budget]);
    const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource(lines.join("\n") + "\n") });
    assert.equal(result.exitCode, 0, Buffer.concat(ctx.errors).toString());
    outputs.push(Buffer.concat(ctx.output).toString());
  }
  assert.equal(outputs[0], outputs[1]);
});

test("random and numeric ordering are incompatible", async () => {
  const ctx = await context(["-Rn"]);
  const result = await createSortCommand().execute({ ...ctx, stdin: toByteSource("1\n2\n") });
  assert.equal(result.exitCode, 2);
  assert.match(Buffer.concat(ctx.errors).toString(), /incompatible/);
});
