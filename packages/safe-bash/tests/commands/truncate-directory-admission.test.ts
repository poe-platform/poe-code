import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import { truncateCommand } from "../../src/commands/truncate.js";
import {
  FsError,
  type CommandContext,
  type FileReadHandle,
  type FileSystem,
  type InvocationCleanup
} from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const maximum = (1n << 63n) - 1n;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture(offset = 0n, boundary: "both" | "capabilities" | "open" = "both") {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/reference", { recursive: true });
  await memory.writeFile("/work/target", encode("abcdef"), { mode: 0o640 });
  const callbacks: InvocationCleanup[] = [];
  const events: string[] = [];
  const admissions: {
    phase: string;
    allowDirectory: boolean | undefined;
    signal: AbortSignal | undefined;
  }[] = [];
  let acquired: FileReadHandle | undefined;
  const handle: FileReadHandle = {
    async stat() {
      assert.fail("directory end must not use retained stat size");
    },
    async read() {
      assert.fail("directory end must not read bytes");
    },
    async seekEnd(options) {
      assert.equal(this, handle);
      options?.signal?.throwIfAborted();
      events.push("reference-seek");
      return offset;
    },
    async close() {
      assert.equal(this, handle);
      events.push("reference-close");
      assert.ok(acquired);
      await acquired.close();
    }
  };
  const overrides: Partial<FileSystem> = {};
  const fs = new Proxy(overrides as FileSystem, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      const value: unknown = Reflect.get(memory, key, memory);
      return typeof value === "function" ? value.bind(memory) : value;
    }
  });
  fs.stat = async function (path, options) {
    assert.equal(this, fs);
    events.push(path === "/work/reference" ? "reference-stat" : "target-path-stat");
    return memory.stat(path, options);
  };
  fs.capabilitiesFor = async function (path, options) {
    assert.equal(this, fs);
    assert.equal(callbacks.length, 1);
    options?.signal?.throwIfAborted();
    if (path === "/work/reference") {
      events.push("reference-capabilities");
      admissions.push({
        phase: "capabilities",
        allowDirectory: options?.allowDirectory,
        signal: options?.signal
      });
      if (boundary !== "open" && options?.allowDirectory !== true)
        return { ...memory.capabilities, retainedRead: false };
    } else {
      events.push("target-capabilities");
      assert.equal(options?.create, true);
      assert.equal(options?.allowDirectory, undefined);
    }
    return memory.capabilities;
  };
  fs.openReadFile = async function (path, options) {
    assert.equal(this, fs);
    assert.equal(callbacks.length, 1);
    assert.equal(path, "/work/reference");
    events.push("reference-open");
    admissions.push({
      phase: "open",
      allowDirectory: options?.allowDirectory,
      signal: options?.signal
    });
    if (boundary !== "capabilities" && options?.allowDirectory !== true)
      throw new FsError("EISDIR");
    acquired = await memory.openReadFile(path, { ...options, allowDirectory: true });
    return handle;
  };
  fs.openResizeFile = async function (path, options) {
    assert.equal(this, fs);
    events.push("target-open");
    const writable = await memory.openResizeFile(path, options);
    return {
      async stat(options) {
        events.push("target-stat");
        return writable.stat(options);
      },
      async truncate(length, options) {
        events.push(`truncate:${length}`);
        return writable.truncate(length, options);
      },
      async close() {
        events.push("target-close");
        await writable.close();
      }
    };
  };
  return { memory, fs, handle, callbacks, events, admissions };
}

async function execute(
  setup: Awaited<ReturnType<typeof fixture>>,
  args: readonly string[] = ["-r", "reference", "target"],
  signal = new AbortController().signal
) {
  const stdout: number[] = [],
    stderr: number[] = [];
  const context: CommandContext = {
    command: "truncate",
    args,
    cwd: "/work",
    env: { LC_ALL: "C" },
    fs: setup.fs,
    signal,
    stdin: {
      [Symbol.asyncIterator]() {
        assert.fail("truncate must not acquire stdin");
      }
    },
    stdout: {
      async write(bytes) {
        stdout.push(...bytes);
      }
    },
    stderr: {
      async write(bytes) {
        stderr.push(...bytes);
      }
    },
    registerCleanup(cleanup) {
      setup.events.push("registered");
      setup.callbacks.push(cleanup);
    }
  };
  const result = await truncateCommand().execute(context);
  return {
    exitCode: result.exitCode,
    stdout: Uint8Array.from(stdout),
    stderr: Uint8Array.from(stderr),
    target: await setup.memory.readFile("/work/target")
  };
}

