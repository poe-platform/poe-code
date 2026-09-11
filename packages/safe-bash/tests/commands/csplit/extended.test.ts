import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";
import { extendedCases } from "./extended-fixtures.js";

for (const fixture of extendedCases) test(`GNU 8.30 exact capture: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", new TextEncoder().encode(fixture.input));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    const args = fixture.args.map(value => `'${value.split("'").join("'\\''")}'`).join(" ");
    const result = await shell.exec(`csplit ${args} < input`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: fixture.stdout, stderr: fixture.stderr ?? "", status: fixture.status ?? 0,
    });
    const files: Record<string, string> = {};
    for (const entry of await fs.readdir("/work")) if (entry.name !== "input") files[entry.name] = new TextDecoder().decode(await fs.readFile(`/work/${entry.name}`));
    assert.deepEqual(files, fixture.files);
  } finally { await shell.dispose(); }
});
