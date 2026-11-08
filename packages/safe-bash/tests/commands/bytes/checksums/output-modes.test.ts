import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Shell } from "../../../../src/shell/index.js";
import { chunks, encoder, fixture, registry, run } from "./helpers.js";

const hex = "a4b453d2560e8ab0c4037262c3337c0fca1058694e5361e81e6a1e29978918c1";
const base64 = "pLRT0lYOirDEA3JiwzN8D8oQWGlOU2HoHmoeKZeJGME=";
const input = "Independent checksum bytes\n";

test("cksum admits native SHA256 output modes", async () => {
  const fs = await fixture({ input });
  for (const [flags, expected] of [
    [["--untagged"], `${hex}  input\n`],
    [["--base64"], `SHA256 (input) = ${base64}\n`],
    [["--untagged", "--base64"], `${base64}  input\n`],
    [["--untagged", "-b"], `${hex} *input\n`],
  ] as const) {
    const result = await run("cksum", ["-a", "sha256", ...flags, "input"], { fs });
    assert.deepEqual(result, { exitCode: 0, stdout: expected, stderr: "" });
  }
});

test("cksum raw output preserves digest bytes without a filename or delimiter", async () => {
  const fs = await fixture({ input, second: input });
  const writes: Uint8Array[] = [];
  const result = await run("cksum", ["-a", "sha256", "--raw", "input", "second"], {
    fs, stdout: { async write(bytes) { writes.push(bytes.slice()); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.concat(writes), Buffer.from(hex.repeat(2), "hex"));
});

test("cksum output modes retain streaming stdin, escaping and zero termination", async () => {
  assert.equal((await run("cksum", ["-a", "sha256", "--untagged"], {
    stdin: chunks(encoder.encode(input), 1),
  })).stdout, `${hex}  -\n`);
  const fs = await fixture({ "line\nname": input });
  assert.equal((await run("cksum", ["-a", "sha256", "--untagged", "line\nname"], { fs })).stdout,
    `\\${hex}  line\\nname\n`);
  assert.equal((await run("cksum", ["-a", "sha256", "--untagged", "-z", "line\nname"], { fs })).stdout,
    `${hex}  line\nname\0`);
});

test("cksum raw and Base64 modes preserve binary input for every supported hash", async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const algorithm of ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) {
    const expected = createHash(algorithm).update(bytes).digest();
    const writes: Uint8Array[] = [];
    const result = await run("cksum", ["-a", algorithm, "--raw"], {
      stdin: chunks(bytes, 7), stdout: { async write(chunk) { writes.push(chunk.slice()); } },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(writes), expected);
    assert.deepEqual(await run("cksum", ["-a", algorithm, "--base64"], { stdin: chunks(bytes, 1) }), {
      exitCode: 0, stderr: "", stdout: `${algorithm.toUpperCase()} (-) = ${expected.toString("base64")}\n`,
    });
  }
});

test("cksum output modes work through Shell pipes and VFS redirection", async () => {
  const fs = await fixture({ input });
  const shell = new Shell({ fs, commands: registry, cwd: "/work" });
  try {
    assert.equal((await shell.exec("cksum -a sha256 --untagged input | sha256sum -c")).stdout, "input: OK\n");
    const result = await shell.exec("cksum -a sha256 --raw input > digest");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/digest")), Buffer.from(hex, "hex"));
    assert.deepEqual(Buffer.from((await shell.exec("cksum -a sha256 --raw input")).stdoutBytes), Buffer.from(hex, "hex"));
  } finally { await shell.dispose(); }
});
