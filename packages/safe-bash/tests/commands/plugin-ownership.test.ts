import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { pdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { pdfimagesCommands } from "../../src/commands/pdfimages/index.js";
import { pdftoppmCommands } from "../../src/commands/pdftoppm/index.js";
import { sipsCommands } from "../../src/commands/sips/index.js";
import { imagemagickCommands } from "../../src/commands/imagemagick/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { csvcutCommands } from "../../src/commands/csvcut/index.js";
import { csvgrepCommands } from "../../src/commands/csvgrep/index.js";
import { utf8Codec } from "safe-bash-command-csvkit";

const bindings = {
  codecs: [utf8Codec], locale: { profile: "C", timezone: "UTC", formatNumber: () => "" },
  clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
for (const reverse of [false, true]) {
  test(`command plugins compose with dedicated owners (reverse=${reverse})`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const plugins = [pdfinfoCommands(), pdfimagesCommands(), pdftoppmCommands(), sipsCommands(), imagemagickCommands(), csvkitCommands(bindings), csvcutCommands(), csvgrepCommands()];
    try {
      for (const plugin of reverse ? plugins.reverse() : plugins) shell.use(plugin);
      await shell.exec("true");
      for (const name of ["pdfinfo", "pdfimages", "pdftoppm", "pdftocairo", "sips", "identify", "csvcut", "csvgrep", "csvstat"]) assert.ok(shell.commands.has(name), name);
      assert.equal(shell.commands.get("csvcut")?.description, "Project CSV columns from byte streams");
      shell.use(csvcutCommands());
      await assert.rejects(shell.exec("true"), /Command already registered/);
    } finally { await shell.dispose(); }
  });
}
test("zero-argument csvkit provides portable bindings and standalone overlap commands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    shell.use(csvkitCommands());
    const result = await shell.exec("csvcut -c name", { stdin: "name,age\nAda,36\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "name\nAda\n");
    const table = await shell.exec("csvlook -I -y 0", { stdin: "name\nAda\n" });
    assert.equal(table.exitCode, 0, table.stderr);
    assert.match(table.stdout, /Ada/);
  } finally { await shell.dispose(); }
});
