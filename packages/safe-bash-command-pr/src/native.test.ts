import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { createPrCommand } from "./index.js";
import { files, nativeCases } from "./fixtures.js";

for (const fixture of nativeCases) test(fixture.name, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, hex] of Object.entries(files)) {
    await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
    await fs.utimes(`/work/${name}`, 946684800000, 946684800000);
  }
  const carrier = createCommandArguments(fixture.args);
  const stdout: number[] = [], stderr: number[] = [];
  const status = await createPrCommand({ clock: () => 946684800000 }).execute({
    command: "pr", args: carrier.args, argumentValues: carrier, fs, cwd: "/work",
    env: { LC_ALL: "C", TZ: "UTC" }, signal: new AbortController().signal,
    stdin: toByteSource(Buffer.from(fixture.inputHex ?? "", "hex")),
    stdout: { async write(chunk) { stdout.push(...chunk); } },
    stderr: { async write(chunk) { stderr.push(...chunk); } },
  });
  const result = { stdoutBytes: Uint8Array.from(stdout), stderr: Buffer.from(stderr).toString(), exitCode: status.exitCode };
  assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderr: result.stderr, status: result.exitCode }, {
    stdoutHex: fixture.stdoutHex, stderr: fixture.stderr, status: fixture.status,
  });
});
