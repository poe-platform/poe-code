import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCommandArguments, FsError } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { authenticateOracle, entropy, native, nativeOptions, run } from "./helpers.js";

test("review: entropy cleanup cannot replace an escaping output failure", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", entropy);
  const primary = new Error("primary output failure");
  const cleanup = new Error("entropy return failure");
  let returns = 0;
  fs.readStream = () => ({
    [Symbol.asyncIterator]() {
      return {
        async next() { assert.fail("single-choice output does not need entropy bytes"); },
        async return() { returns++; throw cleanup; },
      };
    },
  });
  await assert.rejects(run(["-e", "x", "--random-source=/random"], undefined, undefined, {
    fs, stdout: { async write() { throw primary; } },
  }), reason => reason === primary);
  assert.equal(returns, 1);
});

test("review: falsey execution failures and diagnostic sink failures survive cleanup", async () => {
  for (const primary of [undefined, null, false, 0, "", new Error("diagnostic sink failure")]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/random", entropy);
    let returns = 0;
    fs.readStream = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { assert.fail("unused entropy"); },
          async return() { returns++; throw new Error("cleanup failure"); },
        };
      },
    });
    const operation = run(["-e", "x", "--random-source=/random"], undefined, undefined, {
      fs,
      stdout: { async write() { throw primary instanceof Error ? new FsError("EIO") : primary; } },
      stderr: { async write() { throw primary; } },
    });
    await assert.rejects(operation, reason => reason === primary);
    assert.equal(returns, 1);
  }
});

test("review: cleanup failure after successful execution remains observable", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", entropy);
  const cleanup = new Error("cleanup is the only failure");
  let returns = 0;
  fs.readStream = () => ({
    [Symbol.asyncIterator]() {
      return {
        async next() { assert.fail("unused entropy"); },
        async return() { returns++; throw cleanup; },
      };
    },
  });
  await assert.rejects(run(["-e", "x", "--random-source=/random"], undefined, undefined, { fs }), reason => reason === cleanup);
  assert.equal(returns, 1);
});

for (const reason of [undefined, null, false, 0, new FsError("EIO")]) {
  test(`review: caller cancellation outranks rejected entropy cleanup: ${String(reason)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/random", entropy);
    const controller = new AbortController();
    const cleanup = new Error("entropy return failure");
    let returns = 0;
    fs.readStream = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { assert.fail("unused entropy"); },
          async return() { returns++; throw cleanup; },
        };
      },
    });
    const operation = run(["-e", "x", "--random-source=/random"], undefined, undefined, {
      fs, signal: controller.signal,
      stdout: { async write() { controller.abort(reason); } },
    });
    await assert.rejects(operation, error => error === controller.signal.reason);
    assert.equal(returns, 1);
  });
}

test("review: nonregular named input uses GNU unknown-size reservoir selection", nativeOptions, async () => {
  const fs = createMemoryFileSystem();
  const bytes = Buffer.from("a\nb\nc\nd\ne\nf\ng\n");
  await fs.writeFile("/input", bytes);
  await fs.writeFile("/random", entropy);
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => ({
    ...await stat(path, options), ...(path === "/input" ? { type: "character" as const, size: 0 } : {}),
  });
  const actual = await run(["--random-source=/random", "-n2", "/input"], undefined, undefined, { fs });
  const expected = await native(["--random-source=/dev/fd/3", "-n2"], bytes);
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, expected);
});

test("review: invalid count diagnostics preserve raw argument bytes", nativeOptions, async () => {
  const oracle = await authenticateOracle();
  for (const byte of [254, 255]) {
    const carrier = createCommandArguments(["-n", shellValueFromBytes(Uint8Array.of(byte))]);
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
      'exec -a shuf "$1" -n "$(printf \'%b\' "\\\\$2")"', "shuf-review", oracle, byte.toString(8)], {
      env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 8192,
    });
    assert.ifError(expected.error);
    assert.equal(expected.signal, null);
    assert.equal(expected.status, 1);
    assert.equal(expected.stderr.toString(), `shuf: invalid line count: '\\${byte.toString(8)}'\n`);
    const actual = await run(carrier.args, undefined, undefined, { argumentValues: carrier });
    assert.equal(actual.exitCode, expected.status);
    assert.deepEqual(actual.stdout, expected.stdout);
    assert.deepEqual(Buffer.from(actual.stderrHex, "hex"), expected.stderr);
  }
});

test("review: attached and separate count options preserve raw value bytes", nativeOptions, async () => {
  const oracle = await authenticateOracle();
  const raw = Buffer.from([0xff, 0x27, 0x0a, 0xfe]);
  for (const prefix of ["-n", "-ern", "--head-count=", "--head-c="]) {
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
      'exec -a shuf "$1" "$2$(printf \'\\377\\047\\012\\376\')"', "shuf-review", oracle, prefix], {
      env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 8192,
    });
    assert.ifError(expected.error);
    assert.equal(expected.signal, null);
    assert.equal(expected.status, 1);
    for (const attached of [true, false]) {
      if (!attached && prefix === "-ern") continue;
      const carrier = createCommandArguments(attached
        ? [shellValueFromBytes(Buffer.concat([Buffer.from(prefix), raw]))]
        : [prefix.endsWith("=") ? prefix.slice(0, -1) : prefix, shellValueFromBytes(raw)]);
      const actual = await run(carrier.args, undefined, undefined, { argumentValues: carrier });
      assert.equal(actual.exitCode, expected.status);
      assert.deepEqual(actual.stdout, expected.stdout);
      assert.deepEqual(Buffer.from(actual.stderrHex, "hex"), expected.stderr, JSON.stringify({ prefix, attached }));
    }
  }
});

test("review: seeded selections agree across varied entropy and integer widths", nativeOptions, async () => {
  for (const seed of [0, 1, 127, 255]) {
    const random = Uint8Array.from({ length: 512 }, (_, index) => (seed + 13 * index + index * index) % 256);
    for (const options of [["-n4"], ["-z", "-rn7"], ["-i0-4294967296", "-n6"], ["-i9007199254740993-18446744073709551614", "-rn5"]]) {
      const args = ["--random-source=/dev/fd/3", ...options];
      const input = Buffer.from([255, 0, 10, 254, 0, 10, 97, 10, 98, 0, 10, 99, 10, 100, 0]);
      const actual = await run(args, input, random);
      const expected = await native(args, input, random);
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, expected, JSON.stringify({ seed, options }));
    }
  }
});
