import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

const input = '<?xml version="1.0" encoding="ISO-8859-1"?><r>é</r>';
for (const [args, expected, latin1] of [
  [[], '<?xml version="1.0" encoding="ISO-8859-1"?>\n<r>é</r>\n', true],
  [["--xpath", "string(/r)"], "é\n", false],
  [["--encode", "UTF-8"], '<?xml version="1.0" encoding="UTF-8"?>\n<r>é</r>\n', false]
] as const) {
  test(`xmllint reads Latin-1 files: ${args.join(" ") || "plain output"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/l.xml", Uint8Array.from(input, c => c.charCodeAt(0)));
    const output: number[] = [];
    let stderr = "";
    const result = await createXmllintCommand().execute({
      command: "xmllint", ...createCommandArguments([...args, "l.xml"]),
      cwd: "/work", env: {}, fs, signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { output.push(...bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Uint8Array.from(output), latin1
      ? Uint8Array.from(expected, c => c.charCodeAt(0)) : new TextEncoder().encode(expected));
  });
}
