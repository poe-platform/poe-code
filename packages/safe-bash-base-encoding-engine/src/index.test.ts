import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createBaseCommand } from "./base.js";

test("encoding reports cumulative source bytes to the host input budget", async () => {
  const seen: number[] = [];
  const result = await createBaseCommand("base64", Infinity).execute({
    command: "base64", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: (async function* () { yield new TextEncoder().encode("ab"); yield new TextEncoder().encode("cd"); })(),
    stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
    inputBudget: { maxBytes: 3, check(total) { seen.push(total); if (total > 3) throw new Error("host limit"); } },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(seen, [2, 4]);
});

for (const [name, encoded] of [["base64", "aGVs\r\nbG8K\r\n"], ["base32", "NBSW\r\nY3DPBI======\r\n"]] as const) {
  test(`${name} decodes CRLF-wrapped data across chunk boundaries`, async () => {
    let output = "", error = "";
    const result = await createBaseCommand(name, Infinity).execute({
      command: name, args: ["-d"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
      stdin: (async function* () { for (const char of encoded) yield new TextEncoder().encode(char); })(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, error);
    assert.equal(output, "hello\n");
  });
}
test("portable engine preserves standard output bytes", async () => { let output = ""; const definition = createBaseCommand("base64", Infinity); const result = await definition.execute({ command: definition.name, args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource("hello"), stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }, signal: new AbortController().signal }); assert.equal(result.exitCode, 0); assert.equal(output, "aGVsbG8=\n"); });
