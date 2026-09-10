import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

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
