import assert from "node:assert/strict";
import test from "node:test";
import { FsError, Shell, standardCommands, type ByteSource, type FileSystem, type WriteFileOptions } from "../../src/index.js";
import { bufferLimit } from "../../src/commands/internal.js";
import { streamCommands } from "../../src/commands/streams.js";
import { chunks, fixture, run } from "./helpers.js";

async function observeByteTail(command: "head" | "tail", count: number, sizes: number[], kind: "Buffer" | "Uint8Array", reuse: boolean) {
  const NativeUint8Array = Uint8Array;
  const nativeSlice = NativeUint8Array.prototype.slice;
  const nativePush = Array.prototype.push;
  const owned = new WeakSet<Uint8Array>();
  let queue: Uint8Array[] | undefined;
  let copiedBytes = 0;
  let allocations = 0;
  let maxBacking = 0;
  let maxSlots = 0;
  let checkpoints = 0;
  const input = Buffer.alloc(sizes.reduce((total, size) => total + size, 0));
  for (let index = 0; index < input.length; index++) input[index] = (index * 29 + 137) % 256;
  const backing = kind === "Buffer" ? Buffer.alloc(Math.max(...sizes) + 6) : new NativeUint8Array(Math.max(...sizes) + 6);
  backing.fill(0x7e);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const fs = await fixture();
  let finalized = false;
  const source = (async function* () {
    let offset = 0;
    try {
      for (const size of sizes) {
        const expected = input.subarray(offset, offset + size);
        const chunk = reuse ? backing.subarray(3, 3 + size)
          : kind === "Buffer" ? Buffer.from(expected) : new NativeUint8Array(expected);
        if (reuse) chunk.set(expected);
        yield chunk;
        assert.deepEqual(Buffer.from(chunk), expected);
        const buffers = new Set(queue?.filter(Boolean).map(bytes => bytes.buffer));
        const retained = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
        maxBacking = Math.max(maxBacking, retained);
        maxSlots = Math.max(maxSlots, queue?.length ?? 0);
        checkpoints++;
        offset += size;
      }
    } finally {
      backing.fill(0);
      finalized = true;
    }
  })();
  globalThis.Uint8Array = new Proxy(NativeUint8Array, {
    construct(target, args) {
      const result = Reflect.construct(target, args) as Uint8Array;
      owned.add(result);
      allocations++;
      copiedBytes += result.byteLength;
      return result;
    },
  });
  NativeUint8Array.prototype.slice = function (start, end) {
    const result = nativeSlice.call(this, start, end);
    copiedBytes += result.byteLength;
    allocations++;
    return result;
  };
  Array.prototype.push = function <Entry>(this: Entry[], ...items: Entry[]): number {
    if (items.length === 1 && owned.has(items[0] as Uint8Array)) queue = this as Uint8Array[];
    return nativePush.apply(this, items);
  };
  let result;
  try {
    result = await streamCommands().find(definition => definition.name === command)!.execute({
      command, args: ["-c", `${command === "head" ? "-" : ""}${count}`], cwd: "/work", env: {}, fs,
      signal: new AbortController().signal, stdin: source,
      stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    });
  } finally {
    globalThis.Uint8Array = NativeUint8Array;
    NativeUint8Array.prototype.slice = nativeSlice;
    Array.prototype.push = nativePush;
  }
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.deepEqual(Buffer.concat(stdout), command === "head"
    ? input.subarray(0, Math.max(0, input.length - count)) : input.subarray(input.length - Math.min(count, input.length)));
  assert.equal(finalized, true);
  assert.equal(checkpoints, sizes.length);
  assert.ok(queue, "observation must capture the owned queue");
  return { copiedBytes, allocations, maxBacking, maxSlots, inputBytes: input.length };
}

