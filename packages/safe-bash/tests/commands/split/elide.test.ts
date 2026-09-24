import assert from "node:assert/strict";
import { test } from "node:test";
import { files, run } from "./helpers.js";

test("elided chunks consume neither suffixes nor file quota", async () => {
  const uncapped = await run(["--numeric-suffixes=98", "-e", "-n5"], "ab");
  assert.equal(uncapped.exitCode, 0, uncapped.stderr);
  assert.deepEqual(await files(uncapped.fs), { x98: "61", x99: "62" });
  const result = await run(["--numeric-suffixes=98", "-e", "-n5"], "ab", {
    limits: { maxFiles: 2, maxSuffixLength: 2 },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { x98: "61", x99: "62" });
  const empty = await run(["-e", "-n1000"], "", { limits: { maxFiles: 1 } });
  assert.equal(empty.exitCode, 0, empty.stderr);
  assert.deepEqual(await files(empty.fs), {});
});

test("chunk counts determine initial suffix width in each alphabet", async () => {
  for (const [option, count, suffix] of [["-d", 150, "000"], ["-x", 257, "000"], ["", 677, "aaa"], ["-d", 100, "00"]] as const) {
    const result = await run([...(option ? [option] : []), "-e", `-n${count}`], "ab");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await result.fs.readFile(`/x${suffix}`).then(bytes => Buffer.from(bytes).toString()), "a");
  }
});

test("insufficient explicit or limited suffix width fails before creating files", async () => {
  for (const args of [["-a2", "-d", "-e", "-n105"], ["-a1", "-x", "-e", "-n17"]]) {
    const result = await run(args, "ab");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("the suffix length needs to be at least"));
    assert.deepEqual(await files(result.fs), {});
  }
  const capped = await run(["-d", "-e", "-n150"], "ab", { limits: { maxSuffixLength: 2 } });
  assert.equal(capped.exitCode, 1);
  assert.deepEqual(await files(capped.fs), {});
});

test("file quota still rejects nonempty outputs and unelided chunks", async () => {
  for (const [args, input] of [[["-e", "-n5"], "abc"], [["-n5"], ""]] as const) {
    const result = await run(args, input, { limits: { maxFiles: 2 } });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("file limit"));
  }
});
