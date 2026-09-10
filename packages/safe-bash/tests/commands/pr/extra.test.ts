import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { extraCases } from "./extra-fixtures.js";

for (const fixture of extraCases) test(`extra native: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/directory", { recursive: true });
  for (const [name, text] of Object.entries({ a: "a\nb\nc\nd\n", b: "B\n", empty: "" })) {
    await fs.writeFile(`/work/${name}`, Buffer.from(text));
    await fs.utimes(`/work/${name}`, 946684800000, 946684800000);
  }
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands({ clock: () => 946684800000 }));
  try {
    const result = await shell.exec(`pr ${fixture.args.map(value => `'${value.split("'").join("'\\''")}'`).join(" ")}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
    assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, {
      stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex, status: fixture.status,
    });
  } finally { await shell.dispose(); }
});
