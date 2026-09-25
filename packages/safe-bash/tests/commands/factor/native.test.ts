import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./fixtures.js";
import { extraNativeCases } from "./extra-fixtures.js";

for (const fixture of [...nativeCases, ...extraNativeCases]) test(`${fixture.qualification ? "qualified cap" : "native"}: ${fixture.name}`, async () => {
  // This historical oracle predates GNU factor's --exponents support.
  const exponentQualification = (fixture.name === "unknown-option" && fixture.args[0] === "--exponents") || (fixture.name === "short-h" && fixture.args[0] === "-h")
    ? { status: 0, stdoutBase64: Buffer.from("12: 2^2 3\n").toString("base64"), stderrBase64: "" }
    : undefined;
  const qualification = exponentQualification ?? fixture.qualification;
  const { factorCommands } = await import("../../../src/commands/factor/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", ...fixture.env } }).use(factorCommands());
  try {
    const args = fixture.args.map(argument => `'${argument.split("'").join("'\\''")}'`);
    const result = await shell.exec(`factor ${args.join(" ")}`, { stdin: Buffer.from(fixture.inputBase64, "base64") });
    assert.deepEqual({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64") }, {
      status: qualification?.status ?? fixture.status,
      stdout: qualification?.stdoutBase64 ?? fixture.stdoutBase64,
      stderr: qualification?.stderrBase64 ?? fixture.stderrBase64,
    });
  } finally { await shell.dispose(); }
});
