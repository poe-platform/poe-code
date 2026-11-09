import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { evalSyncXargs } from "../../../src/commands/execution.js";

const cases = [
  { name: "raw", options: "-0", input: "8000ff00", output: "8000ff00" },
  { name: "empty", options: "-0", input: "", output: "00" },
  { name: "empty-records", options: "-0", input: "0000", output: "0000" },
  { name: "tail", options: "-0", input: "8000ff", output: "8000ff00" },
  { name: "literal", options: "-0", input: "6120620a27225cff00", output: "6120620a27225cff00" },
  { name: "bom", options: "-0", input: "efbbbf4100", output: "efbbbf4100" },
  { name: "unicode", options: "-0", input: "c3a900e4b8ad00", output: "c3a900e4b8ad00" },
  { name: "batch", options: "-0 -n1", input: "8000ff00", output: "8000ff00" },
  { name: "replace", options: "-0 -I{}", input: "8000ff00", operands: "'before{}after' '{}{}'", output: "6265666f7265806166746572008080006265666f7265ff616674657200ffff00" },
  { name: "delimiter", options: "-d :", input: "803aff3a", output: "8000ff00" },
  { name: "no-run", options: "-0 -r", input: "", output: "" },
  { name: "default-quotes", options: "", input: "276120622720635c20642022220a", output: "612062006320640000" },
];

for (const control of ["\r", "\v", "\f"]) for (const option of ["", "-L1", "-0"]) {
  const input = option === "-0" ? `a${control}b\0c${control}d\0` : `a${control}b\nc${control}d\n`;
  const expected = `[a${control}b][c${control}d]`;
  const name = `xargs preserves ${JSON.stringify(control)} with ${option || "default parsing"}`;
  test(`${name}, synchronous evaluator`, () => {
    assert.equal(evalSyncXargs(new TextEncoder().encode(input), [...(option ? [option] : []), "printf", "[%s]"]), expected);
  });
  for (const source of ["fragmented stdin", "argument file", "pipeline"]) test(`${name}, ${source}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(input);
    await fs.writeFile("/input", bytes);
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const stdin = (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })();
      const command = `xargs ${option} ${source === "argument file" ? "-a /input" : ""} printf '[%s]'`;
      const result = await shell.exec(source === "pipeline" ? `cat /input | ${command}` : command, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(expected));
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const fixture of cases) for (const fragmented of [false, true]) {
  test(`GNU byte oracle ${fixture.name}, fragmented=${fragmented}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
    const bytes = Buffer.from(fixture.input, "hex");
    const stdin = (async function* () {
      if (fragmented) for (const byte of bytes) yield Uint8Array.of(byte);
      else yield bytes;
    })();
    try {
      const result = await shell.exec(`xargs ${fixture.options} printf '%s\\0' ${fixture.operands ?? ""}`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.output);
      assert.equal(Buffer.from(result.stderrBytes).toString("hex"), "");
    } finally { await shell.dispose(); }
  });
}