for (const command of ["head", "tail"] as const) {
  for (const kind of ["Buffer", "Uint8Array"] as const) {
    for (const reuse of [false, true]) {
      test(`${command} byte trimming has linear copies for ${reuse ? "reused" : "immutable"} ${kind}`, async () => {
        for (const count of [37, 131, 521]) {
          const sizes = [count, ...Array<number>(count + 13).fill(1)];
          const observed = await observeByteTail(command, count, sizes, kind, reuse);
          assert.ok(observed.copiedBytes <= 2 * observed.inputBytes, JSON.stringify(observed));
          assert.ok(observed.allocations <= 2 * sizes.length, JSON.stringify(observed));
          assert.ok(observed.maxBacking <= 2 * count, JSON.stringify(observed));
          assert.ok(observed.maxSlots <= 1025 + count, JSON.stringify(observed));
        }
      });
    }
    test(`${command} byte queue releases oversized and consumed ${kind} backing with zero/empty controls`, async () => {
      for (const count of [0, 1, 37]) {
        const sizes = [0, 24577, 0, 24577, 0, 47, ...Array<number>(2051).fill(0), 59];
        const observed = await observeByteTail(command, count, sizes, kind, true);
        assert.ok(observed.maxBacking <= 2 * count, JSON.stringify(observed));
        assert.ok(observed.maxSlots <= 1025 + count, JSON.stringify(observed));
        assert.ok(observed.copiedBytes <= 2 * observed.inputBytes, JSON.stringify(observed));
      }
    });
  }
}

for (const kind of ["Buffer", "Uint8Array"] as const) {
  for (const [command, args, expected] of [
    ["tail", ["-c", "4"], [195, 169, 65, 10]],
    ["tail", ["-n", "1"], [0, 255, 195, 169, 65, 10]],
    ["head", ["-c", "-2"], [0, 255, 195, 169]],
  ] as const) {
    test(`${command} ${args.join(" ")} owns borrowed ${kind} readStream windows`, async () => {
      const fs = await fixture({ input: "fixture" });
      const controller = new AbortController();
      const backing = kind === "Buffer" ? Buffer.alloc(11, 0x7e) : new Uint8Array(11).fill(0x7e);
      const window = backing.subarray(4, 7);
      let finalized = false;
      fs.readStream = async function* (path, options) {
        assert.equal(path, "/work/input");
        assert.equal(options?.signal, controller.signal);
        try {
          for (const payload of [[0, 255, 195], [169, 65, 10]]) {
            yield window.subarray(0, 0);
            window.set(payload);
            yield window;
            assert.deepEqual([...window], payload);
          }
        } finally {
          window.fill(0);
          assert.equal(backing[3], 0x7e);
          assert.equal(backing[7], 0x7e);
          finalized = true;
        }
      };
      const result = await run(command, [...args, "input"], { fs, signal: controller.signal });
      assert.deepEqual(result.stdoutBytes, Buffer.from(expected));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(finalized, true);
    });
  }
}

