import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";

for (const entry of [
  { value: "foo", quoted: "'foo'" },
  { value: "a b", quoted: "'a b'" },
  { value: "a'b", quoted: "'a'\\''b'" },
  { value: "", quoted: "''" },
  { value: "🐳", quoted: "'🐳'" },
  { value: "one\ntwo", quoted: "$'one\\ntwo'" },
]) for (const raw of [false, true]) for (const precision of [undefined, 0, 3]) for (const left of [false, true]) {
  test(`printf alternate q ${JSON.stringify(entry.value)} raw=${raw} precision=${precision} left=${left}`, async () => {
    const argumentValues = createCommandArguments([`%${left ? "-" : ""}#10${precision === undefined ? "" : "." + precision}q`, raw ? shellValueFromBytes(Buffer.from(entry.value)) : entry.value]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    const bytes = Buffer.from(entry.quoted).subarray(0, precision);
    const padding = Buffer.from(" ".repeat(Math.max(0, 10 - bytes.length)));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat(left ? [bytes, padding] : [padding, bytes]));
  });
}

for (const entry of [
  { format: "%#q", value: "a'b", expected: "'a'\\''b'" },
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
