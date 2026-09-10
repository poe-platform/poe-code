import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./fixtures.js";
import { extraNativeCases } from "./extra-fixtures.js";

for (const fixture of [...nativeCases, ...extraNativeCases]) test(`native: ${fixture.name}`, async () => {
  const { getoptCommands } = await import("../../../src/commands/getopt/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem(), env: fixture.env }).use(getoptCommands());
  try {
    const argumentsText = fixture.argsHex.map(argument => {
      let result = "$'";
      for (let offset = 0; offset < argument.length; offset += 2) result += `\\x${argument.slice(offset, offset + 2)}`;
      return `${result}'`;
    });
    const result = await shell.exec(`getopt ${argumentsText.join(" ")}`, { stdin: Buffer.from(fixture.stdinHex, "hex") });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
    });
  } finally { await shell.dispose(); }
});
