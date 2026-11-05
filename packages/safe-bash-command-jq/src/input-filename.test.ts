import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { run } from "./test-helpers.js";

for (const flags of [[], ["-R"], ["--stream"]]) {
  test(`input_filename reports stdin (${flags.join(" ")})`, async () => {
    const result = await run(["-c", ...flags, "input_filename"], new TextEncoder().encode("1\n2\n"));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '"<stdin>"\n"<stdin>"\n');
  });
}

test("input_filename is null before reading input, including file variables", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/arg.json", new TextEncoder().encode("1"));
  const result = await run(["-cn", "--slurpfile", "arg", "/arg.json", "input_filename"], "2", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "null\n");
});

test("input_filename follows file and explicit stdin operands", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one.json", new TextEncoder().encode("1\n2\n"));
  await fs.writeFile("/<unknown>", new TextEncoder().encode("3\n"));
  const result = await run(["-c", "input_filename", "one.json", "-", "<unknown>"], "4\n", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '"one.json"\n"one.json"\n"<stdin>"\n"<unknown>"\n');
});

test("input_filename follows inputs and remains available after slurping", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one.json", new TextEncoder().encode("1\n"));
  await fs.writeFile("/two.json", new TextEncoder().encode("2\n"));
  const result = await run(["-cn", "input_filename, (inputs | input_filename), input_filename", "/one.json", "/two.json"], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'null\n"/one.json"\n"/two.json"\n"/two.json"\n');
  const slurp = await run(["-cs", "input_filename", "/one.json", "/two.json"], "", {}, { fs });
  assert.equal(slurp.exitCode, 0, slurp.stderr);
  assert.equal(slurp.stdout, '"/two.json"\n');
});

for (const flags of [["-c"], ["-cn"]]) {
  test(`input_filename with a single virtual file (${flags.join(" ")})`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.json", new TextEncoder().encode("1\n2\n"));
    const result = await run([...flags, "input_filename", "./data.json"], "", {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, flags[0] === "-cn" ? "null\n" : '"./data.json"\n"./data.json"\n');
  });
}
