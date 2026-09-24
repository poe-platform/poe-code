import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../src/contracts/index.js";
import { registerYieldCheckpoint, scheduleTurn } from "../../src/contracts/yield.js";
import { createStandardCommands } from "../../src/commands/index.js";
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
  for (const flag of ["-V", "--version-sort"]) assert.equal((await run("sort", [flag], { stdin: "v10\nv2\n" })).stdout, "v2\nv10\n");
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

test("uniq emits every repeated record and separates selected groups", async () => {
  const fs = await fixture({ input: "a\na\nb\nc\nc\n" });
  for (const [option, expected] of [
    ["-D", "a\na\nc\nc\n"],
    ["--all-repeated", "a\na\nc\nc\n"],
    ["--all-repeated=none", "a\na\nc\nc\n"],
    ["--all-repeated=separate", "a\na\n\nc\nc\n"],
    ["--all-repeated=prepend", "\na\na\n\nc\nc\n"],
    ["--group", "a\na\n\nb\n\nc\nc\n"],
    ["--group=separate", "a\na\n\nb\n\nc\nc\n"],
    ["--group=prepend", "\na\na\n\nb\n\nc\nc\n"],
    ["--group=append", "a\na\n\nb\n\nc\nc\n\n"],
    ["--group=both", "\na\na\n\nb\n\nc\nc\n\n"],
  ]) {
    const result = await run("uniq", [option!, "input"], { fs });
    assert.equal(result.exitCode, 0, option);
    assert.equal(result.stdout, expected, option);
    assert.equal(result.stderr, "", option);
  }
  assert.equal((await run("uniq", ["-iD"], { stdin: chunks("A\na\na\nb\n") })).stdout, "A\na\na\n");
  assert.equal((await run("uniq", ["-uD"], { stdin: "a\na\nb\n" })).stdout, "");
  assert.deepEqual((await run("uniq", ["-D"], { stdin: chunks(Uint8Array.of(255, 10, 255, 10, 254, 10)) })).stdoutBytes, Buffer.from([255, 10, 255, 10]));
  assert.equal((await run("uniq", ["-z", "--group=both"], { stdin: chunks("a\0a\0b") })).stdout, "\0a\0a\0\0b\0\0");
  assert.equal((await run("uniq", ["--group=both"], { stdin: "" })).stdout, "");
  assert.equal((await run("uniq", ["--", "--group"], { fs: await fixture({ "--group": "a\na\n" }) })).stdout, "a\n");
  for (const stdin of ["", "only\n"]) {
    assert.equal((await run("uniq", ["--all-repeated=prepend"], { stdin })).stdout, "");
  }
  const result = await run("uniq", ["--group=append", "input", "output"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "a\na\n\nb\n\nc\nc\n\n");
});

test("uniq rejects invalid group methods and incompatible selections", async () => {
  for (const args of [["--all-repeated=append"], ["--group=none"], ["--group="], ["-cD"], ["--group", "-d"], ["--group", "-u"], ["--group", "-c"], ["--group", "-D"]]) {
    const result = await run("uniq", args, { stdin: "a\na\n" });
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.equal(result.stdout, "");
  }
});

test("uniq refuses aliased output before opening a writer", async () => {
  for (const [source, destination] of [
    ["input", "input"], ["./input", "input"], ["/work/input", "/work//input"],
    ["sub/../input", "input"], ["input", "symbolic"], ["symbolic", "input"],
    ["input", "hard"], ["hard", "input"], ["alias/input", "input"],
  ]) {
    const contents = "x\nx\ny\n";
    const fs = await fixture({ input: contents });
    await fs.mkdir("/work/sub");
    await fs.symlink("input", "/work/symbolic");
    await fs.symlink(".", "/work/alias");
    await fs.link("/work/input", "/work/hard");
    let writes = 0;
    const writeStream = fs.writeStream.bind(fs);
    fs.writeStream = async (...args) => { writes++; return writeStream(...args); };
    const result = await run("uniq", [source!, destination!], { fs });
    assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), contents, `${source} -> ${destination}`);
    assert.equal(writes, 0);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "uniq: input and output must be different files\n");
  }
});

