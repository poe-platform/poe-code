import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createSplitCommand } from "./index.js";
import { parseArguments, settings } from "./options.js";

for (const prefix of ["-t", "-et", "--separator", "--separator="]) {
 for (const attached of prefix.endsWith("=") ? [true] : [false, true]) {
  if (prefix === "--separator" && attached) continue;
  for (const separator of [0x80, 0xfe, 0xff, ",", "\\0", "é", "", Uint8Array.of(0xfe, 0xff)]) {
   test(`split separator ${String(separator)} with ${prefix}, attached=${attached}`, async () => {
    const bytes = typeof separator === "number" ? Uint8Array.of(separator)
     : typeof separator === "string" ? new TextEncoder().encode(separator) : separator;
    const option = attached
     ? [shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode(prefix), ...bytes]))]
     : [prefix, shellValueFromBytes(bytes)];
    const values = createCommandArguments(["-l1", ...option, "/in"]);
    const fs = createMemoryFileSystem();
    const input = Uint8Array.of(97, 254, 98, 10, 99, 10, 100, 44, 101, 0, 102);
    await fs.writeFile("/in", input);
    let stderr = "";
    const result = await createSplitCommand().execute({
     command: "split", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C" }, fs,
     stdin: toByteSource(""), stdout: { async write() {} },
     stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
     signal: new AbortController().signal,
    });
    const valid = typeof separator === "number" || separator === "," || separator === "\\0";
    assert.equal(result.exitCode, valid ? 0 : 1, stderr);
    if (!valid) {
     assert.ok(stderr.includes("separator must be exactly one byte"));
     assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["in"]);
     return;
    }
    assert.equal(stderr, "");
    // GNU split on signed-char targets defaults high-bit separators to newline.
    const ends = separator === "," ? [8, 11] : separator === "\\0" ? [10, 11] : [4, 6, 11];
    let start = 0;
    for (const [index, end] of ends.entries()) {
     assert.deepEqual(await fs.readFile(`/xa${String.fromCharCode(97 + index)}`), input.slice(start, end));
     start = end;
    }
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["in", ...ends.map((_, index) => `xa${String.fromCharCode(97 + index)}`)]);
   });
  }
 }
}

test("split charges raw argument bytes before parsing a separator", () => {
 const values = createCommandArguments(["-t", shellValueFromBytes(Uint8Array.of(254))]);
 const parsed = parseArguments(values.args, settings({ limits: { maxArgumentBytes: 3 } }), values);
 assert.ok(!("information" in parsed));
 assert.equal(parsed.separator, 10);
 assert.throws(() => parseArguments(values.args, settings({ limits: { maxArgumentBytes: 2 } }), values), /split argument limit exceeded/u);
});

test("split treats high-bit separators as unset when checking repeated options", () => {
 for (const [first, second, expected] of [[254, 44, 44], [254, 255, 10], [254, 10, 10]]) {
  const values = createCommandArguments(["-t", shellValueFromBytes(Uint8Array.of(first!)), "-t", shellValueFromBytes(Uint8Array.of(second!))]);
  const parsed = parseArguments(values.args, settings({}), values);
  assert.ok("separator" in parsed);
  assert.equal(parsed.separator, expected);
 }
 for (const first of [44, 10]) {
  const values = createCommandArguments(["-t", shellValueFromBytes(Uint8Array.of(first)), "-t", shellValueFromBytes(Uint8Array.of(254))]);
  assert.throws(() => parseArguments(values.args, settings({}), values), /multiple separator characters specified/u);
 }
});
