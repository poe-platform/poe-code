import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes } from "../../src/contracts/index.js";
import { chunks, fixture, run } from "./helpers.js";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

test("64 deterministic binary cases remain independent of source chunk boundaries", async () => {
  const next = random(0x51ab739d);
  for (let seed = 0; seed < 64; seed++) {
    const bytes = Buffer.from(Array.from({ length: next() % 257 }, () => next() & 255));
    const count = next() % 300;
    const operations = [
      { command: "cat", args: [], expected: bytes },
      { command: "head", args: ["-c", String(count)], expected: bytes.subarray(0, count) },
      { command: "tail", args: ["-c", String(count)], expected: count ? bytes.subarray(Math.max(0, bytes.length - count)) : Buffer.alloc(0) },
      { command: "tr", args: ["-d", "\\000-\\037"], expected: Buffer.from(bytes.filter(byte => byte >= 32)) },
    ];
    for (const width of [1, 7, 64]) for (const operation of operations) {
      const result = await run(operation.command, operation.args, { stdin: chunks(bytes, width) });
      assert.equal(result.exitCode, 0, `${seed}/${width}/${operation.command}: ${result.stderr}`);
      assert.deepEqual(result.stdoutBytes, operation.expected, `${seed}/${width}/${operation.command}`);
    }
  }
});

test("64 deterministic numeric sorts agree with an exact BigInt ordering model", async () => {
  const next = random(0x9fa172e1);
  for (let seed = 0; seed < 64; seed++) {
    const records = Array.from({ length: 24 }, () => String(BigInt(next()) * 1_000_000_007n - 2_000_000_000_000_000_000n));
    records.push(records[0]!);
    const expected = [...records].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const result = await run("sort", ["-n"], { stdin: chunks(records.join("\n") + "\n", seed % 17 + 1) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected.join("\n") + "\n", String(seed));
  }
});

test("64 deterministic fixed grep cases match raw byte subsequences", async () => {
  const next = random(0xaa41829d);
  for (let seed = 0; seed < 64; seed++) {
    const pattern = Buffer.from([128 + next() % 128, 128 + next() % 128]);
    const records = Array.from({ length: 12 }, (_, index) => index % 3 === 0
      ? Buffer.concat([Buffer.from([65]), pattern, Buffer.from([66])])
      : Buffer.from(Array.from({ length: next() % 20 }, () => 32 + next() % 224)));
    const stdin = Buffer.concat(records.flatMap(record => [record, Buffer.from("\n")]));
    const expected = Buffer.concat(records.filter(record => record.includes(pattern)).flatMap(record => [record, Buffer.from("\n")]));
    const fs = await fixture({ patterns: pattern });
    const result = await run("grep", ["-Ff", "patterns"], { fs, stdin: chunks(stdin, seed % 11 + 1) });
    assert.equal(result.exitCode, expected.length ? 0 : 1, result.stderr);
    assert.deepEqual(result.stdoutBytes, expected, String(seed));
  }
});

test("64 deterministic NUL-delimited xargs cases preserve literal argv and empty child stdin", async () => {
  const next = random(0xeab01973);
  const alphabet = ["", "a b", "$(touch stolen)", ";", "*", "'", '"', "\\", "line\nbreak", "é", "-n"];
  for (let seed = 0; seed < 64; seed++) {
    const args = Array.from({ length: 1 + next() % 20 }, () => alphabet[next() % alphabet.length]!);
    const batchSize = 1 + next() % 7;
    const batches: string[][] = [];
    const result = await run("xargs", ["-0", "-n", String(batchSize), "custom"], {
      stdin: chunks(args.join("\0") + "\0", seed % 9 + 1),
      async execute(context) {
        assert.equal((await collectBytes(context.stdin, { maxBytes: 1 })).length, 0);
        batches.push([...context.args]);
        return { exitCode: 0 };
      },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(batches.flat(), args, String(seed));
    assert(batches.every(batch => batch.length <= batchSize));
    await assert.rejects(result.fs.stat("/work/stolen"), { code: "ENOENT" });
  }
});

test("recursive copy and removal never follow preserved symlinks into another tree", async () => {
  for (const target of ["../protected", "/work/protected", "../source/../protected"]) {
    const fs = await fixture({ "source/file": "source", "protected/keep": "protected" });
    await fs.symlink(target, "/work/source/link");
    const copied = await run("cp", ["-R", "source", "copied"], { fs });
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.equal(await fs.readlink("/work/copied/link"), target);
    const removed = await run("rm", ["-r", "source", "copied"], { fs });
    assert.equal(removed.exitCode, 0, removed.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/protected/keep")).toString(), "protected");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["protected"]);
  }
});