test("uniq uses the last all-repeated option including bundled short flags", async () => {
  for (const args of [["--all-repeated=separate", "-D"], ["--all-repeated=prepend", "-iD"], ["--all-repeated=separate", "--all-repeated"]]) {
    const result = await run("uniq", args, { stdin: "x\nx\ny\ny\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "x\nx\ny\ny\n");
  }
  assert.equal((await run("uniq", ["-D", "--all-repeated=separate"], { stdin: "x\nx\ny\ny\n" })).stdout, "x\nx\n\ny\ny\n");
});

test("uniq refuses uncertain existing output identity without destroying a hidden hard link", async () => {
  const contents = "x\nx\ny\n";
  const fs = await fixture({ input: contents });
  await fs.link("/work/input", "/work/alias");
  const stat = fs.stat.bind(fs);
  fs.stat = async (...args) => {
    const result = { ...await stat(...args) };
    delete result.identityScope;
    return result;
  };
  fs.compareEntry = async () => "unknown";
  const result = await run("uniq", ["input", "alias"], { fs });
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), contents);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("cannot determine whether input and output are distinct files"));
});

test("uniq uses provider entry comparison when stat identity is unavailable", async () => {
  for (const comparison of ["same", "distinct"] as const) {
    const fs = await fixture({ input: "x\nx\ny\n", output: "old\n" });
    const stat = fs.stat.bind(fs);
    fs.stat = async (...args) => {
      const result = { ...await stat(...args) };
      delete result.identityScope;
      return result;
    };
    let compared = false;
    fs.compareEntry = async (path, peer, peerPath) => {
      assert.equal(path, "/work/input");
      assert.equal(peer, fs);
      assert.equal(peerPath, "/work/output");
      compared = true;
      return comparison;
    };
    const result = await run("uniq", ["input", "output"], { fs });
    assert.equal(compared, true);
    assert.equal(result.exitCode, comparison === "same" ? 2 : 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), comparison === "same" ? "old\n" : "x\ny\n");
  }
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

test("cut character selection preserves raw bytes in C and POSIX locales", async () => {
  const stdin = Uint8Array.of(255, 10, 195, 169, 10);
  for (const env of [{ LC_ALL: "C" }, { LC_ALL: "POSIX" }, { LC_CTYPE: "C" }, { LANG: "C" }, { LC_ALL: "", LC_CTYPE: "", LANG: "POSIX" }]) {
    for (const args of [["-c", "1"], ["--characters=1"]]) {
      const result = await run("cut", args, { stdin: chunks(stdin), env });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Buffer.from([255, 10, 195, 10]));
    }
    const fs = await fixture({ input: stdin });
    assert.deepEqual((await run("cut", ["-c", "1", "input"], { fs, env })).stdoutBytes, Buffer.from([255, 10, 195, 10]));
  }
});

