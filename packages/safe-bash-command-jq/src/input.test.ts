import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { run } from "./test-helpers.js";

for (const [flags, filter, stdin, stdout] of [
  ["-cn", "[input.name,input.name],[inputs.name]", '{"name":"build"}\n{"name":"test"}\n{"name":"lint"}\n', '["build","test"]\n["lint"]\n'],
  ["-cn", "[input,input]", "null\nfalse\n", "[null,false]\n"],
  ["-c", "[.,input]", "1\n2\n3\n4\n", "[1,2]\n[3,4]\n"],
  ["-Rcn", "input,[inputs]", "a\n\nb\n", '"a"\n["","b"]\n'],
  ["-scn", "input,[inputs]", "1\n2\n", "[1,2]\n[]\n"],
  ["-cn", "try input catch .", "", '"break"\n'],
  ["-cn", "input?,42", "", "42\n"],
  ["-cn", "input, (try input catch .)", "1\n", '1\n"break"\n'],
] as const) {
  test(`input shares the cursor: ${flags} ${filter} ${JSON.stringify(stdin)}`, async () => {
    const result = await run([flags, filter], stdin);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  });
}

test("input reports exhaustion as a runtime error", async () => {
  const result = await run(["-cn", "input"], "");
  assert.equal(result.exitCode, 5);
  assert.match(result.stderr, /break/);
});

test("input continues across files and updates input location", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one.json", new TextEncoder().encode("1\n"));
  await fs.writeFile("/two.json", new TextEncoder().encode("2\n3\n"));
  const result = await run(["-cn", "[input,input,input_filename,input_line_number],[inputs]", "/one.json", "/two.json"], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '[1,2,"/two.json",1]\n[3]\n');
});

test("input cannot suppress resource limits", async () => {
  const result = await run(["-cn", "input?"], '"large"', { limits: { maxInputBytes: 2 } });
  assert.equal(result.exitCode, 5);
  assert.match(result.stderr, /limit exceeded/);
});
