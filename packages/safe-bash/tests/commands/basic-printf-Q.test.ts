import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";

const entries = [
  { format: "%Q", value: "a b c", output: "a\\ b\\ c" },
  { format: "%.3Q", value: "a b c", output: "a\\ b" },
  { format: "%#.3Q", value: "a b c", output: "'a b'" },
  { format: "%10.3Q", value: "a b c", output: "      a\\ b" },
  { format: "%-10.3Q", value: "a b c", output: "a\\ b      " },
  { format: "%.0Q", value: "a b c", output: "''" },
  { format: "%.3Q", value: "🐳", output: "$'\\360\\237\\220'" },
  { format: "%Q", value: "one\ntwo", output: "$'one\\ntwo'" },
  { format: "%#.2Q", value: "a'b", output: "'a'\\'''" },
];
for (const entry of entries) for (const raw of [false, true]) {
  test(`printf Q ${entry.format} ${JSON.stringify(entry.value)} raw=${raw}`, async () => {
    const argumentValues = createCommandArguments([entry.format, raw ? shellValueFromBytes(Buffer.from(entry.value)) : entry.value]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(entry.output));
  });
}

for (const entry of [
  { format: "%.3Q", value: "a b c", expected: "a\\ b" },
  { format: "%#10.3Q", value: "a b c", expected: "     'a b'" },
  { format: "%.3Q", value: "🐳", expected: "$'\\360\\237\\220'" },
]) for (const route of ["direct", "assignment", "substitution", "loop", "redirection"]) {
  test(`current source ${entry.format} ${JSON.stringify(entry.value)} via ${route}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    try {
      const invocation = `printf '${entry.format}' "$VALUE"`;
      const script = route === "direct" ? invocation
        : route === "assignment" ? `printf -v result '${entry.format}' "$VALUE"; printf %s "$result"`
        : route === "substitution" ? `result=$(${invocation}); printf %s "$result"`
        : route === "loop" ? `for value in "$VALUE"; do printf '${entry.format}' "$value"; done`
        : `${invocation} > /work/quoted; printf %s "$(< /work/quoted)"`;
      const result = await shell.exec(script, { env: { LC_ALL: "C.UTF-8", VALUE: entry.value } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.expected));
    } finally { await shell.dispose(); }
  });
}
