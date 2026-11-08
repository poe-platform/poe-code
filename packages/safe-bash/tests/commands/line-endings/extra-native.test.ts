import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { lineEndingCommands } from "../../../src/commands/line-endings/index.js";
import { extraNativeCases } from "./extra-fixtures.js";

for (const fixture of extraNativeCases) test(`extra native ${fixture.command}: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(fixture.files)) { await fs.writeFile(`/${name}`, Buffer.from(hex, "hex")); await fs.chmod!(`/${name}`, 0o644); }
  if ("directories" in fixture) for (const name of fixture.directories) await fs.mkdir(`/${name}`);
  if ("links" in fixture) for (const [name, target] of Object.entries(fixture.links)) await fs.symlink!(target, `/${name}`);
  const shell = new Shell({ fs, env: { LC_ALL: "C.UTF-8" } }).use(lineEndingCommands());
  try {
    const result = await shell.exec(`${fixture.command} ${fixture.args.map(argument => `'${argument}'`).join(" ")}`);
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
    });
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), Object.keys(fixture.after).sort());
    for (const [name, expected] of Object.entries(fixture.after)) {
      assert.equal((await fs.lstat(`/${name}`)).type, expected.type);
      if ("hex" in expected) assert.equal(Buffer.from(await fs.readFile(`/${name}`)).toString("hex"), expected.hex);
    }
  } finally { await shell.dispose(); }
});