test("cut character locale precedence selects bytes or Unicode characters", async () => {
  for (const env of [{ LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" }, { LC_ALL: "", LC_CTYPE: "POSIX", LANG: "en_US.UTF-8" }]) {
    assert.deepEqual((await run("cut", ["-c", "1"], { stdin: "é\n", env })).stdoutBytes, Buffer.from([195, 10]));
  }
  for (const env of [{}, { LC_ALL: "en_US.UTF-8", LC_CTYPE: "C", LANG: "C" }, { LC_CTYPE: "en_US.UTF-8", LANG: "C" }]) {
    assert.equal((await run("cut", ["-c", "1"], { stdin: "é\n", env })).stdout, "é\n");
  }
  assert.deepEqual((await run("cut", ["-zc", "2", "--complement", "--output-delimiter=|"], { stdin: Uint8Array.of(255, 195, 169, 0), env: { LC_ALL: "C" } })).stdoutBytes, Buffer.from([255, 124, 169, 0]));
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
    assert.equal((await run("cut", [`-${mode}`, "1,2,3-4", "--output-delimiter=|"], { stdin: "abcdef\n" })).stdout, "a|b|cd\n");
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
  assert.equal((await run("cut", ["-b", "01,, 2"], { stdin: "abc\n" })).exitCode, 2);
});

test("cut keeps adjacent range boundaries and merges only overlaps", async () => {
  for (const mode of ["-b", "-c"]) {
    for (const [list, expected] of [["1-2,3-4", "ab:cd\n"], ["3-4,1,2", "a:b:cd\n"], ["1-3,2-4", "abcd\n"], ["1,1,2-", "a:bcd\n"]]) {
      const result = await run("cut", [mode, list!, "--output-delimiter=:"], { stdin: "abcd\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    assert.equal((await run("cut", [mode, "1-2,3-4"], { stdin: "abcd\n" })).stdout, "abcd\n");
    assert.equal((await run("cut", [mode, "2,3", "--complement", "--output-delimiter=:"], { stdin: "abcdef\n" })).stdout, "a:def\n");
    const input = "a".repeat(4096) + "bc\n";
    assert.equal((await run("cut", [mode, "1-4096,4097-", "--output-delimiter=:"], { stdin: chunks(input, 137) })).stdout, "a".repeat(4096) + ":bc\n");
  }
  assert.equal((await run("cut", ["-c", "1,2-3", "--output-delimiter=:"], { stdin: "é😀z\n" })).stdout, "é:😀z\n");
});

test("cut accepts blank separators and padding while rejecting empty comma items", async () => {
  for (const mode of ["-b", "-c", "-f"]) {
    const args = mode === "-f" ? ["-d", ":"] : [];
    const stdin = mode === "-f" ? "a:b:c\n" : "abc\n";
    for (const list of [" 1,2", "1,2 ", "1\t2", "\t1 , \t2\t ", "1  2", "1,\t2", "1 2,3"]) {
      const result = await run("cut", [mode, list, ...args, "--output-delimiter=|"], { stdin });
      assert.equal(result.exitCode, 0, `${JSON.stringify(list)}: ${result.stderr}`);
      assert.equal(result.stdout, list === "1 2,3" ? "a|b|c\n" : "a|b\n");
    }
    for (const list of ["1,,2", "1, ,2", "1,\t,2", ",1", "1,", "1, ", " \t", "1\n2"]) {
      const result = await run("cut", [mode, list, ...args], { stdin });
      assert.equal(result.exitCode, 2, JSON.stringify(list));
      assert.equal(result.stdout, "");
    }
  }
});

test("cut rejects undocumented short options", async () => {
  for (const args of [["-b", "1,2", "-o", ":"], ["-b", "1", "-C"]]) {
    const result = await run("cut", args, { stdin: "ab\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
});

test("cut field mode works with portable Buffer indexOf contracts", async () => {
  const indexOf = Buffer.prototype.indexOf;
  const descriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "indexOf")!;
  Object.defineProperty(Buffer.prototype, "indexOf", {
    ...descriptor,
    value(this: Buffer, needle: string | number | Uint8Array, offset?: number, encoding?: BufferEncoding) {
      if (needle instanceof Uint8Array && !Buffer.isBuffer(needle)) {
        throw new TypeError("val must be string, number or Buffer");
      }
      return indexOf.call(this, needle, offset, encoding);
    },
  });
  try {
    const commands = createStandardCommands();
    const stdin = await run("cut", ["-f", "2,3"], { commands, stdin: "a\tb\t\nc\t\td\n" });
    assert.equal(stdin.exitCode, 0, stdin.stderr);
    assert.equal(stdin.stdout, "b\t\n\td\n");

    const fs = await fixture({ rows: "a,b\nc,,d\n" });
    const file = await run("cut", ["-d", ",", "-f", "2,3", "rows"], { commands, fs });
    assert.equal(file.exitCode, 0, file.stderr);
    assert.equal(file.stdout, "b\n,d\n");
  } finally {
    Object.defineProperty(Buffer.prototype, "indexOf", descriptor);
  }
});
