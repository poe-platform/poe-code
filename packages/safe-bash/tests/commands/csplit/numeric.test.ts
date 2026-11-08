import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";
import { numericCases } from "./fixtures.js";

function quote(value: string): string { return `'${value.split("'").join("'\\''")}'`; }

for (const fixture of numericCases) test(fixture.name, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", new TextEncoder().encode(fixture.input));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    const result = await shell.exec(`csplit ${fixture.args.map(quote).join(" ")} < input`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: fixture.stdout, stderr: fixture.stderr ?? "", status: fixture.status ?? 0,
    });
    const files: Record<string, string> = {};
    for (const entry of await fs.readdir("/work")) if (entry.name !== "input") {
      files[entry.name] = new TextDecoder().decode(await fs.readFile(`/work/${entry.name}`));
    }
    assert.deepEqual(files, fixture.files);
  } finally { await shell.dispose(); }
});
