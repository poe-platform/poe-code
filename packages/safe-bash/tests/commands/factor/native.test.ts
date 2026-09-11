import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./fixtures.js";
import { extraNativeCases } from "./extra-fixtures.js";

for (const fixture of [...nativeCases, ...extraNativeCases]) test(`${fixture.qualification ? "qualified cap" : "native"}: ${fixture.name}`, async () => {
  const { factorCommands } = await import("../../../src/commands/factor/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", ...fixture.env } }).use(factorCommands());
  try {
    const args = fixture.args.map(argument => `'${argument.split("'").join("'\\''")}'`);
    const result = await shell.exec(`factor ${args.join(" ")}`, { stdin: Buffer.from(fixture.inputBase64, "base64") });
    assert.deepEqual({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64") }, {
      status: fixture.qualification?.status ?? fixture.status,
      stdout: fixture.qualification?.stdoutBase64 ?? fixture.stdoutBase64,
      stderr: fixture.qualification?.stderrBase64 ?? fixture.stderrBase64,
    });
  } finally { await shell.dispose(); }
});
