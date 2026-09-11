import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Volume } from "memfs";
import { CommandRegistry, createCommandArguments, FsError, toByteSource, type ByteSource, type CommandContext, type FileStat, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { shufCommand } from "../../src/commands/shuf.js";

function fixture(files: Record<string, Uint8Array> = {}) {
  const volume = Volume.fromJSON({ "/work": null });
  for (const [name, bytes] of Object.entries(files)) volume.writeFileSync(`/work/${name}`, bytes);
  const fs = new MemoryFileSystem();
  const convert = (error: unknown): never => { throw new FsError((error as FsError).code); };
  fs.openReadFile = async path => {
    let descriptor: number;
    try { descriptor = volume.openSync(path, "r"); } catch (error) { return convert(error); }
    return {
      async stat(): Promise<FileStat> { const stat = volume.fstatSync(descriptor); return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode), atimeMs: Number(stat.atimeMs), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs) }; },
      async read(position, maximum) { try { const bytes = new Uint8Array(maximum); const length = volume.readSync(descriptor, bytes, 0, maximum, position); return bytes.subarray(0, length); } catch(error) { return convert(error); } },
      async close() { volume.closeSync(descriptor); },
    };
  };
  fs.writeFile = async (path, bytes) => { try { volume.writeFileSync(path, bytes); } catch(error) { convert(error); } };
  fs.writeStream = async (path, source) => {
    let descriptor: number;
    try { descriptor = volume.openSync(path, "w"); } catch(error) { return convert(error); }
    try { for await (const bytes of source) volume.writeSync(descriptor, bytes); } finally { volume.closeSync(descriptor); }
  };
  return { fs, volume };
}

async function shuffle(args: readonly string[], input: string | Uint8Array = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "shuf", args, cwd: "/work", env: {LC_ALL:"C"}, fs: fixture().fs,
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  const result = await shufCommand().execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

test("shuf preserves a single unterminated input record", async () => {
  assert.deepEqual(await shuffle([], "hello"), {exitCode:0,stdout:Buffer.from("hello\n"),stderr:Buffer.alloc(0)});
});

test("shuf matches GNU 8.30 immutable byte snapshots with the same random-source bytes", async () => {
  const snapshot = JSON.parse(readFileSync(new URL("./shuf-native.snapshot.json", import.meta.url), "utf8")) as {
    cases: {args:string[];stdin:string;files:Record<string,string>;env:Record<string,string>;expected:{exitCode:number;stdout:string;stderr:string;files:Record<string,string>}}[];
  };
  for (const [index, entry] of snapshot.cases.entries()) {
    const {fs,volume} = fixture(Object.fromEntries(Object.entries(entry.files).map(([name,bytes]) => [name,Buffer.from(bytes,"base64")])));
    assert.deepEqual(await shuffle(entry.args,Buffer.from(entry.stdin,"base64"),{fs,env:{LC_ALL:"C",...entry.env}}), {
      exitCode:entry.expected.exitCode,stdout:Buffer.from(entry.expected.stdout,"base64"),stderr:Buffer.from(entry.expected.stderr,"base64"),
    }, `case ${index}: ${JSON.stringify(entry.args)}`);
    for(const [name,bytes] of Object.entries(entry.expected.files)) assert.deepEqual(volume.readFileSync(`/work/${name}`),Buffer.from(bytes,"base64"),`case ${index} file ${name}`);
  }
});

test("shuf admits actual UTF-8 argument bytes before materializing argv", async () => {
  const result = await shuffle(["-e", "€".repeat(22000)]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.toString(), "shuf: argument limit exceeded\n");
});

test("shuf admits raw argv by its owned bytes, not replacement-character display size", async () => {
  const bytes = new Uint8Array(30000).fill(255);
  const argumentValues = createCommandArguments(["-e", shellValueFromBytes(bytes)]);
  const result = await shuffle(argumentValues.args, "", { argumentValues });
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.concat([bytes, Buffer.from("\n")]), stderr: Buffer.alloc(0) });
});

test("shuf preserves immutable raw echo arguments and rejects lossy filename aliases", async () => {
  const carrier = createCommandArguments(["-e", shellValueFromBytes(Uint8Array.of(255,128))]);
  assert.deepEqual((await shuffle(carrier.args, "", { argumentValues: carrier })).stdout, Buffer.from([255,128,10]));
  const invalid = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const {fs} = fixture({"�":Buffer.from("must not read")});
  assert.equal((await shuffle(invalid.args,"",{fs,argumentValues:invalid})).exitCode,1);
});

