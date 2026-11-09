import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { evalSyncSplit } from "./index.js";
import { parseArguments, settings } from "./options.js";
import { chunks, files, run } from "./test-helpers.js";

for (const option of ["-b", "-l", "-C"]) {
  const counts = ["9007199254740992", "9007199254740993", "18446744073709551615", "18446744073709551616"];
  if (option !== "-l") counts.push("1P", "1E", "1EB", "1EiB", "1Q");
  for (const count of counts) {
    test(`${option} ${count} splits tiny files and streams without large allocations`, async () => {
      const input = Buffer.from("a\nb\nc");
      const expected = { xaa: input.toString("hex") };
      const streamed = await run([option, count], chunks(input, 1, true), { limits: { maxChunkBytes: 1, maxFiles: 1 } });
      assert.equal(streamed.exitCode, 0, streamed.stderr);
      assert.deepEqual(await files(streamed.fs), expected);

      const fs = createMemoryFileSystem();
      await fs.writeFile("/in", input);
      const file = await run([option, count, "in"], "", {}, { fs });
      assert.equal(file.exitCode, 0, file.stderr);
      assert.deepEqual(await files(fs), { in: input.toString("hex"), ...expected });

      const written: Record<string, string> = {};
      assert.equal(evalSyncSplit(input, [option, count], undefined, (path, bytes) => {
        written[path] = Buffer.from(bytes).toString("hex");
        return true;
      }), "");
      assert.deepEqual(written, expected);
    });
  }
}

test("large counts retain every digit and exact unit multiplication", () => {
  const lines = parseArguments(["-l", "9007199254740993"], settings({}));
  const bytes = parseArguments(["-b", "9007199254740993kB"], settings({}));
  assert.ok("size" in lines);
  assert.ok("size" in bytes);
  assert.equal(lines.size, 9007199254740993n);
  assert.equal(bytes.size, 9007199254740993000n);
});

test("large byte and line counts preserve explicit input, output, and work limits", async () => {
  for (const option of ["-b", "-l"]) {
    for (const [limit, diagnostic] of [["maxInputBytes", "input"], ["maxOutputBytes", "output"], ["maxSteps", "work"]] as const) {
      const result = await run([option, "9007199254740993"], "abc", { limits: { [limit]: 2 } });
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(`${diagnostic} limit`), result.stderr);
    }
  }
});

test("large line-byte counts preserve buffer admission before reading", async () => {
  let read = false;
  const input = (async function* () { read = true; yield Buffer.from("abc"); })();
  const result = await run(["-C", "1E"], input, { limits: { maxBufferBytes: 8 } });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("buffer limit"), result.stderr);
  assert.equal(read, false);
  assert.deepEqual(await files(result.fs), {});
});

test("invalid large counts fail before overwriting an existing output", async () => {
  for (const args of [["-b", "1EX"], ["-l", "1E"], ["-b", "0E"], ["-l", "-9007199254740993"], ["-b", "9007199254740993.5"]]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/xaa", Buffer.from("keep"));
    const result = await run(args, "abc", {}, { fs });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await files(fs), { xaa: Buffer.from("keep").toString("hex") });
  }
});

test("huge logical counts allocate only for actual data", async () => {
  const Original = globalThis.Uint8Array;
  const allocations: number[] = [];
  globalThis.Uint8Array = new Proxy(Original, {
    construct(target, args) {
      if (typeof args[0] === "number") allocations.push(args[0]);
      return Reflect.construct(target, args);
    },
  });
  try {
    for (const option of ["-b", "-l", "-C"]) {
      for (const input of ["", "abc"]) {
        const result = await run([option, "9007199254740993"], input);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(await files(result.fs), input ? { xaa: "616263" } : {});
      }
    }
    assert.ok(allocations.every(size => size <= 65536), `allocations: ${allocations}`);
  } finally {
    globalThis.Uint8Array = Original;
  }
});

test("legacy large line counts accept tiny input", async () => {
  const result = await run(["-9007199254740992"], "a\nb\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: "610a620a" });
});
