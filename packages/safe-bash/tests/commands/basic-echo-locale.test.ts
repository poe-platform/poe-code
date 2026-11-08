import assert from "node:assert/strict";
import test from "node:test";
import { run, fixture } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";
import { createStandardCommands } from "../../src/commands/index.js";

test("external GNU echo retains literal Unicode escapes", async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec("env echo -e '\\u0041\\U0001f433'", { env: { LC_ALL: "C.UTF-8" } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "\\u0041\\U0001f433\n");
  } finally { await shell.dispose(); }
});

const cases = [
  // Three different character widths, derived from Bash tests/unicode2.sub.
  { operand: "\\u0041 \\u00a3 \\u0152", ascii: "41205c7530304133205c7530313532", utf8: "4120c2a320c592" },
  { operand: "\\u0041", ascii: "41", utf8: "41" },
  { operand: "\\u00e9", ascii: "5c7530304539", utf8: "c3a9" },
  { operand: "\\U0001f433", ascii: "5c553030303146343333", utf8: "f09f90b3" },
  { operand: "\\u0G", ascii: "0047", utf8: "0047" },
  { operand: "\\u", ascii: "5c75", utf8: "5c75" },
  { operand: "\\U80000000", ascii: "", utf8: "" },
];
for (const locale of ["C", "POSIX", "C.UTF-8"]) {
  for (const entry of cases) test(`echo Unicode ${entry.operand} under ${locale}`, async () => {
    const expected = (locale === "C.UTF-8" ? entry.utf8 : entry.ascii) + "0a";
    const result = await run("echo", ["-e", entry.operand], { env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutBytes.toString("hex"), expected);
    const argumentValues = createCommandArguments(["-e", shellValueFromBytes(Buffer.from(entry.operand))]);
    const chunks: Uint8Array[] = [];
    await basicCommands().find(command => command.name === "echo")!.execute({
      command: "echo", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: locale },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    assert.equal(Buffer.concat(chunks).toString("hex"), expected);
  });
  test(`echo Unicode shell invocation routes under ${locale}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    try {
      for (const script of [
        "echo -ne '\\u00e9'",
        'echo -ne "$VALUE"',
        'for value in "$VALUE"; do echo -ne "$value"; done',
        'value=$(echo -ne "$VALUE"); printf %s "$value"',
        'echo -ne "$VALUE" > /work/echo; printf %s "$(< /work/echo)"',
      ]) {
        const result = await shell.exec(script, { env: { LC_ALL: locale, VALUE: "\\u00e9" } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), locale === "C.UTF-8" ? "c3a9" : "5c7530304539", script);
      }
    } finally { await shell.dispose(); }
  });
}
