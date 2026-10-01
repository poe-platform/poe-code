import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import * as csvkit from "safe-bash-command-csvkit";
import * as ssconvert from "safe-bash-command-ssconvert";
import { createXmllintCommand } from "safe-bash-command-xmllint";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { ssconvertCommands } from "../../src/commands/ssconvert/index.js";
import * as core from "../../src/core.js";
import * as publicApi from "../../src/index.js";
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

for (const [entry, api] of [["core", core], ["index", publicApi]] as const) {
  test(`${entry} exposes portable command factories with zero-argument defaults`, async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
    Reflect.deleteProperty(globalThis, "Buffer");
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() });
    try {
      const htmlOptions: core.HtmlqCommandsOptions & publicApi.HtmlqCommandsOptions = {};
      for (const [factory, name] of [
        [api.createCsvkitCommands, "csvcut"], [api.createHtmlqCommands, "htmlq"],
        [api.createPandocCommands, "pandoc"], [api.createXanCommands, "xan"],
      ] as const) assert.ok(factory().some(command => command.name === name));
      shell.use(api.csvkitCommands()).use(api.htmlqCommands(htmlOptions))
        .use(api.pandocCommands()).use(api.xanCommands());
      for (const [script, stdin, stdout] of [
        ["csvcut -c name", "name,value\nAda,2\n", "name\nAda\n"],
        ["csvcut -e latin1 -c name", Uint8Array.of(110, 97, 109, 101, 10, 233, 10), "name\né\n"],
        ["csvstat --mean", "value\n2\n4\n", "3\n"],
        ["htmlq --text p", "<p>Hello</p>", "Hello\n"],
        ["pandoc -f markdown -t plain", "Hello", "Hello\n"],
        ["xan count", "name\nAda\n", "1\n"],
      ] as const) {
        const result = await shell.exec(script, { stdin });
        assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
        assert.equal(result.stderr, "", script);
        assert.equal(result.stdout, stdout, script);
        assert.equal(globalThis.Buffer, undefined);
      }
    } finally {
      await shell.dispose();
      Object.defineProperty(globalThis, "Buffer", descriptor);
    }
  });
}
