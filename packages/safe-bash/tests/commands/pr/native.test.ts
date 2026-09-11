import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { files, nativeCases } from "./fixtures.js";

function quote(value: string): string { return `'${value.split("'").join("'\\''")}'`; }

for (const fixture of nativeCases) test(fixture.name, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, hex] of Object.entries(files)) {
    await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
    await fs.utimes(`/work/${name}`, 946684800000, 946684800000);
  }
  await fs.writeFile("/work/input", Buffer.from(fixture.inputHex ?? "", "hex"));
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands({ clock: () => 946684800000 }));
  try {
    const result = await shell.exec(`pr ${fixture.args.map(quote).join(" ")} < input`);
    assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderr: result.stderr, status: result.exitCode }, {
      stdoutHex: fixture.stdoutHex, stderr: fixture.stderr, status: fixture.status,
    });
  } finally { await shell.dispose(); }
});