for (const boundary of ["capabilities", "open", "both"] as const)
  test(`truncate explicitly opts into directory reference ${boundary} admission`, async () => {
    const setup = await fixture(0n, boundary);
    await assert.rejects(
      setup.memory.openReadFile("/work/reference"),
      (error) => error instanceof FsError && error.code === "EISDIR"
    );
    assert.deepEqual(await execute(setup), {
      exitCode: 0,
      stdout: encode(""),
      stderr: encode(""),
      target: encode("")
    });
    assert.deepEqual(
      setup.admissions.map(({ phase, allowDirectory }) => ({ phase, allowDirectory })),
      [
        { phase: "capabilities", allowDirectory: true },
        { phase: "open", allowDirectory: true }
      ]
    );
    assert.ok(setup.admissions.every((admission) => admission.signal instanceof AbortSignal));
    assert.deepEqual(setup.events, [
      "registered",
      "reference-stat",
      "reference-capabilities",
      "reference-open",
      "reference-seek",
      "reference-close",
      "target-capabilities",
      "target-open",
      "truncate:0",
      "target-close"
    ]);
    await Promise.all(setup.callbacks.map((cleanup) => cleanup()));
    assert.equal(setup.events.filter((event) => event === "reference-close").length, 1);
    assert.equal((await setup.memory.stat("/work/target")).mode & 0o777, 0o640);
  });

for (const entry of [
  { offset: 0n, size: "+2", expected: "ab" },
  { offset: 0n, size: "-1", expected: "" },
  { offset: 0n, size: "%2", expected: "" },
  { offset: maximum, size: "-9223372036854775806", expected: "a" },
  { offset: maximum, size: "-9223372036854775807", expected: "" },
  { offset: maximum, size: "<3", expected: "abc" },
  {
    offset: maximum,
    size: "+1",
    expected: "abcdef",
    diagnostic: "overflow extending size of file 'target'"
  },
  {
    offset: maximum,
    size: "%2",
    expected: "abcdef",
    diagnostic: "overflow rounding up size of file 'target'"
  }
])
  test(`truncate source-derived directory reference offset ${entry.offset}, size ${entry.size}`, async () => {
    const setup = await fixture(entry.offset);
    assert.deepEqual(await execute(setup, ["-r", "reference", `-s${entry.size}`, "target"]), {
      exitCode: entry.diagnostic ? 1 : 0,
      stdout: encode(""),
      stderr: encode(entry.diagnostic ? `truncate: ${entry.diagnostic}\n` : ""),
      target: encode(entry.expected)
    });
    assert.equal(setup.events.filter((event) => event === "reference-seek").length, 1);
    assert.equal(setup.events.filter((event) => event === "reference-close").length, 1);
    assert.equal(setup.events.filter((event) => event === "target-close").length, 1);
  });

test("truncate snapshots one directory reference before ordered repeated targets", async () => {
  const setup = await fixture(maximum);
  const result = await execute(setup, [
    "-r",
    "reference",
    "-s-9223372036854775805",
    "target",
    "target"
  ]);
  assert.deepEqual(result, {
    exitCode: 0,
    stdout: encode(""),
    stderr: encode(""),
    target: encode("ab")
  });
  assert.deepEqual(setup.events, [
    "registered",
    "reference-stat",
    "reference-capabilities",
    "reference-open",
    "reference-seek",
    "reference-close",
    "target-capabilities",
    "target-open",
    "truncate:2",
    "target-close",
    "target-capabilities",
    "target-open",
    "truncate:2",
    "target-close"
  ]);
});

