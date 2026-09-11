import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./fixtures.js";

for (const fixture of nativeCases) test(`native ${fixture.command}: ${fixture.name}`, async () => {
  const { lineEndingCommands } = await import("../../../src/commands/line-endings/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const identities = new Map<string, string>();
  for (const [name, file] of Object.entries(fixture.before)) {
    const path = `/work/${name}`;
    const alias = identities.get(file.inode);
    if (alias) await fs.link!(alias, path);
    else {
      await fs.writeFile(path, Buffer.from(file.hex, "hex"));
      await fs.chmod!(path, file.mode);
      await fs.utimes!(path, file.mtimeMs, file.mtimeMs);
      identities.set(file.inode, path);
    }
  }
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: fixture.locale } }).use(lineEndingCommands());
  try {
    const args = fixture.args.map(argument => `'${argument.split("'").join("'\\''")}'`).join(" ");
    const result = await shell.exec(`${fixture.command} ${args}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
    });
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(fixture.after).sort());
    for (const [name, file] of Object.entries(fixture.after)) {
      assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex"), file.hex, name);
      assert.equal((await fs.stat(`/work/${name}`)).mode & 0o777, file.mode & 0o777, `${name} mode`);
      if (fixture.args.includes("-k" as never)) assert.equal((await fs.stat(`/work/${name}`)).mtimeMs, file.mtimeMs, `${name} date`);
    }
  } finally { await shell.dispose(); }
});
