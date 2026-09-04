import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../src/contracts/index.js";
import { registerYieldCheckpoint, scheduleTurn } from "../../src/contracts/yield.js";
import { chunks, fixture, run } from "./helpers.js";

function sortProbe(args: readonly string[], stdin: string, signal: AbortSignal, fs: FileSystem) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "sort", args, cwd: "/work", env: {}, fs, signal, stdin: toByteSource(stdin),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  };
  return { context, stdout, stderr };
}

test("sort batches both comparisons and record moves without publishing during checkpoints", async () => {
  const controller = new AbortController();
  const probe = sortProbe([], "\n".repeat(1024), controller.signal, await fixture());
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => {
    checkpoints++;
    assert.equal(probe.stdout.length, 0);
  });
  const result = await textCommands().find(command => command.name === "sort")!.execute(probe.context);
  assert.equal(result.exitCode, 0);
  assert.ok(checkpoints >= 3 && checkpoints <= 6, `batched comparison/move checkpoints: ${checkpoints}`);
  assert.equal(Buffer.concat(probe.stdout).toString(), "\n".repeat(1024));
});

test("sort yields queued cancellation before output for every comparison path", async () => {
  const stdin = Array.from({ length: 256 }, (_, index) => `${String(index * 73 % 256).padStart(4, "0")} tail`).join("\n") + "\n";
  for (const args of [[], ["-f"], ["-k1,1"], ["-n"], ["-k1,1n"]]) {
    for (const reason of [false, null]) {
      const controller = new AbortController();
      const fs = await fixture({ kept: "unchanged" });
      const probe = sortProbe([...args, "-o", "kept"], stdin, controller.signal, fs);
      let checkpoints = 0;
      registerYieldCheckpoint(controller.signal, () => {
        checkpoints++;
        scheduleTurn(() => controller.abort(reason));
      });
      await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "sort")!.execute(probe.context)), failure => failure === reason);
      assert.equal(checkpoints, 1);
      assert.equal(probe.stdout.length, 0);
      assert.equal(probe.stderr.length, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/kept")), "unchanged");
    }
  }
});

test("sort checkpoints continue after numeric descriptors are fully warmed", async testContext => {
  const stdin = Array.from({ length: 256 }, (_, index) => String(index * 73 % 256).padStart(4, "0")).join("\n") + "\n";
  for (const args of [["-n"], ["-k1,1n"]]) {
    for (const reason of [false, null]) {
      const controller = new AbortController();
      const probe = sortProbe(args, stdin, controller.signal, await fixture());
      const from = testContext.mock.method(Buffer, "from");
      let warmed = false;
      registerYieldCheckpoint(controller.signal, () => {
        const parsed = from.mock.calls.filter(call => call.arguments[0] instanceof Uint8Array);
        if (parsed.length === 256) {
          warmed = true;
          queueMicrotask(() => controller.abort(reason));
        }
      });
      try {
        await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "sort")!.execute(probe.context)), failure => failure === reason);
        assert.equal(warmed, true);
        assert.equal(from.mock.calls.filter(call => call.arguments[0] instanceof Uint8Array).length, 256);
        assert.equal(probe.stdout.length, 0);
        assert.equal(probe.stderr.length, 0);
      } finally { from.mock.restore(); }
    }
  }
});

test("sort long-record preparation cooperates even with only one comparison", async () => {
  for (const [args, stdin] of [
    [["-f"], `${"a".repeat(16_384)}x\n${"a".repeat(16_384)}y\n`],
    [["-b"], `${" ".repeat(16_384)}x\n${" ".repeat(16_384)}y\n`],
    [["-k1,1"], `${"a".repeat(16_384)}x\n${"a".repeat(16_384)}y\n`],
    [["-t", ":", "-k2,2"], `${"a:".repeat(8192)}x\n${"a:".repeat(8192)}y\n`],
    [["-n"], `${"1".repeat(16_384)}2\n${"1".repeat(16_384)}3\n`],
    [[], `${"a".repeat(16_384)}x\n${"a".repeat(16_384)}y\n`],
  ] as const) {
    for (const reason of [false, null]) {
      const controller = new AbortController();
      const probe = sortProbe(args, stdin, controller.signal, await fixture());
      let checkpoints = 0;
      registerYieldCheckpoint(controller.signal, () => {
        checkpoints++;
        queueMicrotask(() => controller.abort(reason));
      });
      await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "sort")!.execute(probe.context)), failure => failure === reason);
      assert.equal(checkpoints, 1);
      assert.equal(probe.stdout.length, 0);
      assert.equal(probe.stderr.length, 0);
    }
  }
});