test("truncate uses Memory ext4 directory end rather than its stat size", async () => {
  const setup = await fixture();
  setup.fs.openReadFile = (path, options) => setup.memory.openReadFile(path, options);
  assert.deepEqual(await execute(setup), {
    exitCode: 1,
    stdout: encode(""),
    stderr: encode("truncate: failed to truncate 'target' at 9223372036854775807 bytes: File too large\n"),
    target: encode("abcdef")
  });
  assert.ok(setup.events.includes("target-open"));
  assert.ok(setup.events.includes("target-close"));
  assert.ok(!setup.events.some(event => event.startsWith("truncate:")));
});

test("truncate regular reference never requests retained directory admission", async () => {
  const setup = await fixture();
  await setup.memory.rm("/work/reference", { recursive: true });
  await setup.memory.writeFile("/work/reference", encode("123"));
  Object.defineProperty(setup.fs, "openReadFile", {
    get() {
      assert.fail("regular reference read lookup");
    }
  });
  assert.deepEqual(await execute(setup), {
    exitCode: 0,
    stdout: encode(""),
    stderr: encode(""),
    target: encode("abc")
  });
  assert.deepEqual(setup.admissions, []);
});

for (const method of ["capabilitiesFor", "openReadFile", "seekEnd"] as const)
  test(`truncate captures directory ${method} callable without an unnecessary lookup`, async () => {
    const setup = await fixture();
    let lookups = 0,
      calls = 0;
    const owner = method === "seekEnd" ? setup.handle : setup.fs;
    const original = method === "seekEnd" ? setup.handle.seekEnd! : setup.fs[method]!;
    Object.defineProperty(owner, method, {
      get() {
        lookups++;
        return function (this: unknown, ...args: unknown[]) {
          assert.equal(this, owner);
          calls++;
          return Reflect.apply(original, this, args);
        };
      }
    });
    assert.equal((await execute(setup)).exitCode, 0);
    assert.equal(calls, method === "capabilitiesFor" ? 2 : 1);
    assert.equal(lookups, calls);
  });

for (const reason of [false, null, 0, "", NaN])
  for (const method of ["capabilitiesFor", "openReadFile", "seekEnd"] as const)
    test(`truncate directory ${method} getter abort ${String(reason)} does not dispatch`, async () => {
      const setup = await fixture();
      const controller = new AbortController();
      let calls = 0;
      const owner = method === "seekEnd" ? setup.handle : setup.fs;
      Object.defineProperty(owner, method, {
        get() {
          controller.abort(reason);
          return () => {
            calls++;
            throw new Error("returned callable must not dispatch");
          };
        }
      });
      await assert.rejects(execute(setup, undefined, controller.signal), (error) =>
        Object.is(error, reason)
      );
      await Promise.all(setup.callbacks.map((cleanup) => cleanup()));
      assert.equal(calls, 0);
      assert.ok(!setup.events.includes("target-open"));
      assert.equal(
        setup.events.filter((event) => event === "reference-close").length,
        method === "seekEnd" ? 1 : 0
      );
      assert.deepEqual(await setup.memory.readFile("/work/target"), encode("abcdef"));
    });

for (const reason of [false, null, 0, ""])
  test(`truncate directory opaque capability metadata does not retain cancellation ${String(reason)}`, async () => {
    const setup = await fixture();
    const entered = deferred(),
      gate = deferred();
    const controller = new AbortController();
    setup.fs.capabilitiesFor = async function (path, options) {
      assert.equal(this, setup.fs);
      assert.equal(path, "/work/reference");
      assert.equal(options?.allowDirectory, true);
      entered.resolve();
      await gate.promise;
      return setup.memory.capabilities;
    };
    let settled = false,
      drained = false;
    const execution = execute(setup, undefined, controller.signal).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error };
      }
    );
    await Promise.race([
      entered.promise,
      execution.then(() => assert.fail("directory capability query was not entered"))
    ]);
    controller.abort(reason);
    const retirement = Promise.all(setup.callbacks.map((cleanup) => cleanup())).then(() => {
      drained = true;
    });
    await turn();
    assert.equal(settled, true);
    assert.equal(drained, true);
    assert.deepEqual(await execution, { error: reason });
    gate.reject(new Error("late opaque metadata failure"));
    await retirement;
    await turn();
    assert.ok(!setup.events.includes("reference-open"));
    assert.ok(!setup.events.includes("target-open"));
  });

