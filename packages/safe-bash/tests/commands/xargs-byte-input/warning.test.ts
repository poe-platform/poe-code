import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

const warning = "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n";

for (const fixture of [
  { options: "-0 -E END", input: "454e44008000", output: "454e44008000", warning: true },
  { options: "-E END -0", input: "454e4400", output: "454e4400", warning: true },
  { options: "-d : -E END", input: "454e443aff3a", output: "454e4400ff00", warning: true },
  { options: "-0 -E ''", input: "454e4400", output: "454e4400", warning: false },
  { options: "-0 -E END -E ''", input: "454e4400", output: "454e4400", warning: false },
  { options: "-0 -E '' -E END", input: "454e4400", output: "454e4400", warning: true },
  { options: "-0 -r -E END", input: "", output: "", warning: true },
]) test(`GNU ineffective EOF warning: ${fixture.options}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec(`xargs ${fixture.options} printf '%s\\0'`, { stdin: Buffer.from(fixture.input, "hex") });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.output);
    assert.equal(Buffer.from(result.stderrBytes).toString("hex"), Buffer.from(fixture.warning ? warning : "").toString("hex"));
  } finally { await shell.dispose(); }
});

test("warning output shares the Shell byte budget before input admission", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  let acquired = false;
  const stdin = { async *[Symbol.asyncIterator]() { acquired = true; yield Uint8Array.of(128, 0); } };
  try {
    await assert.rejects(shell.exec("xargs -0 -E END echo", { stdin, limits: { maxOutputBytes: Buffer.byteLength(warning) - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(acquired, false);
  } finally { await shell.dispose(); }
});