test("sort keeps byte scope and key-local flag precedence", async () => {
  const stdin = "b:2\na:2\nz:1\n";
  assert.equal((await run("sort", ["-r", "-t", ":", "-k2,2n", "-s"], { stdin })).stdout, "z:1\nb:2\na:2\n");
  assert.equal((await run("sort", ["-t", ":", "-k2,2nr"], { stdin })).stdout, "a:2\nb:2\nz:1\n");
  assert.equal((await run("sort", ["-t", ":", "-k2,2n", "-u"], { stdin })).stdout, "z:1\nb:2\n");
  assert.deepEqual((await run("sort", [], { stdin: Uint8Array.from([255, 10, 0, 10, 128, 10, 65, 10]) })).stdoutBytes, Buffer.from([0, 10, 65, 10, 128, 10, 255, 10]));
  for (const locale of ["C", "tr_TR.UTF-8"]) {
    assert.equal((await run("sort", ["-f"], { stdin: "ı\ni\nİ\nI\n", env: { LC_ALL: locale } })).stdout, "I\ni\nİ\nı\n");
  }
  for (const flag of ["-V", "--version-sort"]) assert.equal((await run("sort", [flag], { stdin: "v10\nv2\n" })).exitCode, 2);
});

test("sort uses byte ordering, numeric keys, reverse, stable and unique modes", async () => {
  assert.equal((await run("sort", [], { stdin: chunks("z\na\na\nb") })).stdout, "a\na\nb\nz\n");
  assert.equal((await run("sort", ["-nu"], { stdin: "10\n2\n02\n-3\n0.5\n" })).stdout, "-3\n0.5\n2\n10\n");
  assert.equal((await run("sort", ["-nr"], { stdin: "2\n10\n-1\n" })).stdout, "10\n2\n-1\n");
  assert.equal((await run("sort", ["-t", ":", "-k", "2,2n", "-s"], { stdin: "b:2\na:2\nz:1\n" })).stdout, "z:1\nb:2\na:2\n");
  assert.equal((await run("sort", ["-n"], { stdin: "9007199254740993\n9007199254740992\n" })).stdout, "9007199254740992\n9007199254740993\n");
  assert.equal((await run("sort", ["-fu"], { stdin: "b\nA\na\n" })).stdout, "A\nb\n");
});