test("shuf copies reused input and random-source buffers before advancement or retirement", async () => {
  const storage = Buffer.alloc(2);
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    try { for (const text of ["a\n","b\n","c\n"]) { storage.write(text); yield storage; } }
    finally { storage.fill(255); }
  } };
  const {fs} = fixture({rng:Buffer.alloc(64)});
  assert.deepEqual((await shuffle(["--random-source=rng"],"",{fs,stdin})).stdout,Buffer.from("a\nb\nc\n"));
});

test("shuf cleanup waits for a retained read that outlives cancellation", async () => {
  const {fs} = fixture();
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const released = new Promise<void>(resolve => { finish = resolve; });
  let closed = 0, readFinished = false;
  fs.openReadFile = async () => ({
    async stat() { return {type:"file",size:2,mode:0,atimeMs:0,mtimeMs:0,ctimeMs:0}; },
    async read() { start(); await released; readFinished = true; return Buffer.from("a\n"); },
    async close() { assert.equal(readFinished,true,"retained handle closed before its admitted read settled"); closed++; },
  });
  const controller = new AbortController();
  let cleanup: InvocationCleanup | undefined;
  const pending = shuffle(["input"],"",{fs,signal:controller.signal,registerCleanup(handler) { cleanup = handler; }});
  let settled = false;
  const observed = pending.then(() => { settled = true; return "resolved"; }, reason => { settled = true; return reason; });
  await started;
  controller.abort(false);
  const drain = cleanup!();
  await new Promise<void>(resolve => setImmediate(resolve));
  const earlySettlement = settled;
  finish();
  assert.equal(await observed,false);
  await drain;
  assert.equal(earlySettlement,false,"execution settled before retained read cleanup");
  assert.equal(closed,1);
});

for (const reason of [false, 0, "", null]) test(`shuf preserves falsey cancellation ${String(reason)} during retained acquisition`, async () => {
  const {fs} = fixture();
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  const controller = new AbortController();
  let cleanup: InvocationCleanup | undefined, closed = 0;
  fs.openReadFile = async () => { assert.ok(cleanup); start(); await release; return {
    async stat() { throw new Error("stat after cancellation"); }, async read() { throw new Error("read after cancellation"); }, async close() {closed++;},
  }; };
  const pending = shuffle(["input"],"",{fs,signal:controller.signal,registerCleanup(handler) {cleanup=handler;}});
  const observed = pending.then(() => "resolved", error => error);
  await started; controller.abort(reason); finish();
  assert.equal(await observed,reason);
  await cleanup!(); await cleanup!();
  assert.equal(closed,1);
});

test("shuf bounds range, output count, and unbounded repetition without opening input", async () => {
  for (const args of [["-r"],["-r","-n1048577"],["-i0-1048576"],["-i1-18446744073709551615","-n1"],["-i1-18446744073709551615","-r","-n1"]]) {
    let reads=0;
    const result = await shuffle(args,"",{stdin:{async *[Symbol.asyncIterator]() {reads++;yield Buffer.from("a");}}});
    assert.equal(result.exitCode,1); assert.equal(reads,0);
  }
});

test("shuf detects oversized and empty producer input and retires once", async () => {
  for(const oversized of [true,false]) {
    let closed=0;
    const result=await shuffle([],"",{stdin:{[Symbol.asyncIterator]() {return {
      async next() {return {done:false,value:new Uint8Array(oversized ? 32*1024*1024+1 : 0)};},
      async return() {closed++; return {done:true,value:undefined};},
    };}}});
    assert.equal(result.exitCode,1); assert.equal(closed,1);
    assert.equal(result.stderr.toString(),oversized ? "shuf: byte command input limit exceeded\n" : "shuf: empty input chunk limit exceeded\n");
  }
});

test("shuf opens the random source before reservoir reads, including zero-count file bypass", async () => {
  const {fs}=fixture(); let reads=0;
  const stdin:ByteSource={ [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { reads++; throw new FsError("EIO"); } }; } };
  for(const args of [["-n0","missing"],["-n1"]]) {
    const result=await shuffle([...args,"--random-source=missing"],"",{fs,stdin});
    assert.equal(result.stderr.toString(),"shuf: missing: No such file or directory\n");
  }
  assert.equal(reads,0);
});

