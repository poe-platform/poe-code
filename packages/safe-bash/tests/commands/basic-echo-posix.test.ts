import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";

for (const posix of ["", "1"]) for (const entry of [
  { flags: "", expected: "0a0a" },
  { flags: "-e", expected: "2d65200a0a" },
  { flags: "-E", expected: "2d45200a0a" },
  { flags: "-ne", expected: "2d6e65200a0a" },
  { flags: "-nn", expected: "2d6e6e200a0a" },
  { flags: "--", expected: "2d2d200a0a" },
  { flags: "-n", expected: "0a" },
  { flags: "-n -E", expected: "0a" },
  { flags: "-n -eE", expected: "0a" },
  { flags: "-n -x", expected: "2d78200a" },
  { flags: "-n --", expected: "2d2d200a" },
]) test(`external POSIX echo ${entry.flags} with POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec(`env echo ${entry.flags} '\\n'`, { env: { POSIXLY_CORRECT: posix } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), entry.expected);
    const builtin = await shell.exec("echo '\\n'", { env: { POSIXLY_CORRECT: posix } });
    assert.equal(builtin.stdout, "\\n\n");
  } finally { await shell.dispose(); }
});