test("sort checks order, writes output safely after reading input, and handles zero records", async () => {
  assert.equal((await run("sort", ["-c"], { stdin: "a\nb\n" })).exitCode, 0);
  assert.equal((await run("sort", ["-c"], { stdin: "b\na\n" })).exitCode, 1);
  assert.equal((await run("sort", ["-cu"], { stdin: "a\na\n" })).exitCode, 1);
  assert.equal((await run("sort", ["-z"], { stdin: "b\0a\0" })).stdout, "a\0b\0");
  const fs = await fixture({ input: "b\na\n" });
  assert.equal((await run("sort", ["-o", "input", "input"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "a\nb\n");
  assert.equal((await run("sort", ["-k", "0"])).exitCode, 2);
});

test("uniq groups adjacent records and supports counts, repeated/unique selection and comparisons", async () => {
  const stdin = "a\na\nb\na\n";
  assert.equal((await run("uniq", [], { stdin: chunks(stdin) })).stdout, "a\nb\na\n");
  assert.equal((await run("uniq", ["-c"], { stdin })).stdout, "      2 a\n      1 b\n      1 a\n");
  assert.equal((await run("uniq", ["-d"], { stdin })).stdout, "a\n");
  assert.equal((await run("uniq", ["-u"], { stdin })).stdout, "b\na\n");
  assert.equal((await run("uniq", ["-if", "1"], { stdin: "one SAME\ntwo same\nthree other" })).stdout, "one SAME\nthree other\n");
  assert.equal((await run("uniq", ["-s", "1", "-w", "1"], { stdin: "abX\ncbY\ndz" })).stdout, "abX\ndz\n");
  assert.equal((await run("uniq", ["-z"], { stdin: "a\0a\0b\0" })).stdout, "a\0b\0");
});

test("cut supports overlapping/open ranges, complement, literal fields and UTF-8 characters", async () => {
  assert.equal((await run("cut", ["-b", "1-2,2-3,5-"], { stdin: chunks("abcdef\n") })).stdout, "abcef\n");
  assert.equal((await run("cut", ["--complement", "-b", "2-4"], { stdin: "abcdef" })).stdout, "aef\n");
  assert.equal((await run("cut", ["-c", "2"], { stdin: chunks("aéz\n") })).stdout, "é\n");
  assert.deepEqual((await run("cut", ["-b", "2"], { stdin: "aéz\n" })).stdoutBytes, Buffer.from([195, 10]));
  assert.equal((await run("cut", ["-d", ":", "-f", "2,4", "--output-delimiter=|"], { stdin: "a:b:c:d\nplain\n" })).stdout, "b|d\nplain\n");
  assert.equal((await run("cut", ["-sd", ":", "-f", "2"], { stdin: "plain\na:b" })).stdout, "b\n");
  assert.equal((await run("cut", ["-b", "3-1"])).exitCode, 2);
  assert.equal((await run("cut", ["-f", "0"])).exitCode, 2);
});

function cutProbe(args: readonly string[], stdin: CommandContext["stdin"], signal: AbortSignal, fs: FileSystem) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "cut", args, cwd: "/work", env: {}, fs, signal, stdin,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  };
  return { context, stdout, stderr };
}

test("cut selection work does not rescan all ranges per position", async testContext => {
  for (const mode of ["b", "c", "f"]) {
    await testContext.test(mode, async () => {
      const positions = 2048;
      const ranges = Array.from({ length: 32 }, (_, index) => String(100000 + index * 2)).join(",");
      const stdin = mode === "f" ? Array(positions).fill("x").join(",") + "\n" : "x".repeat(positions) + "\n";
      const probe = cutProbe([`-${mode}`, ranges, ...(mode === "f" ? ["-d", ","] : [])], toByteSource(stdin), new AbortController().signal, await fixture());
      let comparisons = 0;
      const original = Array.prototype.some;
      Array.prototype.some = function (this: unknown[], predicate: (value: unknown, index: number, array: unknown[]) => unknown, receiver?: unknown) {
        const first = this[0];
        const rangeList = typeof first === "object" && first !== null && "start" in first && first.start === 100000;
        return original.call(this, (value: unknown, index: number, array: unknown[]) => {
          if (rangeList) comparisons++;
          return predicate.call(receiver, value, index, array);
        });
      };
      try {
        const result = await textCommands().find(command => command.name === "cut")!.execute(probe.context);
        assert.equal(result.exitCode, 0);
      } finally { Array.prototype.some = original; }
      assert.equal(Buffer.concat(probe.stdout).toString(), "\n");
      assert.ok(comparisons <= 4 * (positions + 32), `range comparisons: ${comparisons}`);
    });
  }
});

test("cut parse sort and normalization deliver queued false/null cancellation before input", async testContext => {
  const ranges = Array(8192).fill("1").join(",");
  for (const checkpoint of [1, 5, 31]) {
    for (const reason of [false, null]) {
      await testContext.test(`checkpoint ${checkpoint}, reason ${reason}`, async () => {
        const controller = new AbortController();
        let reads = 0;
        let checkpoints = 0;
        const stdin = { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array([120, 10]); } };
        const probe = cutProbe(["-b", ranges], stdin, controller.signal, await fixture());
        registerYieldCheckpoint(controller.signal, () => {
          if (++checkpoints === checkpoint) scheduleTurn(() => controller.abort(reason));
        });
        await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "cut")!.execute(probe.context)), failure => failure === reason);
        assert.equal(checkpoints, checkpoint);
        assert.equal(reads, 0);
        assert.equal(probe.stdout.length, 0);
        assert.equal(probe.stderr.length, 0);
      });
    }
  }
});

