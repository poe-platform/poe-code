import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";
import { nativeCases } from "./native-cases.js";
import { finiteCases } from "./finite-cases.js";

for (const fixture of [...nativeCases, ...finiteCases]) test(`independent command native bytes: ${fixture.locale} ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from(fixture.inputBase64, "base64"));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: fixture.locale } }).use(csplitCommands());
  try {
    const pattern = `/${fixture.pattern}/`.split("'").join("'\\''");
    const result = await shell.exec(`csplit -k -- input '${pattern}'`);
    const files: Record<string, string> = {};
    for (const entry of await fs.readdir("/work")) if (entry.name !== "input") files[entry.name] = Buffer.from(await fs.readFile(`/work/${entry.name}`)).toString("base64");
    assert.deepEqual(files, fixture.files);
    assert.deepEqual(await fs.readFile("/work/input"), Uint8Array.from(Buffer.from(fixture.inputBase64, "base64")));
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: fixture.stdout, stderr: fixture.stderr, status: fixture.status,
    });
  } finally { await shell.dispose(); }
});