for (const reason of [false, null, 0, ""])
  for (const phase of ["open", "seek", "close"] as const)
    test(`truncate directory drains admitted ${phase} through cancellation ${String(reason)}`, async () => {
      const setup = await fixture();
      const entered = deferred(),
        gate = deferred();
      const controller = new AbortController();
      if (phase === "open") {
        const open = setup.fs.openReadFile!;
        setup.fs.openReadFile = async function (path, options) {
          const handle = await Reflect.apply(open, this, [path, options]);
          entered.resolve();
          await gate.promise;
          return handle;
        };
      } else if (phase === "seek") {
        setup.handle.seekEnd = async function () {
          assert.equal(this, setup.handle);
          entered.resolve();
          await gate.promise;
          return 0n;
        };
      } else {
        const close = setup.handle.close;
        setup.handle.close = async function () {
          entered.resolve();
          await gate.promise;
          await Reflect.apply(close, this, []);
        };
      }
      let settled = false,
        drained = false;
      const execution = execute(setup, undefined, controller.signal).then(
        (value) => {
          settled = true;
          return { value };
        },
        (error) => {
          settled = true;
          return { error };
        }
      );
      await Promise.race([
        entered.promise,
        execution.then(() => assert.fail(`directory ${phase} was not entered`))
      ]);
      controller.abort(reason);
      const first = setup.callbacks[0]!();
      assert.equal(setup.callbacks[0]!(), first);
      const retirement = Promise.resolve(first).then(() => {
        drained = true;
      });
      await turn();
      assert.equal(settled, false);
      assert.equal(drained, false);
      assert.equal(setup.events.filter((event) => event === "reference-close").length, 0);
      gate.resolve();
      assert.deepEqual(await execution, { error: reason });
      await retirement;
      assert.equal(setup.events.filter((event) => event === "reference-close").length, 1);
      assert.ok(!setup.events.includes("target-open"));
      assert.deepEqual(await setup.memory.readFile("/work/target"), encode("abcdef"));
    });

for (const failure of [false, null, 0, "", new Error("ignored reference close")])
  test(`truncate ignores directory reference close failure ${String(failure)} once before target dispatch`, async () => {
    const setup = await fixture();
    const close = setup.handle.close;
    setup.handle.close = async function () {
      await Reflect.apply(close, this, []);
      throw failure;
    };
    assert.deepEqual(await execute(setup), {
      exitCode: 0,
      stdout: encode(""),
      stderr: encode(""),
      target: encode("")
    });
    await Promise.all(setup.callbacks.map((cleanup) => cleanup()));
    assert.equal(setup.events.filter((event) => event === "reference-close").length, 1);
    assert.ok(setup.events.indexOf("reference-close") < setup.events.indexOf("target-open"));
  });

test("truncate preserves directory ESPIPE over ignored close and never attempts targets", async () => {
  const setup = await fixture();
  setup.handle.seekEnd = async () => {
    throw new FsError("ESPIPE");
  };
  const close = setup.handle.close;
  setup.handle.close = async function () {
    await Reflect.apply(close, this, []);
    throw new FsError("EIO");
  };
  assert.deepEqual(await execute(setup, ["-r", "reference", "target", "new"]), {
    exitCode: 1,
    stdout: encode(""),
    stderr: encode("truncate: cannot get the size of 'reference': Illegal seek\n"),
    target: encode("abcdef")
  });
  await Promise.all(setup.callbacks.map((cleanup) => cleanup()));
  assert.ok(!setup.events.includes("target-open"));
  await assert.rejects(
    setup.memory.stat("/work/new"),
    (error) => error instanceof FsError && error.code === "ENOENT"
  );
});