test("cut record selection delivers queued false/null cancellation in every mode", async testContext => {
  for (const mode of ["b", "c", "f"]) {
    for (const reason of [false, null]) {
      await testContext.test(`${mode}, reason ${reason}`, async () => {
        const controller = new AbortController();
        let checkpoints = 0;
        const stdin = mode === "f" ? Array(8192).fill("x").join(",") + "\n" : "x".repeat(8192) + "\n";
        const probe = cutProbe([`-${mode}`, "100000", ...(mode === "f" ? ["-d", ","] : [])], toByteSource(stdin), controller.signal, await fixture());
        registerYieldCheckpoint(controller.signal, () => {
          checkpoints++;
          scheduleTurn(() => controller.abort(reason));
        });
        await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "cut")!.execute(probe.context)), failure => failure === reason);
        assert.equal(checkpoints, 1);
        assert.equal(probe.stdout.length, 0);
        assert.equal(probe.stderr.length, 0);
      });
    }
  }
});

test("cut preabort preserves false/null reasons without reading or writing", async () => {
  for (const reason of [false, null]) {
    const controller = new AbortController();
    controller.abort(reason);
    const stdin = { async *[Symbol.asyncIterator]() { assert.fail("preabort must not read"); yield new Uint8Array(); } };
    const probe = cutProbe(["-b", "1"], stdin, controller.signal, await fixture());
    await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "cut")!.execute(probe.context)), failure => failure === reason);
    assert.equal(probe.stdout.length, 0);
    assert.equal(probe.stderr.length, 0);
  }
});

test("cut bounds output writes and awaits backpressure in every mode", async testContext => {
  for (const mode of ["b", "c", "f"]) {
    await testContext.test(mode, async () => {
      const stdin = "x".repeat(70 * 1024) + (mode === "f" ? ",tail\n" : "\n");
      const expected = "x".repeat(70 * 1024) + "\n";
      const probe = cutProbe([`-${mode}`, mode === "f" ? "1" : "1-", ...(mode === "f" ? ["-d", ","] : [])], toByteSource(stdin), new AbortController().signal, await fixture());
      let writing = false;
      let writes = 0;
      probe.context.stdout.write = async bytes => {
        assert.equal(writing, false);
        assert.ok(bytes.byteLength <= 64 * 1024, `write size: ${bytes.byteLength}`);
        writing = true;
        writes++;
        const owned = new Uint8Array(bytes);
        await new Promise<void>(resolve => scheduleTurn(resolve));
        assert.deepEqual(bytes, owned);
        probe.stdout.push(owned);
        writing = false;
      };
      const result = await textCommands().find(command => command.name === "cut")!.execute(probe.context);
      assert.equal(result.exitCode, 0, Buffer.concat(probe.stderr).toString());
      assert.ok(writes >= 2);
      assert.equal(writing, false);
      assert.equal(Buffer.concat(probe.stdout).toString(), expected);
    });
  }
});

test("cut stops after an awaited output write receives queued false/null cancellation", async testContext => {
  for (const mode of ["b", "c", "f"]) {
    for (const reason of [false, null]) {
      await testContext.test(`${mode}, reason ${reason}`, async () => {
        const controller = new AbortController();
        const stdin = "x".repeat(70 * 1024) + (mode === "f" ? ",tail\n" : "\n");
        const probe = cutProbe([`-${mode}`, mode === "f" ? "1" : "1-", ...(mode === "f" ? ["-d", ","] : [])], toByteSource(stdin), controller.signal, await fixture());
        probe.context.stdout.write = async bytes => {
          probe.stdout.push(new Uint8Array(bytes));
          scheduleTurn(() => controller.abort(reason));
          await new Promise<void>(resolve => scheduleTurn(resolve));
        };
        await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "cut")!.execute(probe.context)), failure => failure === reason);
        assert.equal(probe.stdout.length, 1);
        assert.equal(probe.stdout[0]!.length, 64 * 1024);
        assert.equal(probe.stderr.length, 0);
      });
    }
  }
});

