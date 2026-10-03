import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { command, evalSyncChecksum } from "./index.js";

const payload = new TextEncoder().encode("hello\n");
const filename = "/line\nname\\file";
async function run(args: string[], input = "", changed = false) {
  const fs = createMemoryFileSystem();
  await fs.writeFile(filename, changed ? new Uint8Array([0]) : payload);
  let stdout = "", stderr = "";
  const result = await command("cksum", "crc", Infinity).execute({
    command: "cksum", args, cwd: "/", env: {}, fs,
    stdin: (async function* () { for (const byte of new TextEncoder().encode(input)) yield Uint8Array.of(byte); })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

for (const [algorithm, sizes] of [
  ["md5", [0]], ["sha1", [0]], ["sha224", [0]], ["sha256", [0]],
  ["sha384", [0]], ["sha512", [0]], ["sm3", [0]],
  ["blake2b", [8, 128, 256, 512]], ["sha3", [224, 256, 384, 512]],
] as const) for (const bits of sizes) for (const base64 of [false, true]) {
  test(`cksum verifies ${algorithm}/${bits} ${base64 ? "base64" : "hex"} in async and sync routes`, async () => {
    const selection = ["-a", algorithm, ...(bits ? ["-l", String(bits)] : [])];
    const generated = await run([...selection, ...(base64 ? ["--base64"] : []), filename]);
    assert.equal(generated.exitCode, 0, generated.stderr);
    for (const args of [["-c"], ["-a", algorithm, "-c"], [...selection, "-c"]]) {
      const checked = await run(args, generated.stdout);
      assert.equal(checked.exitCode, 0, checked.stderr);
      assert.equal(checked.stdout, "\\/line\\nname\\\\file: OK\n");
      assert.equal(evalSyncChecksum("cksum", new TextEncoder().encode(generated.stdout), args, () => payload), checked.stdout);
      const changed = await run(args, generated.stdout, true);
      assert.equal(changed.exitCode, 1);
      assert.ok(changed.stdout.includes("FAILED"));
    }
  });
}

test("cksum tag overrides use the last option", async () => {
  const untagged = await run(["-a", "sha256", "--tag", "--untagged", filename]);
  const tagged = await run(["-a", "sha256", "--untagged", "--tag", filename]);
  assert.ok(!untagged.stdout.includes("SHA256"));
  assert.ok(tagged.stdout.includes("SHA256"));
});

test("cksum rejects malformed base64 and tag/digest length disagreement", async () => {
  const generated = await run(["-a", "sha256", "--base64", filename]);
  const manifest = generated.stdout;
  for (const invalid of [manifest.replace("=\n", "\n"), manifest.replace("=\n", "!\n"), manifest.replace("SHA256", "SHA512"),
    "SHA3-256 (/missing) = " + "a".repeat(56) + "\n",
    "BLAKE2b-128 (/missing) = " + "a".repeat(64) + "\n"]) {
    const result = await run(["-cw"], invalid);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("no properly formatted"), result.stderr);
    assert.equal(result.stdout, "");
  }
});

for (const algorithm of ["sha256", "blake2b", "sha3"]) test(`cksum verifies explicit untagged ${algorithm} base64`, async () => {
  const args = ["-a", algorithm, ...(algorithm === "sha3" ? ["-l", "256"] : [])];
  const generated = await run([...args, "--base64", "--untagged", filename]);
  assert.equal(generated.exitCode, 0, generated.stderr);
  const checked = await run([...args, "-c"], generated.stdout);
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.equal(evalSyncChecksum("cksum", new TextEncoder().encode(generated.stdout), [...args, "-c"], () => payload), checked.stdout);
  assert.equal((await run(["-c"], generated.stdout)).exitCode, 1);
});

test("sha256sum keeps its hex-only verification format", async () => {
  const generated = await run(["-a", "sha256", "--base64", filename]);
  const fs = createMemoryFileSystem();
  await fs.writeFile(filename, payload);
  const result = await command("sha256sum", "sha256", Infinity).execute({
    command: "sha256sum", args: ["-c"], cwd: "/", env: {}, fs,
    stdin: (async function* () { yield new TextEncoder().encode(generated.stdout); })(),
    stdout: { async write() { assert.fail("unexpected verification output"); } },
    stderr: { async write() {} }, signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(evalSyncChecksum("sha256sum", new TextEncoder().encode(generated.stdout), ["-c"], () => payload), undefined);
});
