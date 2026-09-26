import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import * as csvkit from "safe-bash-command-csvkit";
import * as ssconvert from "safe-bash-command-ssconvert";
import { createXmllintCommand } from "safe-bash-command-xmllint";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

test("workspace and shell factories support omitted options", () => {
  assert.ok(csvkit.createCsvkitCommands().some(command => command.name === "csvcut"));
  assert.equal(csvkit.csvkitCommands().name, "csvkit-commands");
  assert.equal(ssconvert.createSsconvertCommand().name, "ssconvert");
  assert.deepEqual(ssconvert.createSsconvertCommands().map(command => command.name), ["ssconvert"]);
  assert.equal(ssconvert.ssconvertCommands().name, "ssconvert-commands");
  assert.equal(createXmllintCommand().name, "xmllint");
  assert.equal(csvkitCommands().name, "csvkit-commands");
  assert.equal(ssconvertCommands().name, "ssconvert-commands");
});

for (const [csv, sheet] of [[csvkit.csvkitCommands, ssconvert.ssconvertCommands], [csvkitCommands, ssconvertCommands]] as const) {
  test("portable bindings execute CSV, spreadsheet and XML commands in the VFS", async () => {
    const fs = new MemoryFileSystem();
    const signal = new AbortController().signal;
    await fs.writeFile("/input.csv", new TextEncoder().encode("name,value\nAda,2\n"), { signal });
    await fs.writeFile("/input.csv.gz", gzipSync("name,value\nAda,2\n"), { signal });
    await fs.writeFile("/input.xml", new TextEncoder().encode("<root><item/></root>"), { signal });
    const shell = new Shell({ fs }).use(csv()).use(sheet()).use({ name: "xml", setup(host) { host.commands.register(createXmllintCommand()); } });
    try {
      const cut = await shell.exec("csvcut -c name /input.csv");
      assert.equal(cut.exitCode, 0, cut.stderr); assert.equal(cut.stdout, "name\nAda\n");
      const compressed = await shell.exec("csvcut -c name /input.csv.gz");
      assert.equal(compressed.exitCode, 0, compressed.stderr); assert.equal(compressed.stdout, "name\nAda\n");
      const latin = await shell.exec("csvcut -e cp1252 -c name", { stdin: new Uint8Array([110,97,109,101,10,233,10]) });
      assert.equal(latin.exitCode, 0, latin.stderr); assert.equal(latin.stdout, "name\né\n");
      const mean = await shell.exec("csvstat --mean", { stdin: "value\n2\n4\n" });
      assert.equal(mean.exitCode, 0, mean.stderr); assert.equal(mean.stdout, "3\n");
      const schema = await shell.exec("csvsql --dialect sqlite --no-inference /input.csv");
      assert.equal(schema.exitCode, 0, schema.stderr); assert.ok(schema.stdout.includes("CREATE TABLE"));
      const converted = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /input.csv fd://1");
      assert.equal(converted.exitCode, 0, converted.stderr); assert.equal(converted.stdout, "name,value\nAda,2\n");
      const xml = await shell.exec("xmllint --xpath 'count(/root/item)'", { stdin: "<root><item/></root>" });
      assert.equal(xml.exitCode, 0, xml.stderr); assert.equal(xml.stdout, "1\n");
      const fileXml = await shell.exec("xmllint --xpath 'count(/root/item)' input.xml");
      assert.equal(fileXml.exitCode, 0, fileXml.stderr); assert.equal(fileXml.stdout, "1\n");
      const invalid = await shell.exec("xmllint --noout", { stdin: "<root>" });
      assert.equal(invalid.exitCode, 1); assert.ok(invalid.stderr.includes("xmllint:"));
    } finally { await shell.dispose(); }
  });
}
