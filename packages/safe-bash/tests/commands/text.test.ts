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
