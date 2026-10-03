import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createShufCommand } from "./index.js";

// Expected bytes verified against GNU coreutils shuf with the same entropy.
for (const { range, count, entropy, expected } of [
  { range: "1-2000000", count: 3, entropy: Uint8Array.from({ length: 64 }, (_, i) => i), expected: "259\n197639\n1546\n" },
  { range: "0-4294967295", count: 1, entropy: new Uint8Array(8).fill(255), expected: "4294967295\n" },
  { range: "1-18446744073709551615", count: 3, entropy: Uint8Array.from({ length: 64 }, (_, i) => i), expected: "283686952306184\n579005069656919569\n1157726452361532954\n" },
  { range: "9007199254740992-18446744073709551615", count: 3, entropy: Uint8Array.from({ length: 64 }, (_, i) => i), expected: "9290886207047175\n588012268911660560\n1166733651616273945\n" },
]) {
  test(`shuf samples ${range} exactly with storage bounded by the sample`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/entropy", entropy);
    let stdout = "";
    const result = await createShufCommand({ limits: { maxSampleSize: count, maxInputBytes: 64 } }).execute({
      command: "shuf", args: createCommandArguments(["-i", range, "-n", String(count), "--random-source=/entropy"]).args,
      fs, cwd: "/", env: {}, stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(stdout, expected);
  });
}

test("shuf samples 64-bit ranges with the synchronous secure entropy and unlimited defaults", async () => {
  let stdout = "";
  const result = await createShufCommand().execute({
    command: "shuf", args: ["-i", "9007199254740992-18446744073709551615", "-n", "3"],
    fs: createMemoryFileSystem(), cwd: "/", env: {}, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
  });
  assert.equal(result.exitCode, 0);
  const values = stdout.trim().split("\n").map(BigInt);
  assert.equal(values.length, 3);
  assert.equal(new Set(values).size, 3);
  assert.ok(values.every(value => value >= 9007199254740992n && value <= 18446744073709551615n));
});

test("shuf applies explicit sample quotas to selected count rather than range size", async () => {
  let stderr = "";
  const result = await createShufCommand({ limits: { maxSampleSize: 2 } }).execute({
    command: "shuf", args: ["-i", "1-2000000", "-n", "3"],
    fs: createMemoryFileSystem(), cwd: "/", env: {}, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() { assert.fail("over-budget sample emitted output"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stderr, "shuf: maxSampleSize limit exceeded\n");
});