test("tail preserves its retained byte limit and finalizes the source", async () => {
  const bytes = Buffer.alloc(bufferLimit + 1, 65);
  let finalized = false;
  const stdin = (async function* () {
    try { yield bytes; }
    finally { assert.equal(bytes.every(byte => byte === 65), true); finalized = true; }
  })();
  const result = await run("tail", ["-c", String(bufferLimit + 1)], { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "tail: EFBIG: tail buffer limit exceeded\n");
  assert.equal(finalized, true);
});

for (const action of ["accept", "cancel", "reject"] as const) {
  test(`head byte omission awaits sink ${action} before another borrowed read`, { timeout: 10_000 }, async context => {
    const fs = await fixture({ input: "fixture" });
    const events: string[] = [];
    const window = Buffer.alloc(9).subarray(3, 6);
    fs.readStream = async function* () {
      try {
        for (const payload of [[65, 66, 67], [68, 69, 70]]) {
          window.set(payload);
          events.push(`yield:${payload[0]}`);
          yield window;
          events.push("next");
        }
      } finally { window.fill(0); events.push("finally"); }
    };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(async () => { release(); await shell.dispose(); });
    const controller = new AbortController();
    const reason = new FsError("EIO", { message: "sink stopped" });
    let writes = 0;
    const execution = shell.exec("head -c -2 /work/input", {
      signal: controller.signal,
      stdout: { async write(bytes) {
        if (writes++ === 0) {
          assert.deepEqual([...bytes], [65]);
          enter();
          await released;
          if (action === "reject") throw reason;
          if (action === "accept") assert.deepEqual([...bytes], [65]);
        }
      } },
    });
    const outcome = action === "cancel" ? assert.rejects(execution, error => error === reason) : execution;
    await entered;
    assert.deepEqual(events, ["yield:65"]);
    if (action === "cancel") controller.abort(reason);
    release();
    await outcome;
    if (action !== "cancel") {
      const result = await execution;
      assert.equal(result.exitCode, action === "accept" ? 0 : 1);
      assert.equal(result.stderr, action === "accept" ? "" : "head: EIO: sink stopped\n");
      if (action === "accept") assert.deepEqual([...result.stdoutBytes], [65, 66, 67, 68]);
    }
    assert.deepEqual(events, action === "accept"
      ? ["yield:65", "next", "yield:68", "next", "finally"]
      : ["yield:65", "finally"]);
  });
}

test("cat copies binary chunks, preserves missing final newlines and consumes stdin only once", async () => {
  const fs = await fixture({ before: "before\n", after: "after" });
  const result = await run("cat", ["before", "-", "after", "-"], { fs, stdin: chunks(new Uint8Array([0, 255, 10])) });
  assert.deepEqual(result.stdoutBytes, Buffer.concat([Buffer.from("before\n"), Buffer.from([0, 255, 10]), Buffer.from("after")]));
  assert.equal((await run("cat", ["missing", "after"], { fs })).stdout, "after");
  assert.equal((await run("cat", ["missing", "after"], { fs })).exitCode, 1);
});

test("cat numbering, blank squeezing and visible bytes survive chunk boundaries", async () => {
  assert.equal((await run("cat", ["-ns"], { stdin: chunks("a\n\n\nb\n") })).stdout, "     1\ta\n     2\t\n     3\tb\n");
  assert.equal((await run("cat", ["-bn"], { stdin: chunks("\na\n") })).stdout, "\n     1\ta\n");
  assert.equal((await run("cat", ["-A"], { stdin: chunks(new Uint8Array([0, 9, 127, 255, 10])) })).stdout, "^@^I^?M-^?$\n");
  const fs = await fixture({ first: "a", second: "b\n" });
  assert.equal((await run("cat", ["-n", "first", "second"], { fs })).stdout, "     1\tab\n");
});

test("head and tail support byte/line counts, origin counts, omission and unterminated lines", async () => {
  const stdin = "one\ntwo\nthree";
  assert.equal((await run("head", ["-n", "2"], { stdin: chunks(stdin) })).stdout, "one\ntwo\n");
  assert.equal((await run("head", ["-n", "-1"], { stdin: chunks(stdin) })).stdout, "one\ntwo\n");
  assert.equal((await run("head", ["-c", "3"], { stdin: chunks(stdin) })).stdout, "one");
  assert.equal((await run("head", ["-c", "-3"], { stdin: chunks(stdin, 5) })).stdout, "one\ntwo\nth");
  assert.equal((await run("tail", ["-n", "2"], { stdin: chunks(stdin) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-n", "+2"], { stdin: chunks(stdin, 6) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-c", "3"], { stdin: chunks(stdin, 4) })).stdout, "ree");
  assert.equal((await run("tail", ["-c", "+5"], { stdin: chunks(stdin, 4) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-n", "0"], { stdin })).stdout, "");
  assert.equal((await run("head", ["-n", "nope"], { stdin })).exitCode, 2);
});

test("head stops reading when satisfied and multiple input headers are controllable", async () => {
  let reads = 0;
  const source = (async function* () { reads++; yield Buffer.from("first\n"); reads++; yield Buffer.from("second\n"); })();
  assert.equal((await run("head", ["-n", "1"], { stdin: source })).stdout, "first\n");
  assert.equal(reads, 1);
  const fs = await fixture({ first: "one\n", second: "two\n" });
  assert.equal((await run("head", ["first", "second"], { fs })).stdout, "==> first <==\none\n\n==> second <==\ntwo\n");
  assert.equal((await run("tail", ["-q", "first", "second"], { fs })).stdout, "one\ntwo\n");
});

test("wc tracks words across chunks and distinguishes bytes, UTF-8 characters and newlines", async () => {
  const result = await run("wc", ["-lwcm"], { stdin: chunks("héllo  world\nlast") });
  assert.equal(result.stdout, "      1       3      17      18\n");
  assert.equal((await run("wc", ["-c"], { stdin: new Uint8Array([0, 255, 1]) })).stdout, "3\n");
  const fs = await fixture({ first: "a\n", second: "b\nc\n" });
  assert.equal((await run("wc", ["-l", "first", "second"], { fs })).stdout, "1 first\n2 second\n3 total\n");
});

test("tee streams to stdout and multiple virtual files, supports append, and continues after file errors", async () => {
  const fs = await fixture({ existing: "old" });
  const result = await run("tee", ["existing", "new", "missing/child"], { fs, stdin: chunks(new Uint8Array([0, 255, 10])) });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdoutBytes, Buffer.from([0, 255, 10]));
  assert.deepEqual(await fs.readFile("/work/existing"), new Uint8Array([0, 255, 10]));
  assert.deepEqual(await fs.readFile("/work/new"), new Uint8Array([0, 255, 10]));
  assert.equal((await run("tee", ["-a", "new"], { fs, stdin: "tail" })).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/new"), new Uint8Array([0, 255, 10, 116, 97, 105, 108]));
});

function streamingOnlyAdapter(
  backing: FileSystem,
  writeStream: (path: string, source: ByteSource, options?: WriteFileOptions) => Promise<void>,
): FileSystem {
  return new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, append: false, streamingWrite: true };
      if (property === "appendFile") return async (path: string) => { throw new FsError("ENOTSUP", { syscall: "appendFile", path }); };
      if (property === "writeStream") return writeStream;
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

test("tee uses adapter writeStream for binary chunks and multiple non-append targets", async () => {
  const backing = await fixture({ existing: "original" });
  const writes: { path: string; flag: WriteFileOptions["flag"] }[] = [];
  const fs = streamingOnlyAdapter(backing, async (path, source, options) => {
    writes.push({ path, flag: options?.flag });
    await backing.writeStream!(path, source, options);
  });
  const payload = new Uint8Array([0xe2, 0x82, 0xac, 0, 0xff, 0x41]);
  const result = await run("tee", ["existing", "second"], { fs, stdin: chunks(payload, 2) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Buffer.from(payload));
  assert.deepEqual(await backing.readFile("/work/existing"), payload);
  assert.deepEqual(await backing.readFile("/work/second"), payload);
  assert.deepEqual(writes, [
    { path: "/work/existing", flag: "w" },
    { path: "/work/second", flag: "w" },
  ]);
});

test("tee -a uses adapter writeStream append mode without requiring appendFile", async () => {
  const backing = await fixture({ existing: new Uint8Array([0xff, 0]) });
  const flags: WriteFileOptions["flag"][] = [];
  const fs = streamingOnlyAdapter(backing, async (path, source, options) => {
    flags.push(options?.flag);
    await backing.writeStream!(path, source, options);
  });
  const result = await run("tee", ["-a", "existing"], { fs, stdin: chunks(new Uint8Array([0xe2, 0x82, 0xac]), 1) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readFile("/work/existing"), new Uint8Array([0xff, 0, 0xe2, 0x82, 0xac]));
  assert.deepEqual(flags, ["a"]);
});

test("tee takes the legacy path when writeStream exists but streamingWrite is false", async () => {
  const backing = await fixture({ existing: "original" });
  let streamWrites = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, streamingWrite: false };
      if (property === "writeStream") return async () => { streamWrites++; throw new Error("must not stream"); };
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const result = await run("tee", ["existing"], { fs, stdin: chunks("replacement", 2) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "replacement");
  assert.equal(streamWrites, 0);
  assert.equal(Buffer.from(await backing.readFile("/work/existing")).toString(), "replacement");
});

test("tee safely falls back when an unknown streaming adapter rejects before input", async () => {
  const backing = await fixture({ existing: "original" });
  let streamWrites = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, streamingWrite: undefined };
      if (property === "writeStream") return async (path: string) => {
        streamWrites++;
        throw new FsError("ENOTSUP", { syscall: "writeStream", path });
      };
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const result = await run("tee", ["existing"], { fs, stdin: chunks("replacement", 2) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "replacement");
  assert.equal(streamWrites, 1);
  assert.equal(Buffer.from(await backing.readFile("/work/existing")).toString(), "replacement");
});

test("tee safely falls back for empty input before applying legacy truncation and creation", async () => {
  const backing = await fixture({ existing: "original" });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, streamingWrite: undefined };
      if (property === "writeStream") return async (path: string) => {
        throw new FsError("ENOTSUP", { syscall: "writeStream", path });
      };
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const result = await run("tee", ["existing", "created"], { fs, stdin: "" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readFile("/work/existing"), new Uint8Array());
  assert.deepEqual(await backing.readFile("/work/created"), new Uint8Array());
});

test("tee never falls back destructively after an unknown streaming adapter accepts input", async () => {
  const backing = await fixture({ existing: "original" });
  let fallbackWrites = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, streamingWrite: undefined };
      if (property === "writeStream") return async (path: string, source: ByteSource) => {
        for await (const ignoredChunk of source) throw new FsError("ENOTSUP", { syscall: "writeStream", path });
      };
      if (property === "writeFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
        fallbackWrites++;
        return target.writeFile(...args);
      };
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const result = await run("tee", ["existing"], { fs, stdin: chunks("replacement", 2) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "replacement");
  assert.match(result.stderr, /ENOTSUP/);
  assert.equal(fallbackWrites, 0);
  assert.equal(Buffer.from(await backing.readFile("/work/existing")).toString(), "original");
});

test("tee preserves existing bytes when declared write and append operations are unsupported", async () => {
  const backing = await fixture({ existing: "original" });
  let destructiveWrites = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, append: false, streamingWrite: false };
      if (property === "writeStream") return undefined;
      if (property === "writeFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
        destructiveWrites++;
        return target.writeFile(...args);
      };
      if (property === "appendFile") return async (path: string) => { throw new FsError("ENOTSUP", { syscall: "appendFile", path }); };
      const member = Reflect.get(target, property) as unknown;
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const result = await run("tee", ["existing"], { fs, stdin: "replacement" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "replacement");
  assert.match(result.stderr, /ENOTSUP/);
  assert.equal(destructiveWrites, 0);
  assert.equal(Buffer.from(await backing.readFile("/work/existing")).toString(), "original");
});

test("tee reports streaming adapter size failures while continuing stdout", async () => {
  const backing = await fixture();
  const fs = streamingOnlyAdapter(backing, async (path, source, options) => {
    let size = 0;
    await backing.writeStream!(path, (async function* () {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > 3) throw new FsError("EFBIG", { syscall: "writeStream", path });
        yield chunk;
      }
    })(), options);
  });
  const payload = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const result = await run("tee", ["limited"], { fs, stdin: chunks(payload, 2) });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdoutBytes, Buffer.from(payload));
  assert.match(result.stderr, /EFBIG/);
  assert.deepEqual(await backing.readFile("/work/limited"), new Uint8Array([0, 1]));
});

test("tee applies bounded backpressure when a streaming adapter pauses", async () => {
  const backing = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const firstRead = new Promise<void>(resolve => { started = resolve; });
  const fs = streamingOnlyAdapter(backing, async (path, source, options) => {
    await backing.writeStream!(path, (async function* () {
      let first = true;
      for await (const chunk of source) {
        if (first) {
          first = false;
          started();
          await gate;
        }
        yield chunk;
      }
    })(), options);
  });
  let produced = 0;
  const input = (async function* () {
    for (let index = 0; index < 20; index++) {
      produced++;
      yield new Uint8Array(32 * 1024).fill(index);
    }
  })();
  const pending = run("tee", ["paused"], { fs, stdin: input });
  await firstRead;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(produced < 20, `producer ran ahead by ${produced} chunks`);
  release();
  const result = await pending;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await backing.stat("/work/paused")).size, 20 * 32 * 1024);
});

test("tee propagates cancellation into adapter writeStream and releases input", async () => {
  const backing = await fixture();
  const controller = new AbortController();
  const reason = new Error("cancel tee stream");
  let adapterSignal: AbortSignal | undefined;
  let released = false;
  const fs = streamingOnlyAdapter(backing, async (_path, source, options) => {
    adapterSignal = options?.signal;
    for await (const ignoredChunk of source) { /* consume with backpressure */ }
  });
  const source = (async function* () {
    try {
      yield new Uint8Array([1, 2]);
      await new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    } finally { released = true; }
  })();
  const pending = run("tee", ["target"], { fs, stdin: source, signal: controller.signal });
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(adapterSignal, controller.signal);
  assert.equal(released, true);
});

test("tr translates, deletes, squeezes and complements byte sets across chunks", async () => {
  assert.equal((await run("tr", ["a-z", "A-Z"], { stdin: chunks("one two\n") })).stdout, "ONE TWO\n");
  assert.equal((await run("tr", ["-s", "[:space:]", " "], { stdin: chunks("a \t\n b") })).stdout, "a b");
  assert.equal((await run("tr", ["-d", "[:digit:]"], { stdin: chunks("a1b2") })).stdout, "ab");
  assert.equal((await run("tr", ["-cd", "[:digit:]"], { stdin: chunks("a1b2\n") })).stdout, "12");
  assert.equal((await run("tr", ["-ds", "x", "a"], { stdin: chunks("aaxaa") })).stdout, "a");
  assert.equal((await run("tr", ["abc", "x"], { stdin: "abc" })).stdout, "xxx");
  assert.deepEqual((await run("tr", ["\\000", "\\377"], { stdin: new Uint8Array([0, 1]) })).stdoutBytes, Buffer.from([255, 1]));
  assert.equal((await run("tr", ["z-a", "x"])).exitCode, 2);
  assert.equal((await run("tr", ["a", ""])).exitCode, 2);
});