test("shuf preserves primary falsey input failure over secondary retirement failure", async () => {
  const reported:unknown[]=[];
  const result=await shuffle([],"",{stdin:{[Symbol.asyncIterator]() {return {
    async next():Promise<IteratorResult<Uint8Array>> {throw false;},
    async return():Promise<IteratorResult<Uint8Array>> {throw new Error("secondary");},
  };}},onInternalError(error) {reported.push(error);}});
  assert.equal(result.exitCode,1); assert.deepEqual(reported,[false]);
});

test("shuf uses the invocation-local seeded PRNG once and preserves permutations", async context => {
  let calls=0;
  context.mock.method(crypto,"getRandomValues",(state:Uint32Array) => {state.set([++calls,123456789,362436069,521288629]);return state;});
  const expected=Array.from({length:31},(_value,index)=>String(index));
  const permutations=new Set<string>();
  for(let trial=0;trial<20;trial++) {
    const result=await shuffle(["-i0-30"]);
    assert.equal(result.exitCode,0);
    assert.deepEqual(result.stdout.toString().trim().split("\n").sort(),[...expected].sort());
    permutations.add(result.stdout.toString());
  }
  assert.equal(calls,20); assert.ok(permutations.size>10);
});

test("shuf random-source exhaustive single-byte choices are exactly balanced", async () => {
  const histogram=[0,0,0,0];
  for(let byte=0;byte<256;byte++) {
    const {fs}=fixture({rng:Uint8Array.of(byte)});
    const result=await shuffle(["-i0-3","-n1","--random-source=rng"],"",{fs});
    assert.equal(result.exitCode,0);
    histogram[Number(result.stdout.toString())]!++;
  }
  assert.deepEqual(histogram,[64,64,64,64]);
});

test("shuf can be explicitly composed through Shell without global registration", async () => {
  const shell=new Shell({fs:fixture().fs,commands:new CommandRegistry([shufCommand()])});
  try { const result=await shell.exec("shuf -e hello"); assert.deepEqual([result.exitCode,result.stdout,result.stderr],[0,"hello\n",""]); }
  finally {await shell.dispose();}
});

interface NativeCase {
  name: string;
  args: string[];
  stdin: string;
  files: Record<string, string>;
  links: Record<string, string>;
  locale: string;
  stdinKind: string;
  expected: { status: number; stdout: string; stderr: string; files: Record<string, string>; stdinRemaining: string | null };
}

