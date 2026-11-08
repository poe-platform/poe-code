import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { run } from "./test-helpers.js";

for (const filter of ["input", "[inputs]"]) {
  test(`catch receives the native parse error value from ${filter}`, async () => {
    const result = await run(["-cn", `try ${filter} catch .`], '{"name":]\n');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, JSON.stringify("Unmatched ']' at line 1, column 9") + "\n");
  });
}

test("uncaught JSON input errors retain the CLI diagnostic", async () => {
  const result = await run(["-c", "."], '{"name":]\n');
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: parse error: Unmatched ']' at line 1, column 9\n");
});

for (const operands of [["a", "absent", "b"], ["absent", "a", "b"], ["a", "b", "absent"]]) {
  for (const [flags, filter, expected] of [
    ["-c", ".name", '"a"\n"b"\n'],
    ["-ce", ".name", '"a"\n"b"\n'],
    ["-cs", "map(.name)", '["a","b"]\n'],
    ["-nc", "[inputs | .name]", '["a","b"]\n'],
    ["-Rs", ".", '"{\\"name\\":\\"a\\"}\\n{\\"name\\":\\"b\\"}\\n"\n'],
  ] as const) {
    test(`unreadable operand does not stop ${flags} ${filter}: ${operands.join(" ")}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/a", new TextEncoder().encode('{"name":"a"}\n'));
      await fs.writeFile("/b", new TextEncoder().encode('{"name":"b"}\n'));
      const result = await run([flags, filter, ...operands], "", {}, { fs });
      assert.equal(result.stdout, expected);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, "jq: error: Could not open file absent: No such file or directory\n");
    });
  }
}

for (const streamingRead of [true, false]) {
  test(`missing-only slurp still produces an empty array (streaming=${streamingRead})`, async () => {
    const fs = new MemoryFileSystem();
    Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, streamingRead } });
    const result = await run(["-cs", ".", "./absent"], "", {}, { fs });
    assert.equal(result.stdout, "[]\n");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "jq: error: Could not open file ./absent: No such file or directory\n");
  });
}

test("one-byte file chunks continue after a missing operand", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode('{"name":"a"}\n'));
  await fs.writeFile("/b", new TextEncoder().encode('{"name":"b"}\n'));
  const readStream = fs.readStream.bind(fs);
  fs.readStream = async function* (path, options) {
    for await (const chunk of readStream(path, options)) {
      for (const byte of chunk) yield Uint8Array.of(byte);
    }
  };
  const result = await run(["-nc", "[inputs | .name]", "a", "absent", "b"], "", {}, { fs });
  assert.equal(result.stdout, '["a","b"]\n');
  assert.equal(result.exitCode, 2);
});