test("cut encodes large output delimiters in bounded writes without splitting surrogate pairs", async () => {
  const delimiter = "x".repeat(4095) + "😀" + "y".repeat(64 * 1024);
  for (const mode of ["b", "c", "f"]) {
    const stdin = mode === "f" ? "a,b,c\n" : "abc\n";
    const probe = cutProbe([`-${mode}`, "1,3", "--output-delimiter", delimiter, ...(mode === "f" ? ["-d", ","] : [])], toByteSource(stdin), new AbortController().signal, await fixture());
    const result = await textCommands().find(command => command.name === "cut")!.execute(probe.context);
    assert.equal(result.exitCode, 0);
    assert.ok(probe.stdout.length >= 2);
    assert.ok(probe.stdout.every(bytes => bytes.length <= 64 * 1024));
    assert.equal(Buffer.concat(probe.stdout).toString(), `a${delimiter}c\n`);
  }
});

test("cut preserves range union record and Unicode behavior across chunk boundaries", async () => {
  for (const mode of ["b", "c"]) {
    for (const ranges of ["5-,2-3,1-2,2", "1-3,5-", "-3,5-"]) {
      assert.equal((await run("cut", [`-${mode}`, ranges, "--output-delimiter=|"], { stdin: "abcdef\nabcdef" })).stdout, "abc|ef\nabc|ef\n");
    }
    assert.equal((await run("cut", [`-${mode}`, "1,2,3-4", "--output-delimiter=|"], { stdin: "abcdef\n" })).stdout, "abcd\n");
    assert.equal((await run("cut", [`-${mode}`, "2-4,3", "--complement"], { stdin: "abcdef\n" })).stdout, "aef\n");
    assert.equal((await run("cut", ["-z", `-${mode}`, "2"], { stdin: "abc\0def" })).stdout, "b\0e\0");
  }
  assert.equal((await run("cut", ["-d", ",", "-f", "4,1,3,3", "--output-delimiter=|"], { stdin: ",two,,\nplain\n" })).stdout, "||\nplain\n");
  assert.equal((await run("cut", ["-d", ",", "-f", "2", "--complement"], { stdin: ",two,,\n" })).stdout, ",,\n");
  assert.equal((await run("cut", ["-sd", ",", "-f", "2"], { stdin: "plain\n\na,b" })).stdout, "b\n");
  assert.equal((await run("cut", ["-d", "😀", "-f", "2,3"], { stdin: "a".repeat(4095) + "😀é😀z\n" })).stdout, "é😀z\n");
  const unicode = "a".repeat(4095) + "😀éz\n";
  assert.equal((await run("cut", ["-c", "4096-4097", "--output-delimiter=|"], { stdin: chunks(unicode, 137) })).stdout, "😀é\n");
  assert.equal((await run("cut", ["-c", "1-"], { stdin: unicode })).stdout, unicode);
  assert.deepEqual((await run("cut", ["-b", "1-"], { stdin: new Uint8Array([255, 195, 10]) })).stdoutBytes, Buffer.from([255, 195, 10]));
  assert.equal((await run("cut", ["-c", "1-"], { stdin: new Uint8Array([255, 195, 10]) })).stdout, "��\n");
  assert.equal((await run("cut", ["-c", "1-"], { stdin: "\uFEFFa\uFEFFb\n\uFEFFc\n" })).stdout, "\uFEFFa\uFEFFb\n\uFEFFc\n");
  assert.equal((await run("cut", ["-b", "1-"], { stdin: "\uFEFFa\n" })).stdout, "\uFEFFa\n");
  assert.equal((await run("cut", ["-b", Array(10001).fill("1").join(",")], { stdin: "abc\n" })).stdout, "a\n");
  for (const ranges of ["", "0", "3-1", "-", "1--2", "1,", ",1", "9007199254740992"]) {
    assert.equal((await run("cut", ["-b", ranges])).exitCode, 2, ranges);
  }
  assert.equal((await run("cut", ["-b", "01,, 2"], { stdin: "abc\n" })).stdout, "ab\n");
});