const independent = JSON.parse(readFileSync(new URL("./shuf-independent.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] };
const zeroRange = JSON.parse(readFileSync(new URL("./shuf-zero-range.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] };
for (const entry of [...independent.cases, ...zeroRange.cases]) test(`shuf GNU 8.30: ${entry.name}`, async () => {
  for (const chunkSize of [1, 65536]) {
    const { fs, volume } = fixture(Object.fromEntries(Object.entries(entry.files).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")])));
    for (const [name, target] of Object.entries(entry.links)) volume.linkSync(`/work/${target}`, `/work/${name}`);
    const input = Buffer.from(entry.stdin, "base64");
    let position = 0;
    const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
      if (entry.stdinKind === "directory") throw new FsError("EISDIR");
      while (position < input.length) {
        const bytes = Buffer.from(input.subarray(position, position + chunkSize));
        position += bytes.length;
        yield bytes;
      }
    } };
    const stdinInput: CommandContext["stdinInput"] = entry.stdinKind === "file" ? {
      stat: { type: "file", size: input.length, mode: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 },
      get position() { return position; },
      async read(maximum) {
        if (position === input.length) return { done: true, value: undefined };
        const bytes = Buffer.from(input.subarray(position, position + maximum));
        position += bytes.length;
        return { done: false, value: bytes };
      },
      async seek(offset) { position = offset; },
    } : undefined;
    const argumentValues = createCommandArguments(entry.args.map(bytes => shellValueFromBytes(Buffer.from(bytes, "base64"))));
    const actual = await shuffle(argumentValues.args, "", { fs, stdin, ...(stdinInput ? { stdinInput } : {}), argumentValues, env: { LC_ALL: entry.locale } });
    assert.deepEqual(actual, { exitCode: entry.expected.status, stdout: Buffer.from(entry.expected.stdout, "base64"), stderr: Buffer.from(entry.expected.stderr, "base64") }, `producer chunk size ${chunkSize}`);
    for (const [name, bytes] of Object.entries(entry.expected.files)) assert.deepEqual(volume.readFileSync(`/work/${name}`), Buffer.from(bytes, "base64"));
    if (zeroRange.cases.includes(entry)) assert.deepEqual(volume.readdirSync("/work").sort(), Object.keys(entry.expected.files).sort());
    if (entry.name.startsWith("zero-")) assert.equal(entry.stdinKind === "directory" ? null : input.subarray(position).toString("base64"), entry.expected.stdinRemaining);
  }
});

test("shuf zero selections allocate no cardinality-sized permutation storage", async context => {
  const allocations: number[] = [];
  context.mock.method(globalThis, "Uint32Array", new Proxy(Uint32Array, {
    construct(target, args, constructor) {
      allocations.push(args[0] ?? 0);
      assert.equal(args[0] ?? 0, 0, "zero selection must not allocate positive-length permutation storage");
      return Reflect.construct(target, args, constructor);
    },
  }));
  for (const args of [["-i0-1048575", "-n0"], ["-i1-18446744073709551615", "-n0"], ["-e", "a", "b", "-n0"]]) {
    assert.deepEqual(await shuffle(args), { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
  }
  assert.ok(allocations.every(length => length === 0));
});

for (const profile of [
  { args: [], status: 0, opens: 0, seeds: 0, closes: 0 },
  { args: ["--random-source=missing"], status: 0, opens: 0, seeds: 0, closes: 0 },
  { args: ["-r"], status: 0, opens: 0, seeds: 1, closes: 0 },
  { args: ["-r", "--random-source=missing"], status: 1, opens: 1, seeds: 0, closes: 0 },
  { args: ["-r", "--random-source=rng"], status: 0, opens: 1, seeds: 0, closes: 1 },
]) test(`shuf large zero-count range preserves entropy and reader admission: ${profile.args.join(" ")}`, async context => {
  const { fs } = fixture({ rng: new Uint8Array() });
  const originalOpen = fs.openReadFile;
  let opens = 0, reads = 0, closes = 0;
  fs.openReadFile = async (path, options) => {
    opens++;
    const handle = await originalOpen(path, options);
    return { ...handle,
      async read() { reads++; throw new Error("zero count consumed random bytes"); },
      async close() { closes++; await handle.close(); },
    };
  };
  const entropy = context.mock.method(crypto, "getRandomValues", (state: Uint32Array) => { state.fill(1); return state; });
  const result = await shuffle(["-i1-18446744073709551615", "-n0", ...profile.args], "", { fs });
  assert.equal(result.exitCode, profile.status);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(result.stderr, profile.status === 0 ? Buffer.alloc(0) : Buffer.from("shuf: missing: No such file or directory\n"));
  assert.deepEqual({ opens, reads, closes, seeds: entropy.mock.callCount() }, { opens: profile.opens, reads: 0, closes: profile.closes, seeds: profile.seeds });
});

const diagnostics = JSON.parse(readFileSync(new URL("./shuf-diagnostics.snapshot.json", import.meta.url), "utf8")) as {
  results: { args: string[]; expected: { status: number; stdout: string; stderr: string } }[];
};
for (const entry of diagnostics.results) test(`shuf native diagnostic ${JSON.stringify(entry.args)}`, async () => {
  assert.deepEqual(await shuffle(entry.args), { exitCode: entry.expected.status, stdout: Buffer.from(entry.expected.stdout, "base64"), stderr: Buffer.from(entry.expected.stderr, "base64") });
});

for (const [args, expected] of [
  [["-e"], ""], [["-e", "only"], "only\n"], [["-e", "-n0", "--random-source=missing"], ""],
  [["-i7-7"], "7\n"], [["-i2-1"], ""], [["-i7-9", "-n0"], ""],
] as const) test(`shuf skips zero-bound entropy admission ${args.join(" ")}`, async context => {
  const entropy = context.mock.method(crypto, "getRandomValues", () => { throw new Error("unexpected entropy acquisition"); });
  assert.deepEqual(await shuffle(args), { exitCode: 0, stdout: Buffer.from(expected), stderr: Buffer.alloc(0) });
  assert.equal(entropy.mock.callCount(), 0);
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`shuf retains primary ${String(reason)} when final cleanup fails`, async () => {
  const { fs } = fixture({ rng: Uint8Array.of(0), input: Buffer.from("a\nb\n") });
  const open = fs.openReadFile!.bind(fs);
  fs.openReadFile = async (...args) => {
    const handle = await open(...args);
    return { ...handle, async close() { await handle.close(); if (args[0].endsWith("/rng")) throw new Error("secondary cleanup"); } };
  };
  const reported: unknown[] = [];
  const result = await shuffle(["input", "--random-source=rng"], "", { fs, stdout: { async write() { throw reason; } }, onInternalError(error) { reported.push(error); } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(reported, [reason]);
});

test("shuf surfaces sole final cleanup failure without replacing it", async () => {
  const { fs } = fixture({ rng: Uint8Array.of(0) });
  const open = fs.openReadFile!.bind(fs);
  fs.openReadFile = async (...args) => {
    const handle = await open(...args);
    return { ...handle, async close() { await handle.close(); throw false; } };
  };
  const result = await shuffle(["-e", "a", "b", "--random-source=rng"], "", { fs }).then(() => "unexpected success", reason => reason);
  assert.equal(result, false);
});

test("shuf matches byte-exact native C and UTF-8 quoting across raw argv", async () => {
  const snapshot = JSON.parse(readFileSync(new URL("./shuf-quoting.snapshot.json", import.meta.url), "utf8")) as {
    cases: { sourceIndex: number; args: string[]; stdin: string; raw: boolean; env: Record<string, string>; expected: { exitCode: number; stdout: string; stderr: string } }[];
  };
  for (const entry of snapshot.cases) {
    const argumentValues = createCommandArguments(entry.args.map(text => entry.raw ? shellValueFromBytes(Buffer.from(text, "latin1")) : text));
    assert.deepEqual(await shuffle(argumentValues.args, Buffer.from(entry.stdin, "base64"), { argumentValues, env: { LC_ALL: "C", ...entry.env } }), {
      exitCode: entry.expected.exitCode, stdout: Buffer.from(entry.expected.stdout, "base64"), stderr: Buffer.from(entry.expected.stderr, "base64"),
    }, `native case ${entry.sourceIndex}`);
  }
});

for (const snapshotName of ["shuf-quote-pairs.snapshot.json", "shuf-ascii-quoting.snapshot.json"]) {
  const quotePairs = JSON.parse(readFileSync(new URL(`./${snapshotName}`, import.meta.url), "utf8")) as { cases: NativeCase[] };
  for (const locale of ["C", "C.UTF-8"]) test(`shuf gnulib quote compatibility in ${locale}: ${snapshotName}`, async () => {
    for (const entry of quotePairs.cases.filter(entry => entry.locale === locale)) {
      for (const chunkSize of [1, 65536]) {
        const { fs, volume } = fixture(Object.fromEntries(Object.entries(entry.files).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")])));
        const argumentValues = createCommandArguments(entry.args.map(bytes => shellValueFromBytes(Buffer.from(bytes, "base64"))));
        const input = Buffer.from(entry.stdin, "base64");
        const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < input.length; offset += chunkSize) yield Buffer.from(input.subarray(offset, offset + chunkSize));
        } };
        assert.deepEqual(await shuffle(argumentValues.args, "", { fs, stdin, argumentValues, env: { LC_ALL: locale } }), {
          exitCode: entry.expected.status, stdout: Buffer.from(entry.expected.stdout, "base64"), stderr: Buffer.from(entry.expected.stderr, "base64"),
        }, `${entry.name}, producer chunk size ${chunkSize}`);
        for (const [name, bytes] of Object.entries(entry.expected.files)) assert.deepEqual(volume.readFileSync(`/work/${name}`), Buffer.from(bytes, "base64"));
        assert.deepEqual(volume.readdirSync("/work").sort(), Object.keys(entry.files).sort(), "no extra output files");
      }
    }
  });
}

for (const phase of ["capabilities", "path-stat", "retained-open", "reentrant-open", "retained-stat", "retained-read"] as const) {
  for (const input of ["ordinary", "random"] as const) {
    for (const rejects of phase === "capabilities" || phase === "path-stat" ? [false, true] : [false]) {
      test(`shuf public cancellation distinguishes ${phase} from reader ownership: ${input}, rejects ${rejects}`, async () => {
        const { fs } = fixture();
        const controller = new AbortController();
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        const released = new Promise<void>(resolve => { release = resolve; });
        const opaque = phase === "capabilities" || phase === "path-stat";
        let opens = 0, handleStats = 0, reads = 0, closes = 0, settled = false, disposed = false;
        let cleanup: InvocationCleanup | undefined;
        let cleanupStarted = false, cleanupSettled = false, sameCleanup = true;
        Object.assign(fs, { capabilitiesFor: async () => {
          if (phase === "capabilities") { enter(); await released; if (rejects) throw false; }
          return fs.capabilities;
        } });
        const stat: FileStat = { type: "file", size: 4, mode: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
        fs.openReadFile = async () => {
          opens++;
          if (phase === "retained-open" || phase === "reentrant-open") {
            if (phase === "reentrant-open") { controller.abort(false); sameCleanup = cleanup!() === cleanup!(); }
            enter();
            await released;
          }
          return {
            async stat() { handleStats++; if (phase === "retained-stat") { enter(); await released; } return stat; },
            async read() { reads++; if (phase === "retained-read") { enter(); await released; } return Buffer.from("a\nb\n"); },
            async close() { closes++; },
          };
        };
        if (phase === "path-stat") {
          Object.defineProperty(fs, "openReadFile", { value: undefined });
          fs.stat = async () => { enter(); await released; if (rejects) throw false; return stat; };
        }
        fs.readStream = () => { opens++; throw new Error("late stream acquisition"); };
        const definition = shufCommand();
        const command = { ...definition, execute(context: CommandContext) {
          return definition.execute({ ...context, registerCleanup(handler) {
            cleanup = handler;
            context.registerCleanup?.(() => {
              cleanupStarted = true;
              const closing = handler();
              void Promise.resolve(closing).then(() => { cleanupSettled = true; }, () => { cleanupSettled = true; });
              return closing;
            });
          } });
        } };
        const shell = new Shell({ fs, commands: new CommandRegistry([command]) });
        const execution = shell.exec(input === "ordinary" ? "shuf file" : "shuf -e a b --random-source=rng", { signal: controller.signal })
          .then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
        await entered;
        controller.abort(false);
        const disposing = shell.dispose().then(() => { disposed = true; });
        for (let turn = 0; turn < 3; turn++) await new Promise<void>(resolve => setImmediate(resolve));
        const beforeRelease = { opens, handleStats, reads, closes, settled, disposed, cleanupStarted, cleanupSettled };
        release();
        const outcome = await execution;
        await disposing;
        assert.ok("error" in outcome);
        assert.equal(outcome.error, false);
        assert.equal(beforeRelease.cleanupStarted, true);
        assert.equal(beforeRelease.settled, opaque, "opaque metadata must not postpone exec; owned work must postpone it");
        assert.equal(beforeRelease.disposed, opaque, "dispose must drain only admitted owned work");
        assert.equal(beforeRelease.cleanupSettled, opaque);
        assert.equal(beforeRelease.closes, 0);
        assert.equal(opens, opaque ? 0 : 1);
        assert.equal(closes, opaque ? 0 : 1);
        assert.equal(handleStats, phase === "retained-stat" || phase === "retained-read" ? 1 : 0);
        assert.equal(reads, phase === "retained-read" ? 1 : 0);
        assert.equal(sameCleanup, true);
        assert.equal(cleanup!(), cleanup!(), "cleanup keeps its completion identity");
        await cleanup!();
        assert.equal(closes, opaque ? 0 : 1);
      });
    }
  }
}

for (const input of ["ordinary", "random"]) test(`shuf closes reader admission during reentrant metadata cleanup: ${input}`, async () => {
  const { fs } = fixture();
  let cleanup: InvocationCleanup | undefined;
  let closing: void | Promise<void> | undefined;
  let opens = 0;
  Object.assign(fs, { capabilitiesFor: async () => { closing = cleanup!(); return fs.capabilities; } });
  fs.openReadFile = async () => { opens++; throw new Error("opened after owner cleanup"); };
  const outcome = await shuffle(input === "ordinary" ? ["file"] : ["-e", "a", "b", "--random-source=rng"], "", {
    fs, registerCleanup(handler) { cleanup = handler; },
  }).then(result => ({ result }), error => ({ error }));
  await closing;
  assert.equal(opens, 0);
  assert.ok("error" in outcome || outcome.result.exitCode !== 0);
  assert.equal(cleanup!(), cleanup!());
});
