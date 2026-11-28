import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem } from "../../../../src/index.js";
import { agentCommands } from "../../../../src/plugins/index.js";

test("basenc URL-safe tokens, hexadecimal decoding and base32 pipelines", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("printf 'hello?>' | basenc --base64url; echo \"rc=$?\"; printf '68656C6C6F' | basenc --base16 -d; echo; printf 'hello' | basenc --base32");
  assert.equal(result.stdout, "aGVsbG8_Pg==\nrc=0\nhello\nNBSWY3DP\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

import { allBytes, run, sliced, withStream } from "./helpers.js";

for (const [encoding, raw, encoded] of [
  ["base64", "hello", "aGVsbG8="], ["base64url", "hello?>", "aGVsbG8_Pg=="],
  ["base32", "hello", "NBSWY3DP"], ["base32hex", "hello", "D1IMOR3F"],
  ["base16", "hello", "68656C6C6F"], ["base2msbf", "a", "01100001"],
  ["base2lsbf", "a", "10000110"], ["z85", "test", "By/Jn"],
]) {
  test(`basenc ${encoding} vectors and binary streaming roundtrip`, async () => {
    assert.equal((await run("basenc", [`--${encoding}`], raw)).stdout, encoded + "\n");
    assert.equal((await run("basenc", [`--${encoding}`, "-d"], encoded)).stdout, raw);
    for (const width of [1, 3, 8192]) {
      const result = await run("basenc", [`--${encoding}`, "-w7"], sliced(allBytes, width));
      assert.equal(result.exitCode, 0, result.stderr);
      const decoded = await run("basenc", [`--${encoding}`, "-d"], sliced(Buffer.from(result.stdout), width));
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(decoded.bytes, Buffer.from(allBytes));
    }
  });
}

test("basenc options, streaming files, garbage and invalid quanta", async () => {
  assert.notEqual((await run("basenc", [], "hello")).exitCode, 0);
  assert.equal((await run("basenc", ["--base16", "-w0", "input"], "", { fs: withStream(sliced(Buffer.from("hello"))) })).stdout, "68656C6C6F");
  assert.equal((await run("basenc", ["--base16", "-di"], "68!65\n6C6C6F")).stdout, "hello");
  for (const [encoding, input] of [["base16", "6"], ["base16", "6="], ["base2msbf", "000"], ["z85", "####"], ["z85", "#####"]]) {
    assert.notEqual((await run("basenc", [`--${encoding}`, "-d"], input)).exitCode, 0);
  }
  assert.notEqual((await run("basenc", ["--z85"], "abc")).exitCode, 0);
});
